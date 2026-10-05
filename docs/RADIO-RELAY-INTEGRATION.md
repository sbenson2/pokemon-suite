# Integrated Mac wireless relay

Local development status, 11 September 2026. The small guest boots, advertises a lobby and has passed synthetic relay checks, but physical Switch 2 attempts have failed before an exchange. It is not qualified as a replacement for the original UTM relay. A complete Chansey trade has now passed using the original relay in a disposable UTM session after restoring USB 2 mode and fixing reconnection defects; see the final entry. The smaller appliance still needs a separate physical retest.

## App behavior

Trading checks readiness automatically while its PC inventory is open. It reports missing runtime, console key file or Archer hardware with the action needed. There is no Check Connection button. Choosing a console key file stores its local path; opening inventory does not boot Linux or reserve the adapter.

Prepare Trade retains the existing individual selection, retrieval, healing, native save and leader-room workflow. The game owner starts the relay on demand. Engine build 24 advertises this transport capability; older owners receive an update instruction instead of appearing compatible. Existing campaigns retain their selected engine package. The new runtime is bundled through the Mac app update; independent radio-pack updates are still future work.

The bridge grants one owner an exclusive adapter lease. The guest has one CPU, 512 MiB RAM, and no display, virtual network interface, disk, SSH server or shared host folder. Only USB `2357:012d` is passed through. Games and saves stay with the native Mac emulator.

Four protocol key values are validated on the host and provisioned through the private socket into a mode-0600 file in guest temporary memory. Key contents do not appear in process arguments or logs. The file is removed when the relay ends; guest shutdown discards its filesystem. The full user key file is not shared. The user approved provisioning these four values for the local physical trade test; no additional credential destinations are authorized by this document.

Owner EOF is translated to an explicit stop message. A Unix socket half-close alone did not reliably deliver EOF through virtio-serial. The host therefore keeps the return channel open until the guest responds and powers off, with bounded failure cleanup. The game controller's existing accepted-exchange/save/room-exit guard remains responsible for deciding when normal stop is allowed. A process or hardware failure during an exchange cannot establish success.

## Evidence

- Existing relay, peer, session and transport tests inside the guest: 18 passed.
- Synthetic host-to-guest test: available with advertising false, stopped acknowledgement, host exit 0.
- Actual JavaScript `NativeRadioLink` → packaged Python bridge → bundled QEMU → relay: available in 2,849 ms, two seconds of idle heartbeat, explicit close and process exit 0 after 4,957 ms total. No RFU discovery or game data was supplied.
- Complete runtime payload before its manifest: 108,586,349 bytes across 31 files. This includes relocated QEMU and libraries, kernel and relay initramfs. It excludes games, saves and credentials.

These timings are individual development measurements, not latency guarantees or active-trade benchmarks. Monitor/AP capability and relay startup do not prove LDN discovery or exchange reliability. Physical Switch and Switch 2 tests must each verify receipt, native saves, normal disconnect and cold-reload persistence. Hotplug, host load and interrupted exchange remain qualification work.

## Build inputs and local packaging

The initial image extends the Alpine 3.24.1 aarch64 probe described in [the guest README](../native/radio-appliance/README.md). In a disposable Linux builder, unpack the probe's `rootfs.cpio`, install Python/pip in that temporary root, and install the versions below under `/opt/radio-deps`. Copy the reviewed relay into `/opt/relay`, the patched `pokeldn` and `ldn` packages into `/opt/protocol`, `guest_probe.py` and `guest_relay.py` into `/opt/suite`, and `relay-init` as executable `/init`. Repack using newc cpio and gzip. The build folder and package-download networking belong only to the builder.

The qualified local inputs were Python 3.14.7, kernel 6.18.35-0-lts (later replaced; see the local.7 entry: the shipped kernel is Ubuntu 6.8.0-138-generic), pycryptodome 3.23.0, trio 0.33.0, zstandard 0.25.0, python-netlink 0.0.15, attrs 26.1.0, idna 3.19, outcome 1.3.0.post0, sniffio 1.3.1 and sortedcontainers 2.4.0. Protocol base: `Decryptu/frlg-ldn-trade` revision `d68be4d1985a9b9cad5d881e9b1221b8cbe76037`, with the existing locally reviewed compatibility patches. Those patches and dependency archives must be independently inventoried before a reproducible public release.

