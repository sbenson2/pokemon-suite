# Emulator trading: local tests and physical Switch routes

Checked 12 September 2026 on the existing Apple Silicon Mac installation. The target is Pokémon Suite, with its lightweight Archer radio appliance; UTM remains stopped.

## Findings

The installed emulator components provide foundations for trades through the Switch generation. Suite does not yet connect all of those foundations into game transactions. Three distinct operations need separate handling: ordinary trades within compatible games, one-way migrations between generations, and transfers through Bank/HOME.

For the user's physical Scarlet, emulated Violet is a reasonable target for further implementation. A direct connection to an unmodified Switch is not available through the installed emulator's standard multiplayer settings. Extending the Archer bridge is plausible, but has not been implemented or physically tested. The currently working FireRed bridge is specific to Switch FireRed/LeafGreen.

No new Pokémon exchange was performed during this investigation. Tests used scratch DS profiles and synthetic multiplayer clients; they did not modify the user's existing Pokémon or game progress.

## What actually ran

| Test | Observed result | What this does not establish |
| --- | --- | --- |
| Existing Gen III local-link and evolution regressions | 25 tests passed, including paired session ownership, link lifecycle and evolution continuation. Tests use fake peripherals and local sockets. | A fresh full FireRed↔Emerald game exchange. |
| HeartGold with FireRed in emulated GBA Slot 2 | The installed melonDS DS core accepted `retro_load_game_special`, booted 360 frames and rendered the actual HeartGold copyright screen at 256×384. It reported a native rate of 59.826 Hz. | Pal Park access, reading a GBA save, six-Pokémon migration or saving both cartridges. No GBA save was supplied. |
| Black 2 boot and DS networking API | The same core booted 360 frames at 256×384. Both DS tests requested libretro's netpacket interface. | A connected pair, Download Play, timing reliability or Poké Transfer completion. The diagnostic frontend declined the network interface. |
| Installed Azahar 2126 private room | A password-protected room opened a UDP socket, remained live, accepted its normal `Q` shutdown and exited with code 0. No public announcement credentials were configured. | Two 3DS clients joining, an actual Pokémon exchange or physical 3DS compatibility. |
| Installed Ryubing 1.3.3 LDN networking | Two separate processes using the original installed networking DLL discovered a private room, joined, exchanged 256 sequence-checked payloads each way, then disconnected and destroyed the room. Both exited with code 0. Host membership was 1→2→1→0. | Running two Pokémon games, a trade/save handshake, physical Switch connectivity, Nintendo Switch Online or HOME. |

