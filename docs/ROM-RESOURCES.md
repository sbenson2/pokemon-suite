# Local ROM resources

Suite distributes software that reads game artwork from the user's local cartridge image. It does not distribute extracted Pokémon, trainer, badge, item, or category images. The team, farming, shiny collection, and Pokédex paths resolve through the local service. Even when old development PNGs are present, the service does not serve them as game artwork.

Installed games use `games[game].cartridge.path` (or `inputs.rom`) from the local profile. A cataloged ROM (raw or a ZIP with one cartridge) may also use `library[game].source`; an emulator need not be running. The existing FireRed installer automatically supplies the former. No extra artwork import is needed after installing FireRed. Revisiting the Pokédex after an import refreshes artwork availability while retaining the current selection and farming draft.

The provider validates cartridge identity, container bounds, graphics dimensions, compressed lengths and back-references. GBA headers also verify the game code, checksum and language. Ruby/Sapphire and Crystal readers use layouts bound to exact cartridge SHA-1 values. DS and decrypted 3DS readers validate their banner/NCSD/NCCH/ExeFS/SMDH structure and game identity. Encrypted 3DS images are reported explicitly; this reader does not decrypt them. It resolves species by names read from the game, avoiding confusion between National Dex numbers and the reordered Hoenn species IDs. Pokémon images use the game's normal or shiny palette and front or back tiles. The current renderer shows the base form/first animation frame; personality-specific Spinda spots and a complete alternate-form selector are not implemented.

Readers and decoded PNGs have bounded memory caches. Source identity includes file metadata and a content fingerprint, and every image request checks the source before cache access. GBA/Crystal checksums cover the whole ROM; DS/3DS fingerprints cover the identifying header and decoded icon, not their entire multi-gigabyte ROM. Library/catalog availability checks run in daemon workers, refreshing on the two-second polling cycle; slow storage and macOS permission prompts do not block the interface. Replacing or removing a ROM does not leave its old sprites active. Image responses require the local Suite session and use `Cache-Control: no-store`. The browser versions game image URLs by ROM hash, including dynamically inserted images, to invalidate its decoded-image cache. No image cache is written to disk by the application.

| Resource | Current source and coverage |
|---|---|
| FireRed and LeafGreen US/EU Rev1 Pokémon | Qualified against both actual cartridges: all 386 species, normal/shiny, front/back (1,544 images per game) |
| FireRed and LeafGreen Rev1 auxiliary art | Both player portraits, 375 item table slots, eight individual badges and the badge sheet; FireRed also has four category graphics |
| Emerald English Pokémon and auxiliary art | All 386 species × four variants, both portraits, 377 item table slots, eight badges and the badge sheet |
| Ruby/Sapphire English Rev2 Pokémon | All 386 species × four variants in each game; auxiliary item/trainer/badge readers not enabled |
| Crystal English Rev1 Pokémon and trainers | All 251 species × four variants (1,004 images), including Porygon2 and base Unown; both player portraits |
| DS (Diamond, Pearl, Platinum, HeartGold, SoulSilver, Black/White, Black 2/White 2) | All nine local cartridges tested: native 32×32 banner icon; no Pokémon/item/badge reader yet |
| Decrypted 3DS (X/Y, Omega Ruby/Alpha Sapphire, Sun, Ultra Sun/Ultra Moon) | All seven available local cartridges tested: native 48×48 launcher icon. Moon identity is supported but no Moon cartridge was available for qualification. Pokémon/model assets are not yet decoded |
| Red/Blue/Yellow/Green, Gold/Silver, Switch | Artwork readers not implemented; native placeholders and explicit unavailability |
| Other revisions and ROM hacks | FireRed/LeafGreen/Emerald Pokémon can use a valid English interoperability header, but only the exact revisions below have been exercised; auxiliary offsets are never guessed |
| Emulated video/audio | The locally configured emulator and game resources |
| Nintendo console startup | Console firmware is distinct from a game ROM. No startup recording is served; the emulator's own output is shown |
| Bot world/story/battle/runtime knowledge and the mGBA core | Bundled in the Mac app as a pinned pack (`pokemon_suite/game_resources.py`). The knowledge is structural data extracted from pret/pokefirered `c75f3523` (symbols, map layouts and events, script control flow, trainer parties and move data), with no ROM bytes, artwork or dialogue. Running from source still needs a resource folder |
| Factual Pokédex/evolution/route catalogs | Attributed data described in `DATA_SOURCES.md`; not currently regenerated from the ROM |
| Interface icons and licensed hardware photos | Original application assets and separately licensed photography |

The architecture separates software and game artwork. In the Mac app, FireRed installs from the ROM alone: the pinned core and knowledge ship in the app. Other games still need ROM readers for their formats, a qualified knowledge builder and emulator packaging. ROMs, firmware, keys, research trees, saves and generated game data remain outside the release boundary throughout that work.

## Qualification and native presentation

The September 10, 2026 cartridge pass decoded **8,724 Pokémon images**, **1,127 item table slots**, **eight player portraits**, **27 badge images** (three sheets plus 24 individual badges), **four category graphics**, and **16 native DS/3DS game icons**, with no decoding failures. Item slots include the game's own unused-slot graphic; availability does not imply every numeric slot represents a usable item. Contact sheets and machine-readable results are kept privately, outside the release tree. Representative sprites, shiny colors, trainer poses, item art, badges, and launcher icons were visually inspected; this is not a claim of independent pixel-by-pixel verification of every image.