Stage relocated QEMU as described in the README. Add `guest/vmlinuz` and `guest/initramfs.cpio.gz`, then create `radio-manifest.json` with schema `pokemon-suite/radio-runtime/v1`, a version, `qemu`/`kernel`/`initramfs` entrypoints, and each file's relative path, SHA-256 and byte count. The app builder copies only manifest-listed files and rejects common key/game/save extensions. It verifies hashes, preserves QEMU's hypervisor entitlement while signing, and updates payload hashes after signing.

```sh
python3 scripts/build-macos.py \
  --verification /path/to/report.json \
  --engine-package /path/to/published-engine.pksuite \
  --output /path/to/new/mac-build \
  --radio-runtime /path/to/RadioRuntime
```

This is a local, ad-hoc signed development package. Public redistribution still needs corresponding source and notices for QEMU, the AGPL trade transport, GPL LDN and other dependencies, firmware review, reproducible inputs, Developer ID signing/notarization and clean-machine qualification. The Suite source license does not replace those component licenses. No UTM disk is a packaging input.

## First physical-lobby attempt: encrypted AP startup

The real-credential idle test passed, but the first game-driven lobby attempt failed before advertising: nl80211 returned ENOENT while installing its CCMP key. The initial image omitted dynamically requested kernel crypto modules; the static wireless-driver dependency closure was insufficient. The guest build now includes ccm, the ARM64 AES-CCM acceleration modules and algif_aead with their dependencies. Its startup check opens the kernel ccm(aes) implementation and installs a synthetic key before reporting availability. Missing crypto now fails at startup with a concise runtime error. The unchanged Chansey party left the desk through the native cancellation routine, with exitVerified recorded before shutdown. Runtime revision local.2 contains the correction; physical exchange qualification remains pending.

### Partial Switch join recovery

The first physical appliance test reached LDN association but a retry stalled before Pia session admission: NET acknowledged, session false, no native remote player. Previously this `player-connected` phase bypassed all setup deadlines and left the lobby busy indefinitely. The engine now retries a stalled pre-admission join after one minute through its existing native-save continuation and radio teardown. Waiting for a player without an association has no deadline. Session admission, native membership prompts, cancellation, and accepted exchanges are excluded from this recovery. A normal lobby cancellation and fresh advertisement were verified with Chansey unchanged and trade count five. A completed physical exchange remains unverified.

### Comparison with the working UTM guest

After Switch error 2318-0006, the instrumented relay reported 122 core frames produced and 89 sent in 9.433 seconds, with six frames awaiting acknowledgement and a maximum protocol tick gap of 19.392 ms. The outgoing queue stopped at its existing limit before any exchange. This is an acknowledgement/send-window stall, not evidence of a slow protocol timer.

A read-only inspection of the stopped UTM disk compared the installed native relay, Pia/Reliable code, transport, and editable LDN package byte for byte against the appliance; those source files match. UTM configured USB 3 and two CPUs. Its boot log identifies Ubuntu 6.8.0-138-generic as the kernel used during the working sessions. The newer 6.8.0-139 kernel had been installed but lacked the extra wireless modules; selecting the newest installed kernel would not reproduce the working environment. The original guest had no rtw88 mode configuration file, and the 6.8 driver has no switch_usb_mode parameter. USB 3 was therefore not established as the regression's cause.

The local comparison pack uses only the old 6.8.0-138 kernel, required module dependency closure, and Archer firmware, read from the original disk without booting or modifying it. It retains the new appliance's 512 MiB, single CPU, isolated userland and relay diagnostics. Its 18 relay regressions, synthetic-key startup, hardware qualification, and normal shutdown passed. The pack is an experimental comparison; physical trade completion remains unverified.

