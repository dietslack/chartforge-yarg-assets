#!/usr/bin/env python3
"""Convert YARG's rectangular-theme note and fret meshes and textures for ChartForge.

Source: https://github.com/YARC-Official/YARG (LGPL-3.0-or-later).
This script and its output (the YARG_NOTE_MODEL / YARG_NOTE_TEX data in
yargnotes-data.js) are a modified form of those assets and stay under the
same license.

Usage:
  convert_yarg_notes.py <YARG checkout> <output yargnotes-data.js>

Needs the `assimp` command line tool (FBX -> triangulated assjson) and Pillow.

What it does to each mesh:
  1. Reads the FBX's raw (mesh-local) vertices, normals and UVs, ignoring the
     transform stored on the FBX node, exactly as Unity does once the theme
     prefab overrides that node's transform.
  2. Applies Unity's FBX handedness flip (x -> -x), then the local scale and
     rotation the mesh has in Assets/Prefabs/Gameplay/Visual/Themes/
     RectangularTheme.prefab (and, for the cymbal, the scale of its parent
     object), then Unity's 0.01 file scale. The result is the
     note as it stands on YARG's track (lane width 0.4, track width 2).
  3. Mirrors z (Unity is left-handed with +z away from the player, three.js
     is right-handed with -z away), centres the model on x/z and rests it on
     y = 0.
  4. Splits it by material slot, keeping the role each slot's material has in
     the theme prefab (metal / middle / glow / hopo / tap).
Textures are downscaled (they are 1024 px in YARG) and embedded as data URLs.
"""
import base64, io, json, math, os, subprocess, sys, tempfile
from PIL import Image

MESH_DIR = 'Assets/Art/Meshes/Gameplay'
TEX_DIR = 'Assets/Art/Textures'

# name -> (fbx, prefab local scale, prefab local rotation quaternion xyzw,
#          material role per slot, in the prefab's m_Materials order
#          [, scale of the parent object, applied after the rotation
#          [, rotation of the parent object]])
SWAP = (0.0, 0.70710677, 0.70710677, 0.0)
MODELS = {
    # Five Fret Notes
    'normal': ('Notes/Rectangular/NormalNote.fbx', (5.0, 3.75, 7.0), SWAP, ['metal', 'middle', 'glow']),
    'hopo':   ('Notes/Rectangular/HOPONote.fbx',   (4.5, 3.25, 6.5), SWAP, ['metal', 'hopo', 'glow', 'middle']),
    'tap':    ('Notes/Rectangular/TapNote.fbx',    (4.5, 3.25, 6.5), SWAP, ['metal', 'middle', 'glow', 'tap']),
    # Open note: YARG's open note is Assets/Art/Meshes/Obsolete/Open.prefab,
    # whose mesh is the "Full" object of Notes.blend. Open.fbx holds that same
    # mesh (identical bounds, checked in Blender), so it is read from there
    # and given Open.prefab's scale: (0.07593973, 0.087584, 0.05) on a mesh
    # Unity imports from the .blend in metres, i.e. 100x that on the FBX.
    'open':   ('Notes/Rectangular/Open.fbx',       (7.593973, 8.7584, 5.0), (0.0, 0.0, 0.0, 1.0), ['metal', 'middle']),
    # Four Lane Notes
    'kick':   ('Notes/Rectangular/KickNote.fbx',   (32.3, 2.5, 3.0), (-0.70710677, 0.0, 0.0, 0.70710677), ['metal', 'middle']),
    # The cymbal's mesh node is only rotated (85 degrees, so the cone leans
    # toward the player); its size comes from the "ScaleContainer" parent,
    # whose scale therefore applies after the rotation, in track axes
    'cymbal': ('Notes/Rectangular/CymbalNote.fbx', (1.0, 1.0, 1.0), (0.0, 0.7372774, 0.67559016, 0.0), ['middle', 'metal', 'glow'],
               (13.5, 17.0, 4.0)),
    # Drum dynamics (Four Lane Notes): accent and ghost pads and cymbals. The
    # cymbals are sized by their "ScaleContainer" parent like the plain one.
    'accent': ('Notes/Rectangular/AccentNote.fbx', (6.7, 3.5, 7.0), SWAP, ['metal', 'tap', 'hopo', 'middle']),
    'ghost':  ('Notes/Rectangular/GhostNote.fbx', (3.65, 3.25, 5.72), SWAP, ['metal', 'middle', 'glow', 'tap']),
    'cymbalAccent': ('Notes/Rectangular/CymbalAccentNote.fbx', (1.0, 1.0, 1.0), (0.0, 0.7372774, 0.67559016, 0.0),
                     ['middle', 'metal', 'glow', 'hopo', 'ghostCenter'], (13.5, 17.0, 4.0)),
    'cymbalGhost': ('Notes/Rectangular/CymbalGhostNote.fbx', (1.0, 1.0, 1.0), (0.0, 0.7372774, 0.67559016, 0.0),
                    ['metal', 'glow', 'middle', 'ghostCenter'], (9.0, 11.5, 2.666)),
    # Strikeline fret (RectangularFret.prefab). The FBX holds a base and, on a
    # child node, the colored frame and its inner pad; the "Model" parent adds
    # a scale and a 3 degree lean.
    'fret':   ('Frets/RectangularFret.fbx', (19.735, 10.531, 8.02), (0.0, 0.7098, 0.7043, 0.0),
               ['fretMetal', 'fretOuter', 'fretInner'], (1.01, 1.29, 1.0), (0.026, 0.0, 0.0, 0.99966)),
}