| Cartridge | Qualified SHA-1 |
|---|---|
| FireRed Rev1 | `dd5945db9b930750cb39d00c84da8571feebf417` |
| LeafGreen Rev1 | `7862c67bdecbe21d1d69ce082ce34327e1c6ed5e` |
| Emerald | `f3ae088181bf583e55daf962a92bb46f4f1d07b7` |
| Ruby Rev2 | `5b64eacf892920518db4ec664e62a086dd5f5bc8` |
| Sapphire Rev2 | `89b45fb172e6b55d51fc0e61989775187f6fe63c` |
| Crystal Rev1 | `f2f52230b536214ef7c9924f483392993e226cfb` |

The native app uses these assets in game-library rows, the trainer card, badges, team held items, the capture-ball selection, and Pokémon views. Standard Mac navigation and action controls retain SF Symbols. Library mascot sprites are taken from each classic cartridge; they are not reproductions of cartridge labels or box covers. Held-item telemetry is matched by `nativeId`, not the unrelated global Pokédex item ID. Native requests are keyed by game, ROM fingerprint, and service session, and discard canceled responses after selection changes.

## Format references

- [FireRed interoperability header](https://github.com/pret/pokefirered/blob/c75f352304d529f6ba92d4f74b9cf8b5c3810788/src/rom_header_gf.c): pointer order and field widths.
- [Emerald interoperability header](https://github.com/pret/pokeemerald/blob/master/src/rom_header_gf.c): equivalent graphics interface used by external applications.
- [Crystal LZ3 decompression format](https://github.com/pret/pokecrystal/blob/master/home/decompress.asm): command lengths, repeat/flip/reverse references and termination.
- [Crystal picture loading](https://github.com/pret/pokecrystal/blob/master/engine/gfx/load_pics.asm): bank adjustment and front/back tables.
- [DS banner layout](https://blocksds.skylyrac.net/libnds/structsNDSBanner.html) and [3DS SMDH layout](https://3dbrew.org/wiki/SMDH): launcher image formats.
- [FireRed trainer identifiers](https://github.com/pret/pokefirered/blob/c75f352304d529f6ba92d4f74b9cf8b5c3810788/include/constants/trainers.h): player portrait table indices.

The decoder is original Python using the standard library. The shipped tests construct synthetic ROM-format fixtures with original colored test tiles; no Nintendo image bytes are included in those fixtures. Optional private cartridge checks are separate from public test inputs. This separation addresses redistribution of game files; it is not a legal clearance guarantee or a license to Nintendo/Pokémon content.

## Native cartridge library

The Mac library renders original 3D cartridge models for GB, GBC, GBA, DS, 3DS and Switch. These approximate physical cartridge shapes and materials; labels are Suite compositions, not retail sticker scans. Game titles remain visible even when no supported artwork is available. No game art is added to the app bundle.

DS labels now use the selected cartridge's static battle mascot instead of the small launcher icon. Qualified against the nine local English releases listed above: Dialga, Palkia, Giratina, Ho-Oh, Lugia, Reshiram, Zekrom, Black Kyurem and White Kyurem. The reader traverses bounded NitroFS/FAT and NARC members, decodes NCGR/NCLR, handles Gen IV pixel obfuscation, and handles Gen V LZ11, the stale static-image header sizes and four OBJ regions. BW2 mascot image indices 744/743 were checked visually in the local ROM; personal-stat indices are different. This is mascot coverage, not a claim of full DS Pokédex or animation support. A damaged or unfamiliar sprite archive preserves the valid launcher icon and reports no mascot capability.

The Pokémon wordmark is read from the qualified Emerald ROM's affine title background (8-bit tilemap and pixels). Its table addresses are numeric format metadata bound to the existing Emerald SHA-1. It may be reused across label compositions when that ROM is in the local library. GB/Gold/Silver and Let's Go labels may use the matching species from another compatible ROM in the local collection. 3DS uses its own SMDH image. Other missing graphics use a version-specific typographic label. Details distinguish these compositions and compatible sources from original retail labels.

Format references: [Nitro sprite layout research](https://github.com/magical/pokemon-nds-sprites/blob/master/docs/pokegra.rst), [GBATEK](https://problemkaputt.de/gbatek.htm), [Emerald title-screen loading](https://github.com/pret/pokeemerald/blob/master/src/title_screen.c). The decoder is an original Python implementation; no third-party decoder code or reference artwork is included in the distribution.

## FireRed Town Map

The exact English FireRed 1.1 SHA-1 `dd5945db9b930750cb39d00c84da8571feebf417`
qualifies `map/kanto`, `map/sevii-123`, `map/sevii-45`, `map/sevii-67`,
`map/male` and `map/female` through the existing authenticated ROM-art route.
Numeric locations come from the pinned local build's symbols for `sRegionMap_Gfx`,
`sRegionMap_Pal`, regional tilemaps and `sPlayerIcon_*`. Background decoding uses
600 little-endian 4bpp entries, five RGB555 banks, horizontal/vertical flip bits
and opaque palette-zero pixels; heads use transparent palette zero. Images and
ROM bytes stay local and are excluded from release files. The source for format
and placement is [FireRed's region-map renderer](https://github.com/pret/pokefirered/blob/c75f352304d529f6ba92d4f74b9cf8b5c3810788/src/region_map.c).