### Restore the complete AgentTV radio path for comparison

The kernel-only comparison also failed for the user: RED continued transmitting discovery beacons, but the relay recorded no initial association or Pia negotiation. This did not qualify the smaller appliance. The unconnected lobby was cancelled through native inputs, with room exit verified and Chansey unchanged at native trade count five.

The original `frlg-ldn` UTM guest is temporarily running with `-snapshot`, so guest disk changes are discarded. Its default boot selected the newer 6.8.0-139 kernel; a one-boot GRUB selection inside the disposable session restored the actual working 6.8.0-138 kernel. The Archer is attached through UTM's Spice `usb-redir` path. The appliance used QEMU's direct `usb-host` backend, and its bundled QEMU does not include `usb-redir`; the two USB paths must not be treated as equivalent without physical testing. The full reference also restores its original two CPUs, 2 GiB allocation and Python userland, so any successful reference test isolates the replacement as a whole, not one individual cause.

The original guest's 18 relay regressions passed, its Archer interface and pinned SSH connection were verified, and the Mac app reopened RED's Leader lobby with the same captured Chansey. Only the local wireless transport setting changed to `ssh`; its previous value is backed up privately. AgentTV itself remains retired, and the current Mac emulator owns the game and save. This is a temporary reference route, not completion of the lightweight packaging work. A new full Switch trade remains unverified.

### Physical USB mode was not restored by the VM comparison

The complete UTM reference reached Pia Session finalization, exchanged player information and entered the native trade room. It then failed before any exchange. Read-only inspection of the preserved error checkpoint recovered `sLinkErrorBuffer.status = 0x00330100`: Link Manager message 0x33, link recovery failed and disconnected, for slot bit 1. Both recorded native queue counts were zero. The game safely cancelled afterward, retaining Chansey and native trade count five.

The archived original guest kernel log establishes a difference the configuration comparison missed: on 6 September the actual Archer enumerated as a **high-speed USB device**, `bcdDevice=2.10`, on the USB 2 bus. No later SuperSpeed enumeration appears before the original VM was stopped. The reference restart instead enumerated the same adapter as **SuperSpeed**, `bcdDevice=3.00`; the Mac reports `UsbLinkSpeed=5000000000`. UTM's USB 3-capable controller setting did not establish the device's original operating mode. The original driver/kernel therefore does not by itself recreate the previously working hardware state.

The 6.18 driver's switch option only prevents initiating USB 3 mode; it does not switch an already-SuperSpeed adapter back. The installed appliance supplies `rtw88_usb.switch_usb_mode=N`, and the reference 6.8 driver lacks this automatic mode switch. The user was instructed to physically disconnect the safely released adapter for five seconds and reconnect it. After the physical reconnect, the Mac reported 480,000,000 b/s and the guest reported speed 480 with USB version 2.10. The previous hardware mode is now restored. A complete trade still needs verification before attributing the failure to this mode difference.


### Reconnection fixes and app build 27

The physical reconnect renumbered the Archer from `phy0` to `phy1`. The SSH relay had assumed `phy0`, so the next lobby failed before radio startup. Its default now finds the wireless PHY by the Archer USB identity `2357:012d`, follows device ancestors, skips disconnected entries, and rejects ambiguous multiple adapters. Explicit PHY selection remains supported. Tests cover renumbering, an unrelated PHY, disconnection, duplicate adapters, a missing adapter, and the actual host transport call. All 30 relay tests passed. The canonical relay source and temporary reference guest contain the change; the appliance already passes its explicitly discovered PHY.

Repeated setup failures also exposed an expired timer surviving `NativeTradeHost.reconnected()`. A new connection now clears both setup and join start times, so each attempt receives its full setup deadline. A regression first reproduced the immediate timeout, then passed with the correction. The combined native trade and radio JavaScript suite passed all 54 tests.

