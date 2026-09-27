# Native Mac app

**Development scope, September 12, 2026:** Mac hosts emulation, automation, saves and physical trading. Priorities are FireRed campaign reliability, the PC inventory and complete trade routine using the existing Archer radio setup, and native Mac usability and release packaging. The [native mobile companion](MOBILE-COMPANION.md) provides iPad and iPhone access to this Mac; standalone mobile emulation remains paused.

Pokémon Suite has a SwiftUI/AppKit application for macOS 14 or later. Its library, live game, trainer/team panels, Pokédex, hunting forms, shiny collection and common bot tasks use native Mac controls. Game video is decoded directly from the owning emulator, audio uses AVAudioEngine, and keyboard input supports simultaneous directions and releases when focus leaves the game.

The app starts its own authenticated loopback service on an available port. Python 3.13, Node 22 and Pillow for desktop video conversion are bundled, with pinned archive hashes and upstream notices. Finder launch does not require Homebrew, a terminal, CPTR or AgentTV. The app also ships the FireRed bot resources: the pinned mGBA WebAssembly core and the game knowledge the bot plans with. You supply only your ROM. Firmware, keys and saves are never bundled.

## Use

Open **Pokémon Suite.app**. A first launch creates an empty library at `~/Library/Application Support/PokemonSuite`. Choose **File → Open Library** to reconnect an existing standalone Suite profile, or **Add FireRed** and choose your FireRed US revision 1 ROM. The app checks the ROM's SHA-1, verifies every bundled resource file against its pinned SHA-256, and copies both into the library, so moving or updating the app never strands an installed game. Configuration paths from an old development checkout are overridden for app-owned bot execution without rewriting the user's configuration.

Choose **Choose ROM Folder…** in Games or **Settings → Library** to catalog a collection containing `gb`, `gbc`, `gba`, `nds`, `3ds`, and `switch` subfolders. Raw cartridges and ZIP archives can supply artwork without running an emulator. Games with a recognized source show **ROM found**; playing still requires an installed emulator integration. Details show the available graphics for each cartridge. If macOS requests removable-drive access, allow access to the collection you selected.

The native team and Pokédex use the selected cartridge’s Pokémon pixels and shiny palettes. Trainer portraits, badges, held items, and the selected capture ball also use qualified local ROM readers. The Games library has a native 3D cartridge grid and compact list. GBA/Crystal use ROM mascots; DS uses distinct battle mascots; 3DS uses its native icon. Labels include each version’s title and, when available, the Pokémon wordmark from your Emerald ROM. Compatible local sprites may identify older games. These are original models and composed labels, not retail sticker scans. Hover gently lifts a cartridge; Reduce Motion and inactive windows disable the animation. Details explain artwork coverage. Availability checks run in the background so a slow drive or permission prompt does not block the library. See [ROM resources](ROM-RESOURCES.md) for tested revisions and remaining format gaps.

Start and Stop buttons are in Games and the live trainer panel. Start resumes the game and readies the bot for a command; saved unfinished campaigns retain their existing resume policy. Manual Play pauses automation before accepting keyboard input. Starting a task hands control back to the bot. New full-game runs require a team preview and a separate Start action.

Closing the window keeps the service and bot available; click the Dock icon to reopen it. **Quit Pokémon Suite** uses the existing save-and-close protocol. If a linked trade can only pause, Quit keeps the app open and explains why. An unexpected app exit attempts the same protocol and preserves an owner that cannot safely close. Save profiles remain outside the application bundle, so replacing the app does not replace saves.

The native Hunting page supports species, nickname, shiny, ball, nature, gender, ability, IV/DV, encounter/final level, moves, held item and search limits. The existing backend validates acquisition routes and prerequisites before execution. Game catalog presence does not imply all games have working automation.

Hunting defaults in **Bot settings → Hunting defaults** apply to new drafts. Farming keeps a separate draft for each game and Pokémon across navigation and app restarts. **Review** reopens a queued request; the action label distinguishes a hunt, source acquisition and evolution preparation. **Farming → Build** can attach builds from an installed competitive catalog. Community presets are intentionally absent from the public package; opening the browser does not supply them. User-entered traits and training settings remain available.

**Farming → Hunt** and **Live game → Hunt** show the method, phase clocks, RNG input progress, protected-shiny status and evolution preparation when the engine publishes them. **Bot settings → Activity → Progress** separates the postgame checklist, collection progress and PC capacity. Unknown telemetry is shown as unavailable. Live team members show their HP, held item and XP progress; move details and PP are available in the Pokédex and PC inspector. The current live party feed does not publish move-by-move PP.

