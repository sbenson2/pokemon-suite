# Preparing the source release

This release candidate includes a local browser UI, Python service, Node bot engine, and a native SwiftUI/AppKit Mac app. It is not a hosted service. The Mac app bundles its service runtimes; see [native Mac build and qualification](MACOS.md). No GitHub repository or release is created by the build.

## Version numbers

The Mac app's version is `APP_VERSION` in `scripts/build-macos.py`. It sets the app's `CFBundleShortVersionString` and names both release archives, `pokemon-suite-<version>-macos-<arch>.zip` and `pokemon-suite-<version>-game-resources.zip`, so a new version number changes there only. `APP_BUILD` beside it is the app's `CFBundleVersion`; raise it for every build that is installed. The iPhone and iPad app keeps its own version and build number (`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `native/ios/build-companion.py`).

## Source export

Run `python3 scripts/package-source.py --output dist/pokemon-suite-<version>-source.zip` after reviewing the input manifest. It writes that ZIP and its matching `.zip.sha256` checksum. Extract the ZIP into an empty directory, such as `dist/release-<version>`. Its `pokemon-suite` directory is the candidate public repository root. Always extract the current archive into a fresh directory; do not reuse an older candidate tree. Do not publish the development workspace wholesale: excluded research assets may remain there for local work.

The exporter excludes game sprites and audio/video, the Emerald vendor tree, private directories, ROM/save/key files, emulator binaries, the legacy branded/fallback SVGs, the extraction script, and historical audit inventories. It preserves licensed hardware photos and their credits, the libretro API header and Ryujinx notice, and the PokéAPI notice. It strips game prose from the four factual catalogs, directs sprite paths to the local ROM reader, and substitutes an empty competitive-preset catalog. The working source data is not overwritten. The decoder caches image bytes only in bounded process memory; no extracted sprite directory is generated or included in packages.

Every included input must appear in `release/manifest.json` with its reviewed SHA-256. Adding or changing an eligible file causes packaging to fail before replacing an existing ZIP or checksum. After reviewing a change and its provenance, update the affected entries. There is intentionally no build flag to ignore a mismatch or include restricted content. Exported trees receive a manifest for their actual sanitized bytes and can rebuild without the development resources. ZIP timestamps can differ; compare contained file hashes. The checksum is regenerated from the completed ZIP on every successful export.

RC3 reconciles the current FireRed campaign work and standalone adaptations. The earlier RC2 ZIP was rebuilt with those engine changes while its separately maintained checksum and extracted directory remained older; use RC3 as the reconciled candidate. See [bot reconciliation](BOT-RECONCILIATION.md).

Use these checks from the candidate directory:

```sh
python3 -m unittest discover -s tests -v
npm test
npm run test:browser
python3 scripts/package-source.py
python3 -m pokemon_suite --data-dir "/path/to/empty-test-profile" doctor
```

Chrome is needed for the browser check; `CHROME_PATH` selects its executable. An absent Chrome skips that check and is not browser qualification. The full FireRed regression suite is `npm run test:engine`; optional emulator qualification requires the exact private resources named by its tests. Do not run an explicit live canary against a real campaign's profile.

The bot's intake is FireRed or LeafGreen (English revision 1) from the user's own verified ROM. The Mac app ships the pinned emulator core and each game's knowledge pack (`pokemon_suite/game_resources.py`); running from source needs the same packs from the release's game-resources archive. Empty-profile startup and catalog browsing do not require them. No ROM, BIOS, save or game artwork is distributed.

Emerald's experimental adapter accepts `POKEMON_SUITE_ADAPTER_DATA`, pointing to a local directory containing `pokeemerald/` and `pokeemerald-symbols/` at the pinned revisions. Its loaders resolve headers, maps, character data, and symbols there. The development-only fallback is `engine/shared/vendor`, which is absent from the public export. This is an input boundary, not permission to redistribute the data. Standalone Emerald installation and full gameplay remain unqualified. Crystal's legacy default archive location is now `POKEMON_SUITE_CRYSTAL_ROM`; configure the matching private game/adapter inputs before using its experimental CLI.

The optional radio adapter expects the remote user's `pokemon-suite-radio` directory and locally supplied key path under that remote home. No machine-specific user name or private path is embedded in the public command. Its server, firmware/keys, physical transport, and original linked-game setup are not distributed or qualified by this release.

Before publication, review the actual candidate and license scope, verify a fresh installation on each claimed host OS, and decide which experimental features to advertise. macOS is the exercised host; Windows/Linux end-to-end playback, all-game support, audio listening checks, signed installers, bundled emulator compliance, and a new uninterrupted campaign are not established by source packaging or CI configuration. MIT applies to contributors' original work; third-party rights and trademarks remain separate. The candidate is not a legal clearance opinion.