TEXTURES = {
    # key: (path under Assets/Art/Textures, output size)
    'normal':      ('Gameplay/Notes/Rectangular/NormalNote.png', 512),
    'normalShine': ('Gameplay/Notes/Rectangular/NormalNoteShine.png', 256),
    'cymbal':      ('Gameplay/Notes/Rectangular/CymbalNote.png', 512),
    'cymbalShine': ('Gameplay/Notes/Rectangular/CymbalNoteShine.png', 256),
    'kick':        ('Gameplay/Notes/Rectangular/KickNote.png', 512),
    'open':        ('PlayMode/Note_Full.png', 512),
    'openHopo':    ('PlayMode/Note_Full_HOPO.png', 512),
    'noise':       ('PlayMode/Note_Shader.png', 128),
    'fret':        ('Gameplay/Frets/RectangularFret.png', 512),
    'fretShine':   ('Gameplay/Frets/RectangularFretShine.png', 256),
    'kickFret':    ('Gameplay/Frets/RectangularKickFret.png', 512),
    # Fret hit flash: a 2 x 10 sprite sheet (560 x 1860 in YARG)
    'fretFlash':   ('Gameplay/Particles/FretHit_Flash.png', (256, 1024)),
    # Kick flash frames (1366 x 489 in YARG), in the order BaseVisual.prefab
    # lists them on KickFretFlash; they play at 50 frames a second
    'kickFlash1':  ('Gameplay/Particles/KickFlash/KickFlash1.png', (512, 256)),
    'kickFlash2':  ('Gameplay/Particles/KickFlash/KickFlash2.png', (512, 256)),
    'kickFlash3':  ('Gameplay/Particles/KickFlash/KickFlash3.png', (512, 256)),
    'kickFlash4':  ('Gameplay/Particles/KickFlash/KickFlash4.png', (512, 256)),
    'kickFlash5':  ('Gameplay/Particles/KickFlash/KickFlash5.png', (512, 256)),
    'kickFlash6':  ('Gameplay/Particles/KickFlash/KickFlash6.png', (512, 256)),
}


def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    # v + 2w(q x v) + 2 q x (q x v)
    cx, cy, cz = y * vz - z * vy, z * vx - x * vz, x * vy - y * vx
    dx, dy, dz = y * cz - z * cy, z * cx - x * cz, x * cy - y * cx
    return (vx + 2 * (w * cx + dx), vy + 2 * (w * cy + dy), vz + 2 * (w * cz + dz))


def mat_mul(a, b):
    return [sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4)) for r in range(4) for c in range(4)]


IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def mesh_transforms(data):
    """Each mesh's transform relative to the model's top node. The top node's
    own transform is the one the prefab replaces, so it is left out; child
    nodes below it keep theirs."""
    out = {}

    def walk(node, m):
        for i in node.get('meshes', []):
            out[i] = m
        for c in node.get('children', []):
            walk(c, mat_mul(m, c['transformation']))

    for top in data['rootnode'].get('children', []):
        walk(top, IDENTITY)
    return out