**Bot settings → Saves** creates a blank manual game or restores a named profile after confirmation. The engine backs up the current profile first. **Activity → Reports** reads current stops and saved recovery/campaign reports, exports a support bundle with decision history, and copies a repair prompt for a coding session. **Stop & Export** requests a bot stop after a destination is chosen; cancellation does not stop the bot. No repair prompt is sent to an external service automatically.

## Mac interface and keyboard

**Pokémon Suite → Settings…** (Command-comma) opens a separate window with General, Library, and Support panes. Appearance defaults to the system setting. The app uses semantic system colors, your Mac’s accent, native menus and controls, and bordered internal scroll areas. See the [Apple HIG review](MACOS-HIG-REVIEW.md) for design decisions and verification limits.

Use **View** or Command-1 through Command-6 to move between the six main pages. The standard sidebar control and View menu can hide or show navigation. The main window has a minimum content size of 1100 × 680 points so the game and its details remain usable together.

In **Manual Play**, choose **Focus Game** or click the screen. Move with arrows or WASD; Z/X press A/B, Q/E press L/R, Return presses Start, and Space presses Select. DS and later add C/V for X/Y. 3DS/Switch use WASD and IJKL for the two sticks, and F/G for ZL/ZR. Click or drag the lower DS/3DS screen for touch input. The native viewer uses [Apple’s extended gamepad profile](https://developer.apple.com/documentation/gamecontroller/gcextendedgamepad): right and bottom face buttons map to Nintendo A and B. Controllers require the manual game surface to have focus. Tab, Shift-Tab, Escape, loss of focus, or leaving manual play releases inputs. Button, stick and touch holds refresh every 200 ms; the emulator retains its timeout fail-safe. On-screen buttons support keyboard and accessibility activation. Physical controllers and each desktop emulator still require hardware qualification.

**Farming** has a searchable species chooser and a fixed Preview / Queue / Start action row. Catch, traits, training, limits and competitive builds use separate sections. **Pokédex** includes regional/national scope, type and encounter availability filters, evolution links and detailed moves. Emerald opens with its 202-entry Hoenn dex. **Bot settings** separates tasks, shiny collection, new runs, saves, hunting defaults, and activity. New runs require a preview and a separate Start action.

## Build

On a matching Mac architecture with Xcode and Python 3.12+ installed:

```sh
swift test --package-path macos
python3 -m unittest discover -s tests -v
python3 scripts/build-macos.py --verification /path/to/report.json --engine-package /path/to/published-engine.pksuite --firered-resources /path/to/firered-resources
```

`--firered-resources` names a folder with `core/build-manifest.json`, `core/mgba.js`, `core/mgba.wasm`, `runtime.json`, `world.json`, `story.json` and `battle.json`. Every file must match its pin in `pokemon_suite/game_resources.py`, and nothing else may be in the folder. The builder copies the pack to `Contents/Resources/GameResources/firered/`, with the mGBA license and source notice in `GameResources/licenses/mgba/` (Settings → Support → Emulator License). It also writes `pokemon-suite-0.1.0-firered-resources.zip`, the same pack for running from source: unzip it and choose its `firered` folder.

The builder verifies `release/manifest.json` before copying source, downloads the checksum-pinned runtimes in `macos/runtime-lock.json`, builds Swift in release mode, generates an original cartridge icon, signs locally, and writes the application, ZIP and SHA-256 checksum under `dist/macos-0.1.0`. It refuses to replace an existing output folder. Use `--output` for another build.

Reuse the exact published engine capsule for UI or host changes. The builder checks its files against the reviewed engine source. For changed engine code, use `--engine-version` with a new release version instead. Both paths require a current complete verification report.

The app payload uses the same reviewed source exporter as the public source ZIP. It strips game prose and external sprite paths from catalogs and excludes ROMs, saves, research inputs, boot videos, private resources and vendor game data. Runtime binary dependencies and their license texts are added separately from the pinned official release archives.

The initial build targets Apple Silicon. Intel builds must be built and exercised on Intel before release. The local app is ad hoc signed, not Developer ID signed or notarized. Public downloads need a separate signing/notarization step for ordinary Gatekeeper installation; this build does not claim App Store readiness.