Build 27 was installed through the normal app-bundle update, with engine `0.1.0-build.26` selected for FireRed. The previous trade was cancelled and its room exit verified before the app relaunch. The engine was installed from the signed app resources; no development signing key was added to package trust. The running owner reports the new engine digest and reopened the same captured shiny Chansey. These checks establish the two reconnection corrections, not successful physical exchange qualification.


### Completed Switch 2 trade on the restored reference

At 06:50 UTC on 12 September (11 September locally), build 27 / engine 26 completed the selected shiny Chansey exchange with Switch 2 LeafGreen. The actual Archer remained on `phy1`, speed 480 Mb/s, USB version 2.10. The relay finalized Pia admission and the games exchanged party information. FireRed received Dratini, incremented its native trade count from five to six, completed all six expected save standby rounds, and returned normally to Lavender Pokémon Center 2F with no remote player or native link error. The controller recorded `saveHandshakeVerified`, `handshakeVerified`, `linkClosedVerified` and `nativeSaveVerified` as true. A separate saved-inventory read confirmed that exact Chansey was absent and the received Dratini occupied its former party slot.

The relay logged the Switch departure only after the native RFU disconnect and waited for the owner to finish the room exit. The app subsequently recorded a user stop after completion; it was left stopped. No reset, party reconstruction or restored pre-trade save was used to obtain this result. Private diagnostic receipts retain the individual's fingerprints and the native-save hash.

This is a successful physical regression test of the restored USB 2 UTM reference with both reconnection corrections. It supports the hardware-mode finding but does not isolate USB mode from every other change, establish repeat reliability, verify a Switch cold reload, or qualify the lightweight appliance. The next packaging check needs a separately selected trade individual on the small relay with USB 2 mode preserved.


### Lightweight retest with an early-game shiny

The original UTM guest was shut down after the successful Chansey reference test. The Suite's existing Wireless settings selected the installed `RadioHost` appliance, with the same authorized local console-key path. The installed bundle passed its signature check after a synthetic startup/shutdown test: available in 4,672 ms, advertising false, clean exit 0 after 6,840 ms. These are single local measurements. Process inspection verified the actual game owner launched only the bundled QEMU relay with one CPU, 512 MiB guest RAM and direct USB passthrough. Host enumeration remained 480 Mb/s, USB 2.10, after appliance startup.

For the requested pre-badge trade, the existing shiny Wigglytuff was withdrawn from the current PC collection. Its level was verified as three in the native party. Water Pulse, Shock Wave and Fire Blast were taught through the game's TM Case, retaining Sing; the existing Exp. Share was moved from boxed Gloom through the PC's Move Items menu and equipped through the bag. No Pokémon identity, IV, level or shininess was rewritten. The bot healed and made a verified native save with that held item and moveset. The small relay then advertised RED's Leader lobby. Full physical exchange qualification is pending this retest.


## Lightweight trade interruption, 12 September 2026

The USB2 lightweight retest with the prepared shiny level-3 Wigglytuff failed. The relay reached its 32-slot safety limit with six unacknowledged transmissions. It had received 1,578 native frames and sent 1,545 in 34.411 seconds. Its maximum protocol tick gap was 18.879 ms. USB2 attachment and the original kernel were therefore insufficient to establish reliability; the physical exchange is not qualified.

The preserved failed checkpoint is at `CB2_TradeMenu`, callback 14 (`CB_INIT_CONFIRM_TRADE_PROMPT`), before final acceptance. The native trade count remains six, and the prepared individual is unchanged. The automatic pre-exchange retry was cancelled through the game, with its room exit verified. No accepted exchange was reset, and no save was restored to duplicate the outgoing Pokémon.

The owner previously kept advancing the cartridge during a full relay window. The relay could only disconnect once its queue filled. The new local flow protocol reports processed RFU commands and queued slots. The owner accounts for commands still in the pipe, sends at most eight outstanding/queued commands toward the guest, and retains an intra-frame burst in order. It holds subsequent cartridge frames until space returns. This does not cancel input actions, consume their frame counts, accumulate catch-up time, stop acknowledgements/heartbeats or increase the peer's Reliable window. The original hard overflow guard remains in place. Transport failure still returns control to the existing exchange preservation handler.

