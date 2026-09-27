# Pokémon transfers between generations

Research checked 2026-09-12. This is a feasibility plan, not a qualified feature list. The initial source review was followed by isolated tests of the installed DS core, Azahar room server and Switch emulator networking assembly. See [the local test results and Scarlet connection assessment](EMULATOR-TRADING-TESTS-20260912.md). Those tests did not exchange Pokémon or change the user's active saves.

There is no continuous, entirely emulator-local version of the official transfer chain. Native game transactions are practical through Generation V. Bank and HOME introduce authenticated external services. Generation II also has no original-game transfer route into Generation III.

Two current dates affect planning. Pokémon Bank ends service **26 February 2027 at 03:00 UTC**, including Bank→HOME transfers, according to the [official support notice](https://support.pokemon.com/hc/fr/articles/52629477077012-Banque-Pok%C3%A9mon-et-Pok%C3%A9mon-HOME). Nintendo schedules HOME connectivity for its **Switch FireRed/LeafGreen releases in October 2026**; it is not yet a completed route as of this review. See the [current Nintendo FireRed listing](https://www.nintendo.com/en-ca/store/products/english-pokemon-firered-version-switch/).

## Route map

| Route | Game mechanism and boundary | Emulator feasibility / Suite gap |
| --- | --- | --- |
| Same-generation GB/GBC/GBA | Ordinary link trade; game-specific unlocks, language/version compatibility and trade evolution rules apply. | Upstream mGBA provides same-computer link cable support. Suite's generic libretro frontend does not expose a cable connection. Its specialized FireRed/Emerald RFU path is separate. |
| Generation I ↔ II | Time Capsule is a backward-compatible link transaction. Parties must meet Gen I compatibility rules, including species/moves and no Eggs; verify each language pair and native unlock. | Implement the GB serial link and let the games validate and convert the records. Do not treat Generation II records as directly interchangeable with Generation I. |
| Generation II → III | No normal in-game route across this boundary. | An invented save conversion would not be an official migration. The 3DS Virtual Console route below is a separate branch, not a bridge into Ruby/Sapphire/Emerald. |
| Generation III → IV | One-way Pal Park migration; DS loads both the DS cartridge and GBA cartridge/save. Gen IV story unlock and transfer restrictions apply. | Strong first cross-generation candidate: melonDS DS already supports Slot 1 + Slot 2 + GBA save. Suite must expose the subsystem and persist both saves correctly. It does not require two simultaneously running game emulators. |
| Generation IV → V | One-way Poké Transfer. Destination runs the transfer lab; the source system boots DS Download Play with its Gen IV cartridge inserted. | Upstream melonDS local wireless provides the relevant foundation. Requires a second emulated DS, firmware-menu/Download Play boot, independent identities and source-save writes. A normal two-ROM trade room does not implement this. |
| Generation V → Bank | Poké Transporter reads Black/White/Black 2/White 2, then uploads into Bank. | Not a DS-to-3DS local trade. No authenticated Bank/Transporter implementation or successful emulator service session was found locally. Treat a supported physical 3DS handoff as a separate requirement. |
| Gen I/II 3DS Virtual Console → Bank | Poké Transporter supports the official Virtual Console releases; this is a one-way conversion into the later ecosystem. | Original GB/GBC emulator saves are not themselves an official Virtual Console installation or an authenticated Bank client. Do not infer service eligibility from save compatibility. |
| Generation VI ↔ VI; VII ↔ VII | Compatible versions can use local wireless trades. Version-specific species/forms/moves still constrain pairs. | Azahar has multiplayer rooms. Suite currently configures playback and per-game profiles, but has no room orchestration or qualified trade controller. |
| Generation VI → VII | Bank-mediated, one-way generational boundary; no direct XY/ORAS↔SM/USUM link trade. Pokémon taken into Gen VII cannot be returned to Gen VI through Bank. | Local wireless support does not implement Bank. Any offline converter would be a different provenance path. |
| Bank → HOME | One-way authenticated service transfer, HOME Premium required. | Official hardware/account workflow; not emulator-to-emulator networking. Bank closure is the deadline. |
| Switch game ↔ HOME ↔ compatible Switch game | HOME determines supported destinations. The individual must be supported by the destination; moves/forms and return rules vary. | Switch local wireless/LDN can support a game's ordinary trades, but does not provide HOME connectivity. Qualify each title pair separately. |

Sources: [mGBA feature list](https://github.com/mgba-emu/mgba#features), [Crystal Time Capsule code](https://github.com/pret/pokecrystal/blob/master/engine/link/time_capsule.asm), [Nintendo Diamond manual, Pal Park](https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/DS_Pokemon_Diamond?_a=DATC1RAAZAA0), [Nintendo Black manual, Poké Transfer](https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/DS_Pokemon_Black), [Nintendo Bank/Transporter compatibility](https://en-americas-support.nintendo.com/app/answers/detail/a_id/25449/), [Azahar 2126.0 release](https://github.com/azahar-emu/azahar/releases/tag/2126.0).

## What the current repository actually provides

- `pokemon_suite/pokemon_main_series.py` catalogs mGBA for GB–GBA, melonDS DS for DS, Azahar for 3DS and Ryubing for Switch. Catalog presence is not trade qualification.
- `native/libretro/suite_bridge.c` loads only `retro_load_game`, ignores subsystem descriptors after acknowledging them, and has no `retro_load_game_special` or netpacket callback implementation. Slot-2 migration and DS wireless therefore need frontend work even though the upstream core offers them. [melonDS DS documents both subsystem loading and libretro-based local multiplayer](https://github.com/JesseTG/melonds-ds#game-boy-advance-connectivity).
- `pokemon_suite/capabilities.py` declares experimental trade implementation only for the FireRed/Emerald WASM adapters. `pokemon_suite/suite_desktop.py` gives Azahar independent save profiles but does not configure multiplayer rooms.
- `native/suite-switch/README.md` identifies Ryubing 1.3.3 and Azahar 2126.0. Its Switch hooks carry display/audio/input/keyboard traffic, not HOME services.
- The sibling research project's `docs/NATIVE-SUITE-TRADING.md` records specialized RFU↔Switch LDN work and saved-exchange evidence with a historical interrupted exit. That evidence is specific to the documented cartridges, core and bridge. It cannot establish arbitrary Switch-game trading or cross-generation migration.

Upstream feature availability is an implementation lead, not evidence that these pinned local integrations support it. In particular, mGBA still lists networked link and Wireless Adapter support as planned upstream; Suite's RFU adapter is custom. [mGBA README](https://github.com/mgba-emu/mgba#planned-features)

## Service and provenance gates

Bank is free but new downloads ceased in March 2023. The supported move uses Bank on a 3DS and a short-lived HOME Moving Key, or transfers already stored Bank Pokémon through a linked NNID without the 3DS. The latter does not upload emulator saves. HOME requires a Nintendo Account; Premium is needed for Bank transfers. [Nintendo transfer instructions](https://en-americas-support.nintendo.com/app/answers/detail/a_id/48802)

HOME currently lists Switch-era games including Legends: Z-A and Champions visits. Let's Go Pokémon can return to Let's Go only until they visit another game. Switch HOME game connectivity and mobile HOME account/trading features are distinct. Check current compatibility per destination rather than using generation numbers alone. [Official HOME connectivity](https://home.pokemon.com/en-us/move/)

A native trade preserves a meaningful game-owned history; a valid species record alone does not prove that history. Preserve immutable source snapshots, game/core identities and the route taken. Record both games' native save completion, cold-reload results and expected identity transformations. For migrations, confirm removal from the active source as well as destination arrival; retaining a recovery archive must not silently reactivate a second lineage.

Local legality analysis is independent of official service acceptance. Transfer locations, origin, ribbons, moves and HOME tracking data must remain coherent; do not fabricate a HOME tracker or label a save conversion as an official transfer. PKHeX itself checks transfer-route constraints but does not prove server acceptance. See its [transfer verifier](https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/Legality/Verifiers/TransferVerifier.cs) and the existing sibling `docs/SHINY-LEGALITY-AUDIT-20260907.md`. This review does not certify online or tournament eligibility.

## Proposed order and acceptance evidence

1. Finish the existing Switch radio route and qualify complete normal save/exit on both sides. Separately inventory the owner's already available official Bank/Transporter path before its deadline; no account actions are implied by this research.
2. Implement Pal Park subsystem loading and dual-save ownership. Start with a compatible, unlocked Gen IV destination and a nonvaluable six-Pokémon test batch. Require source removal, all six arrivals, cold reload of both games, and recovery after an interrupted session. Preserve the target game's daily/language/HM restrictions rather than bypassing them.
3. Add a DS local-wireless frontend, first qualifying a same-generation trade, then Download Play and Gen IV→V Poké Transfer. Require independent firmware/MAC identities, matching language/game requirements, both native saves, and normal disconnect. [melonDS's upstream local-LAN design](https://melonds.kuribo64.net/comments.php?id=190) supplies the transport model; this review did not run a Pokémon transfer on the current build.
4. Add GB/GBC serial-link rooms and Time Capsule; add general Gen III cable support where the RFU route is not applicable. Qualify compatibility rejection and trade evolution alongside successful exchanges.
5. Integrate Azahar private rooms and compatible Gen VI/VII local trades, then title-specific Switch emulator local trades if supported by the selected build. Keep all Bank/HOME operations behind separately evidenced official service workflows.

Do not offer a universal “transfer up generations” action until its route planner can stop at unsupported or external-service boundaries and identify one-way steps before execution.

## Scarlet on an unmodified Switch

The installed Ryubing 1.3.3 networking assembly passed a private emulator-client transport test: two processes discovered and joined a room, exchanged 256 ordered payloads in each direction and disconnected normally. This did not run Scarlet/Violet or exchange Pokémon. The existing Violet profile has only the base game and no in-game save, so it is not ready for an in-game trade test.

RyuLDN supplies emulator rooms; ldn_mitm supplies communication with modified Switch software. Scarlet/Violet is not listed as supporting native LAN mode. The documented unmodified-console Pokémon LAN route is Sword/Shield, which has reported update-related connection problems. These are separate from Suite's custom Archer route. [Ryubing multiplayer guide](https://docs.ryujinx.app/guides/ldn-guide/)

An Archer route for Scarlet remains a plausible engineering project, not an enabled option: connect the Switch emulator's LDN service and guest socket traffic to the appliance's generic LDN transport. The current FireRed bridge translates GBA RFU into the Switch FireRed/LeafGreen application's protocol. Merely changing its game identifier would not carry Scarlet's game-owned traffic. [Generic Linux LDN implementation](https://github.com/kinnay/LDN)

For the existing FireRed collection, the announced October 2026 Switch FireRed/LeafGreen→HOME support may eventually provide a shorter official onward path to compatible Scarlet species. It has not launched as of this review. The physical FireRed→LeafGreen exchange already demonstrated by Suite establishes only that first leg, not future HOME acceptance.
