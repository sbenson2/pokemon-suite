# Cartridge model credits

The geometry and editable Blender files in `macos/Assets/Cartridges` use the
following works under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
These assets retain CC BY 4.0; the application’s MIT license does not replace it.
The creators do not endorse Pokémon Suite.

| Files | Original work and creator | Changes |
| --- | --- | --- |
| `gb.*`, `crystal.*` | [Gameboy Cartridge lowpoly](https://sketchfab.com/3d-models/gameboy-cartridge-lowpoly-8b9728eab16c4056ac2636ae7f0f038f) by [Bob](https://sketchfab.com/MeBob) | Removed textures, normalized scale and axes, replaced materials. Crystal adapts this mesh with a continuous top, convex front panel, translucent case, board, battery, contacts and plastic flecks. |
| `gba.*` | [Gameboy Advance Blank Cartridge](https://sketchfab.com/3d-models/gameboy-advance-blank-cartridge-d5527f8b66014c17b38c6c299b101a3e) by [ewaldc2028](https://sketchfab.com/ewaldc2028) | Normalized scale and axes; replaced materials. |
| `nds.*` | [Nintendo Ds cartridge (preset)](https://sketchfab.com/3d-models/nintendo-ds-cartridge-preset-01e161c3e7c24b40888fdf94ad003501) by [littlengvfx](https://sketchfab.com/littlengvfx) | Removed label mesh and textures, normalized scale, replaced materials. |
| `3ds.*` | [3DS Cartridge](https://sketchfab.com/3d-models/3ds-cartridge-e075af04a56f4d31bbd7d92365f1d8fc) by [SGLilac](https://sketchfab.com/SGLilac) | Removed textures, normalized scale, replaced materials. |
| `switch.*` | [Nintendo Switch game Cartridge v2](https://sketchfab.com/3d-models/nintendo-switch-game-cartridge-v2-2e681c294545411d98eb61a98f2dba3e) by [maxns1980](https://sketchfab.com/maxns1980) | Selected one cartridge from the scene, removed label plates and textures, normalized scale and axes, replaced materials. |

GB and 3DS source files were obtained from the [Allen Institute’s Objaverse mirror](https://huggingface.co/datasets/allenai/objaverse); individual model licenses remain those above. Other source files were downloaded through Sketchfab’s official download API. Downloaded archive notices are preserved alongside this file.

The project’s modifications to these meshes are also made available under CC BY 4.0.
Keep these credits and the license link when redistributing them, and identify further modifications.
`scripts/prepare-cartridge-models.py` records the conversions; `geometry.json` records the resulting mesh checksums.

Source game-label images and modeling-reference photographs are not included.
The Suite composes labels at runtime using locally decoded ROM artwork. A model
creator’s license does not grant rights to game artwork or third-party trademarks.
