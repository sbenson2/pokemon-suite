# mGBA core bundled with the Mac app

The Mac app ships a WebAssembly build of mGBA (`GameResources/firered/core/mgba.js`
and `mgba.wasm`). It is not covered by this project's MIT license. It keeps the
Mozilla Public License 2.0; the full text is in [MPL-2.0.txt](MPL-2.0.txt).

| Component | Source | Revision | License |
|---|---|---|---|
| mGBA, by Jeffrey Pfau and contributors | https://github.com/mgba-emu/mgba | `c034660f007c543233f1cadeb0ca13c71afd8f41` | MPL-2.0 |
| mGBA WebAssembly wrapper | https://github.com/wasm-gaming/mGBA-wasm | `6b19a50a1aa45055970b46999d5cde2451f1f5d0` | MPL-2.0 |

The complete source for the bundled core is available at those revisions,
except for the wrapper's C shim, whose exact source for this build is
[mgba_shim.c](mgba_shim.c) (it adds the read-only memory accessors the bot
observes the game through). The core was built in the image
`ghcr.io/openrct2/openrct2-build@sha256:0e1daa8e3f5a1c6951179aeab5c5de471ea705cb5f756bfb6e0ae5162b7e67be`.
`core/build-manifest.json` beside the core records these revisions and the
SHA-256 of each built file. Third-party code that mGBA vendors keeps its own
license in the mGBA source tree at the revision above.
