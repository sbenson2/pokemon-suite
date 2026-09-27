# Native cartridge geometry

Model credits, source URLs and license terms: [Cartridge credits](../../../licenses/cartridge-models/README.md).

OBJ files and their MTL companions contain geometry and neutral material roles.
The native renderer assigns per-game colors and supplies locally decoded ROM art
on a separate label. Original download textures are intentionally absent.
The Blender files are editable versions of the same prepared geometry.

To reproduce the geometry, obtain the licensed models listed in the credits and run:

```sh
blender --background --python scripts/prepare-cartridge-models.py -- \
  --downloads /path/to/private/downloads --output /path/to/prepared
```

The download folder layout is documented in the script’s `sources` table. Download
authentication is a local setup step; no credentials belong in the project.
Review the front and rear in the native renderer after changing a model. Import
axes, custom normals and alpha sorting differ across formats. Keep `geometry.json`
in sync with the reviewed output, and preserve the attribution when redistributing.

`CartridgeModels.swift` caches the bundled geometry, creates separate material
instances per cartridge, and separates transparent case elements from opaque
interiors. A missing model uses the procedural fallback. Hover motion remains
bounded and stops when inactive or Reduce Motion is enabled.