App build 28 / engine build 27 includes that owner behavior and the guest receipt implementation in radio runtime `0.1.0-local.5-flow-control`. The runtime keeps the same kernel, USB backend, 512 MiB memory and one CPU so these transport variables do not change together. Guest logs retain five previous attempts instead of overwriting the failed attempt on retry.

Validation before installation: 87 focused JavaScript tests, 22 Suite Python tests and 31 relay Python tests pass. Tests include a one-second acknowledgement pause with 800 native slots, retained ordering across sequence wrap, a 40-packet owner burst, invalid receipt rejection, heartbeat expiry during flow wait and preserving a partially executed input action. These tests establish bounded local flow and recovery, not physical radio reliability. A full Switch exchange, both native saves and normal room exit still need verification on the new lightweight build.


Installed build 28 passed deep signature verification. The packaged relay booted with synthetic credentials in 4.678 seconds, remained non-advertising, and exited normally after 6.851 seconds total. The actual saved FireRed owner was orderly closed, switched through the update API to app-bundled engine build 27 (`38133510479b4c711d654d4884fdc6c542e6da77e5ab07456b9fc89f53666093`), and reopened. No trusted signing key was added. The current inventory verified the same shiny Wigglytuff, level 3, Exp. Share, and Sing/Water Pulse/Shock Wave/Fire Blast before opening RED's new lobby. UTM remains stopped. At the latest check this lobby is advertising with no retries or packet drops, awaiting the physical partner; this is not yet a completed exchange.


### Completed physical lightweight exchange

The subsequent Switch 2 / English LeafGreen retry completed in installed app build 28 using the packaged lightweight relay, with UTM stopped throughout. The outgoing shiny level-3 Wigglytuff held Exp. Share; the Switch returned the Chansey from the earlier reference exchange. The native trade counter advanced from six to seven. All six save standbys, normal room exit and a separate cold-load verification of the received Pokémon's native save passed. The final inventory contains the returned Chansey once and no longer contains the outgoing Wigglytuff.

There were no automatic retries or emulator RFU drops. Periodic observations reached the eight-slot flow limit without triggering the old 32-slot failure; the relay continued through acknowledgement-window delays. The guest powered down normally after the owner completed its room exit, and no QEMU/relay process remained. This qualifies one complete exchange on this Mac, adapter and Switch 2 setup. Repeated-trade, interruption and other-machine qualification remain separate release work; it does not prove every radio loss recoverable.

The receipt is kept privately, outside the source export. It records the native save hash, outgoing/received identity, counter change, six save handshakes, normal exit, runtime version and observed queue/drop counts. No credential contents or game files are included in the public source export.


## Second exchange: saved result, interrupted room exit

The next exchange in build 28 reached all six save standbys and advanced FireRed's native trade counter from seven to eight, then entered `CB2_PrintErrorMessage` during the room exit. The owner stopped at main state zero, before the ROM painted the error, leaving the viewer black. The original error and saved result were preserved; this is not a verified normal exit and must not be repeated.

The lightweight guest's BusyBox `ip` command rejected `neigh replace`. An isolated guest reproduced that failure. The relay had silently logged it and cached the console address as pinned anyway. Without the permanent ARP entry, the transport's documented neighbor-expiration delays remain possible. This is a confirmed missing dependency relative to the working full VM; a physical repeat is still needed to establish whether it fully explains this disconnect.

Runtime `0.1.0-local.6-permanent-neighbor` includes Alpine's signed iproute2-minimal 7.0.0-r0 and its library dependencies, increasing the complete runtime to 117,731,344 bytes. Package signatures were checked by apk in a disposable offline guest. Before hardware qualification or advertising, a temporary TAP test installs and reads back a permanent neighbor. The transport separately verifies the actual console IP/MAC entry and only caches successful proof. Failure prevents admission instead of continuing silently. The final guest passed that preflight and 20 relay tests without USB, credentials, game or save access. The preceding flow control remains intact.

