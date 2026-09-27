# Standalone extraction — September 9, 2026

## Product boundary

Pokémon Suite is a separate application targeting macOS, Windows and Linux hosts. CPTR and AgentTV do not own its navigation, sessions, authentication, streaming, reports or startup. There is no required host-app integration in the new entry point.

```text
Browser interface
  └── Suite HTTP API (Python, authenticated local session)
        ├── game catalog, Pokédex, farming, run settings, reports
        ├── profile and save ownership
        └── one owner per game
              ├── Node + pinned mGBA WASM: FireRed / Emerald / Crystal
              ├── native libretro: GB / GBC / GBA / DS
              └── platform capture/input adapters: 3DS / Switch
```

`pokemon_suite/static/standalone.js` replaces the old gallery/player integration. It renders the same native game frames in a canvas, streams PCM audio after a user gesture, retains the photographed hardware surround, and feeds the existing trainer/team/hunt/bot panels. Selection persists in the profile; polling does not recreate an unchanged game view. The full page stays fixed, with bordered internal scroll areas.

`pokemon_suite/server.py` owns the localhost origin and proxies only named game feeds. Mutations require the current local session cookie and matching browser origin. No arbitrary proxy, host terminal endpoint or AgentTV plugin endpoint is exposed. Closing a browser does not end the game owner.

`engine/firered`, `engine/shared` and `native` contain the extracted source. The private development extraction manifest records the original allowlisted imports and is excluded from public exports. The research manifests retained in the engine describe its original evidence, not a certification of this new distribution. They are not the running bot's save files.

## Save and lifecycle changes

- New installations can create a cold ROM checkpoint without `cfg.seed`.
- A new-profile marker prevents Start game from attempting Continue before a native save exists. Existing save continuation checks remain enforced.
- Stop game pauses/checkpoints the bot, then sends a session-bound shutdown command to ordinary owners and waits for their lock to disappear. It does not rely on Windows process termination running a save handler.
- Active linked transactions retain the existing coordinated pause behavior. They are not independently torn down halfway through a trade.
- Native save/checkpoint identities remain bound to game, cartridge and core hashes.
- Cross-process locks use POSIX `flock` or Windows byte-range locking; Windows owner inspection uses a process handle rather than `os.kill(pid, 0)`.

The original running FireRed test was not migrated, stopped or reset during extraction. An isolated standalone profile was installed and used for the live canary. Its resources are private development data under `.local`, excluded from distribution.

## Qualification boundary

| Component | Current evidence | Remaining work |
| --- | --- | --- |
| Independent UI/API | Real Chrome, empty-profile and local-service tests on macOS | Windows/Linux execution; installers |
| FireRed WASM owner | Cold boot, command readiness, live pixels, manual takeover, simultaneous input, checkpointed shutdown | Windows/Linux native execution and clean-machine resource-pack installation |
| Emulator audio | PCM relay/player implemented | Auditory verification and disconnection/reconnection qualification |
| Bot logic | Extracted existing engine and its regressions | A new full campaign under this distribution; this extraction is not a full-game completion proof |
| Emerald/Crystal | Source retained; private Emerald adapter data supplied separately | Standalone setup and live qualification for each |
| Native GB–DS | Existing adapter retained | Core packages per OS/architecture; Windows bridge loader/build |
| 3DS/Switch | Existing macOS adapter retained; other hosts rejected explicitly | Windows/Linux capture, input, graceful native exit and firmware intake |
| Mobile browser | Viewport/layout checked | Authenticated pairing, remote transport, adaptive compressed streaming |
| Packaging | Reviewed source allowlist/checksums and neutral UI artwork | Runtime bundling, signing, updating, public release approval |

The next release milestone is one clean-machine setup on **each** desktop OS, starting with the same FireRed ROM/core/input checks. A release is not “all platforms supported” until each host passes boot, frame/audio/input, save/resume, shutdown and crash-recovery checks. Expand platform adapters behind the same API after that baseline.

## Moving the existing campaign later

The active test remains in its original owner. A deliberate migration should checkpoint and stop that owner, verify state/SRAM and controller identity, import into the standalone profile, then resume exactly once. An active campaign must not run concurrently from two writable copies. Export/import of complete profiles across machines still needs a path-rebasing and verification workflow; copying absolute-path configuration alone is insufficient.