def convert_model(yarg, fbx, scale, rot, roles, parent_scale=(1.0, 1.0, 1.0), parent_rot=(0.0, 0.0, 0.0, 1.0)):
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'm.json')
        subprocess.run(['assimp', 'export', os.path.join(yarg, MESH_DIR, fbx), out, '-fassjson', '-tri'],
                       check=True, stdout=subprocess.DEVNULL)
        data = json.load(open(out))
    meshes = data['meshes']
    assert len(meshes) == len(roles), (fbx, len(meshes), roles)
    parts = []
    xforms = mesh_transforms(data)
    for mi, (mesh, role) in enumerate(zip(meshes, roles)):
        v, n = list(mesh['vertices']), list(mesh['normals'])
        t = xforms.get(mi, IDENTITY)
        if t != IDENTITY:
            # Child node: scale and translation only (checked), so normals
            # take the inverse scale
            assert all(abs(t[i]) < 1e-6 for i in (1, 2, 4, 6, 8, 9)), fbx
            for i in range(0, len(v), 3):
                v[i], v[i + 1], v[i + 2] = (v[i] * t[0] + t[3], v[i + 1] * t[5] + t[7], v[i + 2] * t[10] + t[11])
                n[i], n[i + 1], n[i + 2] = n[i] / t[0], n[i + 1] / t[5], n[i + 2] / t[10]
        uv = mesh['texturecoords'][0]
        P, N = [], []
        for i in range(0, len(v), 3):
            # Unity import flip, prefab scale, prefab rotation, file scale
            p = qrot(rot, (-v[i] * scale[0], v[i + 1] * scale[1], v[i + 2] * scale[2]))
            m = qrot(rot, (-n[i] / scale[0], n[i + 1] / scale[1], n[i + 2] / scale[2]))
            p = qrot(parent_rot, tuple(c * ps for c, ps in zip(p, parent_scale)))
            m = qrot(parent_rot, tuple(c / ps for c, ps in zip(m, parent_scale)))
            ln = math.sqrt(m[0] ** 2 + m[1] ** 2 + m[2] ** 2) or 1.0
            # Unity (left-handed) -> three.js (right-handed): mirror z
            P.append((p[0] * 0.01, p[1] * 0.01, -p[2] * 0.01))
            N.append((m[0] / ln, m[1] / ln, -m[2] / ln))
        assert all(len(f) == 3 for f in mesh['faces']), fbx
        ix = [i for f in mesh['faces'] for i in f]
        # The import flip and the z mirror each reverse the winding once, so
        # the FBX's own winding stands
        parts.append({'role': role, 'p': P, 'n': N, 'uv': uv, 'ix': ix})
    allp = [p for part in parts for p in part['p']]
    lo = [min(p[i] for p in allp) for i in range(3)]
    hi = [max(p[i] for p in allp) for i in range(3)]
    cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
    r4 = lambda x: round(x, 4)
    # y0: height of the model's lowest point above its own origin before it
    # was rested on y = 0 (used to stand the fret where YARG's prefab puts it)
    model = {'w': r4(hi[0] - lo[0]), 'h': r4(hi[1] - lo[1]), 'd': r4(hi[2] - lo[2]), 'y0': r4(lo[1]), 'parts': []}
    for part in parts:
        model['parts'].append({
            'role': part['role'],
            'p': [r4(c) for p in part['p'] for c in (p[0] - cx, p[1] - lo[1], p[2] - cz)],
            'n': [round(c, 3) for nn in part['n'] for c in nn],
            'uv': [r4(c) for c in part['uv']],
            'ix': part['ix'],
        })
    return model


# The drum kick fret (RectangularKickFret.fbx, "Kick Fret" in the theme prefab).
# Its FBX has two top nodes, so Unity keeps each node's own scale and the
# prefab overrides their position and rotation; the prefab root is scaled.
# 'kickSlide' is the block the KickFretHit animation moves.
KICK_FRET_ROOT_SCALE = 0.5442
KICK_FRET_NODES = [
    # (role, local position, local rotation xyzw) in the order of the FBX meshes
    ('kickSlide', (-0.0034272184, 0.16697067, -0.0016252995), (0.06532861, -0.9978638, 0.0, 0.0)),
    ('kickBody', (-0.001, -0.001, -0.003), (0.0, -1.0, 0.0, 0.0)),
]
# KickFretHit.anim: the slide's local position at the moment of the hit; it
# eases back to the rest position above over 1/6 s
KICK_FRET_HIT_POS = (0.0728, 0.178, -0.0016252995)