Engine build 28 permits neutral frames to paint native communication errors. For an exchange whose save handshake completed, it independently cold-loads the current SRAM and checks the received individual, unchanged other party members and exact trade counter before using the ROM's error-return input. It waits through the native `ReloadSave` transition, then verifies the field and party again. A recovered exchange remains `interrupted`, with no fabricated normal-exit receipt, and cannot resume or reoffer its outgoing Pokémon. Only the verified terminal state releases the task controls. Unsaved, changed-party or active-link cases remain preserved.

A separate emulator rehearsal of the actual failed checkpoint returned to Lavender Pokémon Center 2F with trade counter eight. The native SRAM remained byte-for-byte unchanged (`f0a2aa85975bf44c044a887f172afea6cbb47a268e549351cd4fb8b54d3f278e`). This establishes recovery behavior, not a successful physical retry. Local evidence is in `second-trade-recovery-rehearsal.json`, `neighbor-probe-red.log` and `neighbor-final-selftest.log` under the private integration directory.

Installed app build 29 passed deep signature verification and activated app-bundled engine build 28 (`63fdc5e8e8d1994bfb93166d15151706cbbdc73b4e904021f60b255bdaeff6e0`) through the update API. The real owner returned via the native error handler to Lavender Center 2F at frame 14,071, with unchanged SRAM and trade count eight. The frame endpoint rendered 62 colors; inventory had no outgoing Meowth and no trade-selection blocker. The received Chansey fingerprint appears in two current inventory slots after the second exchange; recovery did not create or remove either, as the exact pre-recovery SRAM hash is unchanged. This identity duplication requires separate provenance review before any downstream transfer claim. No Pokémon was edited or restored.

The installed relay's synthetic, non-advertising hardware startup completed in 4.855 seconds and shut down normally in 7.003 seconds total. Focused regression runs passed 81 JavaScript, 34 Suite Python and 32 relay Python tests, plus 20 tests inside the final guest. The owner remains ready for commands with no live relay. A new physical Switch exchange has not been attempted on runtime local.6; the user is away while subsequent emulator-transfer research continues.

## Runtime local.7: minimal QEMU and a pruned guest (27 September 2026)

Runtime `0.1.0-local.7-minimal-qemu` removes a license conflict before public release. The previous QEMU was Homebrew's full build, linked through libssh to OpenSSL; GPL-2.0-only QEMU can't be distributed with that combination. QEMU 11.1.1 is now built from the upstream release with every optional feature off except HVF, libusb and the device tree, so it loads only GLib, libintl, PCRE2, libusb and libfdt (the same bundled copies as before). The runtime shrank from 31 files and 117.7 MB to 8 files and 93.7 MB.

The guest's five concatenated initramfs layers are flattened into one, exactly as the kernel unpacked them, then 97 entries are removed. These are the Alpine 6.18.35 modules, which can't load into the shipped kernel; a duplicate firmware file; a pip cache; stale bytecode; and `apk`, `libapk` and BusyBox's `ssl_client`, which the radio never runs and which linked GPL-2.0-only code to OpenSSL. The 4,315 remaining entries are byte-identical to the previous final tree.

**Kernel correction:** the kernel that shipped and qualified the physical trades is Ubuntu `linux` 6.8.0-138-generic, not Alpine 6.18.35. The `rtw88_usb.switch_usb_mode=N` boot argument has no effect on it; the parameter first appeared in Linux 6.12. The adapter enumerated at 480 Mb/s during testing regardless.

The hardware smoke test (real Archer T3U, synthetic credentials, no advertising) passed twice. The first run was ready in 5.1 s and the second, after the final prune, in 5.4 s; both exited cleanly. On 27 September local.7 completed a physical Switch exchange with the Archer T3U: the Direct Corner connected, the trade was confirmed on both sides, both games saved (six save-handshake rounds), the link closed normally and the received Pokémon was verified in the Mac's native save. local.7 is trade-qualified on that setup. Every release that carries local.7 includes the complete corresponding source; see [licenses/radio](../licenses/radio/README.md).