The Switch test used the upstream [LdnServer](https://github.com/Ryubing/LdnServer) implementation bound to loopback, with P2P disabled and no public matchmaking. Its synthetic game intent was Violet; that identifier is not proof of title compatibility. A small reflection harness loaded the installed `Ryujinx.HLE.dll` and exercised its actual `LdnMasterProxyClient` and packet encoder. The game emulator assembly was not patched. The server's optional Redis statistics service was unnecessary for this isolated transport test.

Azahar's normal `--room --help` invocation fails before entering the room parser. Inspection of the pinned upstream launcher shows the earlier compression-option parser consuming letters from long options. The room entry also appends to the `argv[0]` buffer. A temporary argument layout allowed the lifecycle probe to run; this workaround is not a production launcher. Suite integration needs a corrected, tested entry point or a separately built room executable. Source: [Azahar 2126 launcher](https://github.com/azahar-emu/azahar/blob/2126.0/src/citra_meta/main.cpp), [option parser](https://github.com/azahar-emu/azahar/blob/2126.0/src/citra_cli/citra_cli.cpp), [room entry](https://github.com/azahar-emu/azahar/blob/2126.0/src/citra_room/citra_room.cpp).

## How far transfers can go

The full game-by-game mechanism table is in [Generation transfers](GENERATION-TRANSFERS.md). The boundaries relevant to implementation are:

| Games | Mechanism to implement | Current boundary |
| --- | --- | --- |
| Red/Blue/Yellow ↔ Gold/Silver/Crystal | GB serial link and Time Capsule, with the games enforcing backward compatibility | Suite's generic frontend has no serial-link orchestration. There is no original-game Gen II→III transfer. |
| Ruby/Sapphire/Emerald/FireRed/LeafGreen | Compatible cable or RFU trades | Custom FireRed/Emerald infrastructure exists; generic GBA linking remains separate. |
| GBA → Diamond/Pearl/Platinum/HeartGold/SoulSilver | Pal Park: one DS with two cartridges and both native saves | Slot-2 loading passed; production frontend and dual-save transaction handling are missing. |
| DS Gen IV → Black/White/Black 2/White 2 | Poké Transfer: two DS instances, source Download Play, destination transfer lab | Netpacket transport, firmware boot, identities and full game/save choreography are missing. |
| X/Y/Omega Ruby/Alpha Sapphire; Sun/Moon/Ultra Sun/Ultra Moon | Local trades within compatible generations | Private room startup passed; game clients and Suite controls are unqualified. VI→VII uses Bank, not a direct local trade. |
| Switch Pokémon games, including Scarlet/Violet | Each game's supported local trade; cross-title moves where HOME allows them | Emulator transport passed. Physical Scarlet and all newer game transactions remain unqualified. |

The official original-generation chain reaches Gen V locally, then encounters Poké Transporter/Bank authentication. This does not mean Suite has completed Gen III→V migration; those are implementable native mechanisms awaiting integration and game-level tests. The 3DS Virtual Console route for Gen I/II is a separate official branch.

Bank ends on **26 February 2027 at 03:00 UTC**, including Bank→HOME transfers. It cannot serve as a permanent future dependency. [Official Pokémon support notice](https://support.pokemon.com/hc/fr/articles/52629477077012-Banque-Pok%C3%A9mon-et-Pok%C3%A9mon-HOME)

Nintendo schedules Switch FireRed/LeafGreen HOME support for **October 2026**. Once released, the potential short route for the current collection is **Suite FireRed → physical LeafGreen → HOME → compatible Scarlet Pokémon**. Only the first leg has been demonstrated. HOME eligibility and destination support must be checked when that integration launches. [Nintendo announcement in the FireRed listing](https://www.nintendo.com/en-ca/store/products/english-pokemon-firered-version-switch/), [HOME destination compatibility](https://home.pokemon.com/en-us/move/)

## What Scarlet needs

The owned collection contains Violet's base release; no Scarlet image or Violet update was found in the inspected collection. The configured Violet and Sword profiles contain emulator save-container metadata, but no native in-game save. No existing game progress was replaced. Scarlet's physical version and readiness were not inspected while the user was away.

Ryubing offers RyuLDN for emulator peers and ldn_mitm for modified Switch peers. Its guide does not list native LAN for Scarlet/Violet. Sword/Shield has a documented LAN route but also update-related problems. Versions must match, and Scarlet/Violet needs progress to the first Pokémon Center before Poké Portal is available. [Ryubing multiplayer guide](https://docs.ryujinx.app/guides/ldn-guide/)

The proposed Archer implementation has two connected parts:

1. Implement an emulator `INetworkClient` that maps scan, create/join, membership, advertisements, network identity and disconnect to the guest's LDN transport. Respect each game's protocol identifiers and versions.
2. Route the emulated game's BSD socket traffic through the guest TAP/IP network. The game should produce its own trade protocol and save operations. Carrying discovery alone would recreate the earlier “visible trainer, unavailable connection” symptom.

The existing guest supplies Linux, the Archer driver and generic LDN radio access. The missing adapter is above that transport. Its feasibility follows from the installed emulator interfaces and [the generic Linux LDN implementation](https://github.com/kinnay/LDN); it is an engineering inference, not a successful Scarlet experiment. Do not substitute the FireRed title ID or serialize Pokémon records directly into the link.

## Implementation and qualification order

1. Retest consecutive FireRed↔physical LeafGreen exchanges on the new permanent-neighbor runtime, including normal refusal, cancellation and return to the lobby. This needs the physical partner and remains pending.
2. Add a private, app-owned Switch room lifecycle using the now-tested networking path. Use independent game profiles and matching owned updates; progress both games normally to trading access. Qualify an actual trade before advertising Switch emulator trading in Suite.
3. Build the generic Archer emulator adapter and test discovery, admission, bidirectional game traffic, refusal, exchange, both saves and normal exit with physical Scarlet. Preserve evidence of each boundary rather than treating room presence as success.
4. Implement Pal Park's subsystem loading and dual-save ownership, then DS local wireless and Poké Transfer. These enable the useful older-generation migration chain.
5. Integrate corrected Azahar rooms and GB/GBC linking. Keep Bank/HOME handoffs explicit and separate from local emulator routes.

Every exchange must leave both games' native saves verified before releasing their owners. A one-way migration also needs source removal and destination arrival verified after cold reload. An interrupted exchange cannot automatically reoffer the original Pokémon or reactivate an archived source. No save conversion, fabricated HOME tracker or duplicated lineage should be presented as an official transfer.

## Current FireRed recovery and retained evidence

App build 29 and engine build 28 recovered the actual second exchange to Lavender Pokémon Center 2F. The saved result was retained; the native SRAM hash did not change during recovery. The trade is marked `interrupted`, not a verified normal exit. The black screen was caused by pausing before the ROM rendered its error screen. The installed lightweight runtime now verifies permanent neighbor support before advertising. A new physical trade on this runtime has not been tested. See [the recovery evidence and limitations](RADIO-RELAY-INTEGRATION.md#second-exchange-saved-result-interrupted-room-exit).

The current inventory contains two entries with the received Chansey's identical fingerprint. They were already present in the saved result before recovery. Neither was edited or removed; that provenance question must be resolved before using them as onward-transfer test subjects.

Local artifacts are retained under `.private/generation-transfer-tests-20260912/` and excluded from the source release. They include the DS diagnostic bridge and boot frames, private room logs, Switch client/server harnesses, packet results and source inspection. No ROMs, user saves, firmware or keys are added to the release manifest.

| Pinned test component | Identity |
| --- | --- |
| melonDS DS core SHA-256 | `028c1d65db6eeafef33b29a90018fe037fcf0f643965031f3eb4a8b1ca23b57a` |
| Azahar executable SHA-256 | `2ac65cef8a1824c8d53489f5896e824a35bf4aab3ce5b078009f867b4e2f4b6d` |
| Installed Ryujinx.HLE.dll SHA-256 | `e7b38651e2aaf1894ef4840b141f002d3a5bed5a157a9c52f6284938e6dcda8b` |
| LdnServer source commit | `ba32bcf0878184b3f30b3db4e2d3888a08aa17dc` |