def convert_kick_fret(yarg):
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'm.json')
        subprocess.run(['assimp', 'export', os.path.join(yarg, MESH_DIR, 'Frets/RectangularKickFret.fbx'), out,
                        '-fassjson', '-tri'], check=True, stdout=subprocess.DEVNULL)
        data = json.load(open(out))
    nodes = {}
    for node in data['rootnode']['children']:
        for mi in node.get('meshes', []):
            nodes[mi] = node['transformation']
    r4 = lambda x: round(x, 4)
    model = {'parts': []}
    for mi, (role, pos, rot) in enumerate(KICK_FRET_NODES):
        mesh, t = data['meshes'][mi], nodes[mi]
        # The node's scale is the length of each column of its matrix
        scale = [math.sqrt(t[c] ** 2 + t[4 + c] ** 2 + t[8 + c] ** 2) for c in range(3)]
        v, n = mesh['vertices'], mesh['normals']
        P, N = [], []
        for i in range(0, len(v), 3):
            p = qrot(rot, (-v[i] * scale[0] * 0.01, v[i + 1] * scale[1] * 0.01, v[i + 2] * scale[2] * 0.01))
            m = qrot(rot, (-n[i] / scale[0], n[i + 1] / scale[1], n[i + 2] / scale[2]))
            ln = math.sqrt(m[0] ** 2 + m[1] ** 2 + m[2] ** 2) or 1.0
            p = [(p[k] + pos[k]) * KICK_FRET_ROOT_SCALE for k in range(3)]
            P += [r4(p[0]), r4(p[1]), r4(-p[2])]
            N += [round(m[0] / ln, 3), round(m[1] / ln, 3), round(-m[2] / ln, 3)]
        model['parts'].append({'role': role, 'p': P, 'n': N, 'uv': [r4(c) for c in mesh['texturecoords'][0]],
                               'ix': [i for f in mesh['faces'] for i in f]})
    rest = KICK_FRET_NODES[0][1]
    # Offset of the slide at the hit, in the same units (z mirrored like the mesh)
    model['hit'] = [r4((KICK_FRET_HIT_POS[0] - rest[0]) * KICK_FRET_ROOT_SCALE),
                    r4((KICK_FRET_HIT_POS[1] - rest[1]) * KICK_FRET_ROOT_SCALE),
                    r4(-(KICK_FRET_HIT_POS[2] - rest[2]) * KICK_FRET_ROOT_SCALE)]
    allx = P = [c for part in model['parts'] for c in part['p']]
    model['w'] = r4(max(allx[0::3]) - min(allx[0::3]))
    model['h'] = r4(max(allx[1::3]) - min(allx[1::3]))
    model['d'] = r4(max(allx[2::3]) - min(allx[2::3]))
    return model


def convert_texture(yarg, rel, size):
    im = Image.open(os.path.join(yarg, TEX_DIR, rel)).convert('RGBA')
    im = im.resize(size if isinstance(size, tuple) else (size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def main():
    yarg, out = sys.argv[1], sys.argv[2]
    models = {k: convert_model(yarg, *spec) for k, spec in MODELS.items()}
    # Kept at its own origin (the "Kick Fret Position" on the strikeline,
    # x = -1.015 for the left one; the right one is the same model mirrored)
    models['kickFret'] = convert_kick_fret(yarg)
    textures = {k: convert_texture(yarg, *spec) for k, spec in TEXTURES.items()}
    with open(out, 'w') as f:
        f.write('// Note models and textures from YARG (https://github.com/YARC-Official/YARG),\n')
        f.write('// rectangular theme. Copyright (C) the YARG contributors, licensed under the\n')
        f.write('// GNU Lesser General Public License v3.0 or later. Generated by\n')
        f.write('// convert_yarg_notes.py: do not edit by hand. Sizes are in YARG track units\n')
        f.write('// (lane width 0.4), models centred on x/z and resting on y = 0.\n')
        f.write('const YARG_NOTE_MODEL = ' + json.dumps(models, separators=(',', ':')) + ';\n')
        f.write('const YARG_NOTE_TEX = ' + json.dumps(textures, separators=(',', ':')) + ';\n')
    for k, m in models.items():
        print(k, 'w/h/d', m['w'], m['h'], m['d'], [(p['role'], len(p['ix']) // 3) for p in m['parts']], m.get('hit', ''))
    print('bytes', os.path.getsize(out))


if __name__ == '__main__':
    main()
