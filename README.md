# ChartForge: YARG note and fret assets

ChartForge's standard (non-circular) note style uses the note and strikeline
fret models, textures and shaders of the rectangular theme from [YARG](https://github.com/YARC-Official/YARG)
(Yet Another Rhythm Game).

YARG is Copyright (C) the YARG contributors and is licensed under the
**GNU Lesser General Public License v3.0 or later**. Everything in this
repository is distributed under that same license: the unmodified YARG files,
and ChartForge's modified versions of them. The license texts are in
[`COPYING.LESSER`](COPYING.LESSER) (LGPL v3) and [`COPYING`](COPYING) (GPL v3,
which the LGPL builds on).

This repository exists so that anyone who receives ChartForge can get the
source of the LGPL-covered parts.

## Where the files came from

- Repository: https://github.com/YARC-Official/YARG
- Commit: `f5bfbe6996b4af35722d4204a93c6cc5c8f52a45` (24 June 2026)
- Retrieved: 11 October 2026

## Layout

| Folder | Contents |
| --- | --- |
| `original/` | Files copied from YARG, unmodified, at their original paths (with their Unity `.meta` files). Checksums are in `original-files.sha256`. |
| `chartforge/` | ChartForge's modified versions: the source of the files that ship inside the app. |

### `original/`

- `Assets/Art/Meshes/Gameplay/Notes/Rectangular/`: `NormalNote.fbx`, `HOPONote.fbx`, `TapNote.fbx`, `Open.fbx`, `KickNote.fbx`, `CymbalNote.fbx`, `AccentNote.fbx`, `GhostNote.fbx`, `CymbalAccentNote.fbx`, `CymbalGhostNote.fbx`
- `Assets/Art/Textures/Gameplay/Notes/Rectangular/`: `NormalNote.png`, `NormalNoteShine.png`, `CymbalNote.png`, `CymbalNoteShine.png`, `KickNote.png`
- `Assets/Art/Textures/PlayMode/`: `Note_Full.png` (open note), `Note_Full_HOPO.png` (open HOPO note), `Note_Shader.png` (noise ramp)
- `Assets/Art/Meshes/Gameplay/Frets/RectangularFret.fbx`, `Assets/Art/Textures/Gameplay/Frets/` (`RectangularFret.png`, `RectangularFretShine.png`), `Assets/Art/Materials/Gameplay/Frets/Rectangular/` (`FretMetal`, `FretOuter`, `FretInner`)
- `Assets/Art/Shaders/Gameplay/Frets/RectangularFretOuter.shadergraph` and `RectangularFretInner.shadergraph`
- `Assets/Prefabs/Gameplay/Visual/Themes/RectangularFret.prefab` (the fret's scale, rotation and material slots)
- Drum kick frets and kick flash: `Assets/Art/Meshes/Gameplay/Frets/RectangularKickFret.fbx`, `RectangularKickFret.png`, `KickFret.mat`, `KickFlash.mat`, `Assets/Art/Shaders/Gameplay/KickFlash.shadergraph`, `Assets/Art/Textures/Gameplay/Particles/KickFlash/KickFlash1.png` to `KickFlash6.png`, and `KickFretHit.anim` / `KickFretIdle.anim`
- Fret animations and effects: `FretHit.anim`, `FretSustained.anim`, `FretCymbalHit.anim`, `FretIdle.anim`, `FretControllerGuitar.controller`, `Assets/Art/Textures/Gameplay/Particles/FretHit_Flash.png`, and the particle materials `FretHit_Flash.mat`, `ParticlesUnlit.mat`, `ParticleTransparent.mat`, `GlassParticles.mat` (the particle systems themselves are in `RectangularFret.prefab`)
- Reference only (values were read from them, no code was copied): `Assets/Script/Gameplay/Visuals/Fret/Fret.cs`, `FretArray.cs`, `KickFret.cs`, `KickFretFlash.cs`, `Assets/Script/Helpers/Authoring/EffectParticle.cs`, `EffectLight.cs`, and `Assets/Prefabs/Gameplay/Visual/BaseVisual.prefab` (kick fret positions, flash quad placement and frame order)
- Lighting, reference only: `Assets/Scenes/Gameplay.unity` (the directional light, ambient and reflection settings), `Assets/Scenes/Gameplay/LightingData.asset` (the baked ambient probe whose coefficients the note shaders use) and `Assets/Settings/PostProcessProfile.asset` (ACES tonemapping)
- `Assets/Art/Materials/Gameplay/Notes/`: the `.mat` files whose settings were used (`NoteMetal`, `NoteGlow`, `NoteMiddle`, `NoteHOPOGlow`, `NoteTapCenter`, `CymbalMiddle`, `CymbalMetal`, `CymbalGlow`, `CymbalGhostCenter`, `KickNoteMetal`, `KickNoteMiddle`, `OpenMetal`, `OpenMiddle`, `OpenHopoMetal`, `OpenHopoMiddle`)
- `Assets/Art/Meshes/Obsolete/`: `Open.prefab`, `OpenHOPO.prefab` (YARG's open notes: scale and materials) and `Notes.blend` (the mesh they reference; not converted, see below)
- `Assets/Art/Shaders/Gameplay/Notes/RectangularNote.shadergraph` and `Assets/Art/Shaders/Gameplay/YargLit.shadergraph`
- `Assets/Prefabs/Gameplay/Visual/Themes/RectangularTheme.prefab` (the scale, rotation and material slots of each note)

### `chartforge/`

| File | What it is | Ships in ChartForge as |
| --- | --- | --- |
| `convert_yarg_notes.py` | Converts the FBX meshes and PNG textures into `yargnotes-data.js`. | not shipped (build tool) |
| `yargnotes-data.js` | Generated note geometry and embedded textures. | `app/js/yargnotes-data.js` |
| `yargnotes.js` | three.js port of the five shader graphs, the material settings, YARG's gameplay scene lighting and the frets' point lights with URP's Lit shading and ACES tonemapping, and the code that builds notes and strikeline frets from the models. | `app/js/yargnotes.js` |

In the released app, the two shipped files are minified and obfuscated along
with the rest of the app's scripts. The readable source of both is in
`chartforge/`.
## License

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU Lesser General Public License for more details.

ChartForge itself is a separate work that uses these files; it is not covered
by this license.
