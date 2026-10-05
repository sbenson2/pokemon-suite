# Mac wireless trading and PC inventory

The native Mac app has a **Trading** destination in its sidebar. Choose FireRed in the game picker and choose the inventory in **Save**. It shows owned individuals in that save's party and fourteen PC boxes, including ordinary and shiny Pokémon. Search by species or Pokédex number and combine appearance, type and location filters. Selecting a box preserves its thirty slot positions; selecting an individual shows its nature, ability, held item, IVs, EVs and moves.

The Save selector includes the current game and preserved profiles in the same library. **Add Saved Game…** links a saved profile from another Suite library using its profile record or `current.json` checkpoint. Its own cartridge and emulator are verified before reading. The reference stays local; the save and its Pokémon are not copied, and browsing does not activate it over the current campaign. The selected save and appearance filter are remembered. A missing collection reports an error instead of silently showing a different save. Choosing Prepare Trade now validates the selected individual, opens the saved profile in its owning library, checks the radio, and revalidates the live owner before starting preparation. The current library and its campaign remain saved. The confirmation explains the save change; viewing a collection alone still has no effect on gameplay.

The **Bank** lists the same individuals for one species across every save at once. Its **Send to Switch** is this Prepare Trade flow for the current game; Pokémon in other saves show the browsing reason instead.

Sprites and shiny palettes come from the user's ROM. Inventory is a read-only view of the latest verified checkpoint, not historical catch receipts. An isolated local emulator loads that checkpoint without advancing the game, sending controls or writing its saves. The snapshot timestamp is displayed. Stored Pokémon levels and custom box names are not yet decoded; unknown levels are omitted and boxes remain numbered.

## Physical connection

The implemented FireRed route uses the Mac's game owner, its RFU-capable emulator and an Archer T3U USB adapter (USB 2357:012d). The integrated Mac build runs the Linux packet relay in an on-demand local VM. Games and saves remain owned by the Mac session. Ordinary Mac Wi-Fi is not a substitute for the USB radio.

Wireless readiness checks automatically while Trading is open. Missing hardware or console credentials produce setup instructions; there is no Check Connection button. Choose Console Keys stores the local file path, and only four required values enter temporary guest storage when a trade starts. Merely browsing the PC does not start the VM. The radio shuts down after the game completes its verified trade or cancellation exit.

The optional external Linux/SSH backend remains available through private `wireless.json` configuration (`transport: ssh`, `host`, `knownHosts`, and optional `bindAddress`). Its automatic check preserves SSH host verification. The bundled backend uses `transport: appliance` and `keysPath`, with no guest IP or SSH dependency. See [the implementation and qualification record](RADIO-RELAY-INTEGRATION.md) for current physical-trade evidence and limitations.

## Selecting and completing a trade

An eligible individual can be selected with **Prepare Trade**. The existing FireRed routine retrieves that exact individual, heals, saves in game, enters the Pokémon Center's Direct Corner and becomes Leader. Identity is revalidated in the live owning session using species, personality, original trainer and IVs. Moving between slots does not change the selection; duplicates, missing individuals, stale sessions and eggs are rejected.

The page reports preparation, lobby and exchange progress. Cancel is allowed while preparing or waiting for a partner. Once exchange has started, the worker and service reject stopping the lobby until the native exchange, save and exit handshake is complete. Existing retry logic handles pre-exchange timeouts; uncertain exchange outcomes are retained for resolution instead of being traded again.

In the trade menu, native rejection or cancellation messages end the current trade intent. The bot dismisses the message, selects Cancel, and completes the normal room exit while retaining the radio connection. It then waits for a new command instead of offering the same individual again. A linked partner's advertised National Pokédex progress is checked before offering a non-Kanto Pokémon. Cancellation has its own terminal state, requires the original party and unchanged trade count, and never produces a successful-exchange receipt. An interrupted exit remains unresolved instead of reconnecting or substituting another Pokémon automatically.

Readiness requires a qualified wireless emulator and compatibility cartridge, a uniquely identified individual owned by that session, and no unfinished story campaign, reserved evolution exchange or running bot task. An unrelated paused hunt does not block an already-owned Pokémon. Unsaved protected encounters and open menus still block preparation. Verified ordinary battles can finish through the normal player before travel begins. Owned trades have their own persisted task state and require a new verified native save; they do not invent capture evidence or mark the old hunt complete. A stock-ROM campaign is not silently migrated to another emulator or prepared save. Unsupported games explain their limits instead of showing an enabled trade action.

## Qualification as of 10 September 2026

The Mac/Linux hardware connection check passed with the Archer attached. Reading the active standalone FireRed campaign produced five party members and fourteen empty boxes. Automated coverage checks inventory identities, combined filters, HTTP authentication, stale sessions, native preparation, reconnect behavior and protected exchange cancellation.

The current standalone story campaign uses the ordinary emulator and is not trade-ready. Earlier native Suite-owned hardware evidence includes a received Pokémon saved on both sides, but the final exit was interrupted. Additional standby and exit handling was implemented afterward; a clean physical trade through the new Mac page still needs end-to-end verification with the qualified game configuration and a participating Switch. A successful connection check alone is not proof of a completed trade. Switch 2 has not been requalified by this check.

Mobile work is paused. This page and connection check do not establish standalone iPhone or iPad wireless support.

## Saved collection update — 11 September 2026

The prepare action is available for valid shiny and ordinary individuals in linked collections. A validated plan carries the owning library and profile; caller-supplied filesystem paths cannot substitute another source. Session and individual identities are checked again after loading. Restored RFU profiles retain their adapter selection in the active-save pointer so inventory reads and later launches use the same cartridge and core. The latest connection check passed using the VM bridge address; completing a physical trade with a participating Switch remains a separate verification.

An actual native-page test loaded the preserved collection of 159 Pokémon (104 shiny), selected shiny Umbreon in Box 1, and ran preparation through normal game controls. The worker retrieved that exact individual into party slot 6, healed the team, verified a new native save, and opened the Lavender Town Direct Corner as Leader. The radio reported active advertising as RED, trainer ID 08185, with no partner connected. The preserved collection archive and paused standalone campaign hashes remained unchanged. This verifies selection, preparation, and live advertising; receipt, save, and normal exit on a second game remain unverified in this test.
