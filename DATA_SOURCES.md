# Data sources

The four game-specific catalogs retain names/identifiers, stats, types, encounters, levels, learnsets, and other functional facts. The public exporter removes species/ability descriptions and species category prose. It substitutes local ROM artwork endpoint paths, marks artwork as requiring a local ROM, and calculates a new deterministic catalog revision. No sprite image bytes are included. At runtime, the catalog reports whether its configured ROM reader is available; missing or unsupported ROMs use original placeholder icons.

The original artwork decoder reads GBA interoperability-header pointers, compressed tile data, and palettes from the user's game image. Numeric auxiliary layout offsets are tied to exact ROM hashes. No decompilation graphics files or sprite-service downloads are used at runtime. See [ROM-RESOURCES.md](docs/ROM-RESOURCES.md) for format references, supported inputs, and verification boundaries.

PokéAPI source: [PokeAPI/pokeapi at d4f9a4af58ade123fbc0558f68b1c69daa97d9e4](https://github.com/PokeAPI/pokeapi/tree/d4f9a4af58ade123fbc0558f68b1c69daa97d9e4). Its full BSD-3-Clause-style copyright, conditions, and disclaimer are retained in [the license notice](licenses/POKEAPI-BSD-3-CLAUSE.txt). The individual catalog `source` fields preserve upstream and native-table digests. This notice does not license underlying game artwork or other owners' expression.

The offline SQLite reference imports 99 factual CSV tables from that same
revision, excluding prose/flavor-text tables. It retains individual source
checksums and uses the same license notice. Generated game projections reference
the database checksum. The native FireRed held-item catalog contains numeric
item/effect IDs, parameters and symbolic identifiers from the qualified source;
no item images or descriptions are included. See
[items and offline Pokédex](docs/ITEMS-AND-OFFLINE-POKEDEX.md) for coverage and build tools.

The item ID/name mapping, hunt route table, and evolution rules describe functional game behavior. Their JSON source fields cite the relevant source tables, hashes, and revisions: FireRed `c75f352304d529f6ba92d4f74b9cf8b5c3810788`, Emerald `5eff78649e7170a877b961ef0b3da13b81a16038`, and the Crystal revision recorded in the evolution table. Keep these attributions and review any extension that adds expressive source content. The decompilation source trees and raw map/layout/script files are excluded from the release.

The Mac app's FireRed bot knowledge (`runtime.json`, `world.json`, `story.json`, `battle.json`, pinned in `pokemon_suite/game_resources.py`) was extracted from [pret/pokefirered at c75f352304d529f6ba92d4f74b9cf8b5c3810788](https://github.com/pret/pokefirered/tree/c75f352304d529f6ba92d4f74b9cf8b5c3810788) by a verified build that reproduces FireRed US revision 1. It records symbol addresses and structure layouts, map layouts, warps, connections and events, encounter tables, script control flow with flag, variable, item and trainer references, and trainer parties, moves, species stats and the type chart. It contains no ROM bytes, graphics, audio or dialogue text; all of those are read from the user's own ROM or not used. It ships only in the Mac app, not in the source release.

`data/champions.json` in the public tree is an explicit empty availability record. No Smogon set or analysis data is distributed. The farming form still accepts custom capture/evolution requirements. Existing saved references to unavailable presets require review; they are not silently replaced with a different build.

`PACKAGE-MANIFEST.json` records every exported file hash. `release/manifest.json` binds the reviewed build inputs; in an exported tree it binds the sanitized output bytes. Hashes establish identity, not ownership or a legal guarantee.
