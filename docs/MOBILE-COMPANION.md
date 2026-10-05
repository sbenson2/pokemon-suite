# iPhone and iPad companion

**Companion development resumed, September 12, 2026.** The iPhone and iPad app connects to the [native Mac app](MACOS.md). Emulation and physical trading remain on the Mac; standalone mobile emulation and USB radio work remain paused.

The existing companion is a native SwiftUI client of the Mac app. The Mac owns emulators, bot tasks, ROMs, saves, collection and wireless transport. Both devices use the same library and commands. Closing or backgrounding the companion releases manual inputs and its stream; it does not stop the Mac bot.

Games, Live game, Bank, Farming, Trading and Bot settings match the Mac destinations. iPhone uses the upper-left Poké Ball menu; iPad retains a sidebar and split views, with the same menu available. There is no bottom navigation bar. Both use the Mac's ROM-derived artwork, native system appearance and bounded scroll areas. Bot and farming forms, playback decoding and command transport reuse the Mac Swift sources. Unsupported games retain the host's capability restrictions.

The **Bank** (formerly Pokédex) works as on the Mac: every species with its owned Pokémon in every save the Mac knows, how FireRed gets it, and **Get It**, which uses the same request flow and preview as Ask. The filter button narrows by type, owned, shiny-owned and obtainable. An owned Pokémon's details include **Send to Switch** for the current game. See [the Mac guide](MACOS.md).

Trainer and Location details replace their summaries inside the existing card
bounds, with a fixed return button and scrollable facts. The centered wordmark
is decorative. The upper-left menu uses a SceneKit Poké Ball whose rotation
pauses for Reduce Motion and inactive scenes. While the menu is open, its hinged
lid opens to reveal hollow lined shells, radial reflector panels and recessed
centers; dismissing the menu closes the ball and resumes rotation. Reduce Motion
changes shell positions without animation. Working game, audio and appearance
controls stay in that menu. The upper-right Wi-Fi button opens the Network and
trades drawer: observed Mac connectivity, pairing address, reconnect, trade
status and the supported FireRed radio check. It does not infer VPN or radio
readiness from the other connection's state.

The Live Session card shows the current activity, goal, location and relevant
progress counters. Tap its activity heading to view reasons, next steps, deferred
tasks, session totals and recent actions in the same scrollable card. Returning
to the summary resets its scroll position. The card has no Running badge,
Telemetry button or Manual Play button. The Team and Session row grows into
available screen space while retaining the system safe area.

Companion build 21 keeps a plain status label visible in both summary and details.
Working, waiting for a game interaction and automatic recovery use neutral text.
An unavailable route has an amber label; a blocked decision, failed command or
review stop has a red **Needs review** label. The rest of the card keeps its normal
text color. A recovery label does not establish that a task succeeded.

Postgame evolution tasks name the source and target Pokémon and show the published
level or friendship requirement. Reaching that number does not establish evolution
or a verified save. Funding is described as earning money. Completed campaign tasks
do not replace the current postgame explanation. Routine observation waits retain
their reason without implying an evolution animation is necessarily playing.

The update age remains visible below the details. Disconnection or telemetry older
than 15 seconds shows **Waiting for telemetry** and identifies the retained goal as
last reported. Reconnection restores the current status, including genuine review
stops. These changes affect presentation only; they do not retry tasks or alter
gameplay, saves or the installed engine.

Activity descriptions distinguish intentional roaming searches from unavailable
routes. A deferred postgame hunt remains visible as deferred work without
replacing the current agenda task. These are read-only presentations of the
host's state; opening a card never retries a hunt or changes the bot's controls.

Companion build 11 adds the [FireRed dashboard theme](FIRERED-COMPANION-THEME.md):
framed trainer and location panels, an eight-badge case, a six-slot party overview
with Pokémon detail sheets, and the shared Now/Why/Next activity presentation.
Landscape phones and wide iPad windows place the game beside the dashboard.
Library and trading cards use the same panel edges. The appearance setting and
native navigation remain available.

Companion build 17 moves every destination into the companion logo menu and uses
the reclaimed dock height for larger live panels. Trainer portraits follow the
observed save character; the corresponding host presentation fix corrects the
FireRed GIRL string being incorrectly published as BOY.

Companion build 18 centers the wordmark/menu and shares that header across all
six pages. Games, Trading, Pokédex, Hunting and Bot Settings use the Live Game
palette and panel framing, with search fields inside the bounded page content.
This presentation update retains the installed engine and current campaign.

## Connect

1. On the Mac, open Settings → Companion and enable sharing.
2. Choose Tailscale or Local network, copy the connection code and paste it in the mobile app's connection screen. Tailscale is offered first when the installed Mac client is connected; your choice is remembered. Changing the network selects a different pairing address without interrupting the game or bot.
3. Keep the Mac awake. For Tailscale, connect both devices to the same tailnet with access to the Mac on TCP port 55443. For Local network, join the Mac's network and allow Local Network access on mobile. If macOS asks to accept incoming connections for Pokémon Suite, allow it for companion use. Development builds should use a stable Apple-issued signing identity; release builds need Developer ID signing and notarization.

Tailscale pairing uses the Mac's stable private IPv4 address and works across networks, subject to tailnet access rules. It does not require MagicDNS, an exit node, router port forwarding, Serve or Funnel. Suite reads the installed Tailscale client's status; it does not install it, sign in, or change its settings. If Tailscale was disconnected when sharing started, connect it; available addresses refresh automatically without restarting sharing. For cellular access, Tailscale must also be connected on the phone. Its VPN On Demand settings can keep that connection active on cellular. A local code continues to use the local address: paste the Tailscale code on mobile to switch. See [Tailscale's device connection guide](https://tailscale.com/docs/how-to/connect-to-devices).

On iOS 17 and later, the companion declares a scoped ATS exception for `100.64.0.0/10` so its manual certificate verification can run. Pairing still requires HTTPS, the certificate must match the saved SHA-256 pin exactly, and the host requires TLS 1.2 or later. Other internet addresses retain ATS defaults. See [Apple's IP-range exception documentation](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsexceptiondomains).

The connection uses TLS with an exact certificate pin and an opaque bearer credential stored in the device Keychain. The Mac retains the certificate and credential across launches. The listener belongs to the Mac service and follows its current internal address. Enabled sharing restores on app launch without changing the saved pairing. Stop Sharing closes the listener and existing streams, and remains disabled after relaunch. Codes grant game control and should be kept private. The relay allows specific game/data routes; filesystem imports, host shutdown and software installation stay on the Mac. It does not automatically replay commands after connection loss.

On connection or return from the background, the companion opens the Mac’s selected game and shows its live feed when running. It follows later game changes on the Mac while allowing local navigation through the other pages. Network changes trigger a status refresh; failed status checks time out after eight seconds and polling retries automatically. Game commands retain their longer timeout and are never replayed automatically.

## Trading

The Trading page reads the Mac's party and PC boxes, with shiny and location filters. Prepare Trade uses the existing Mac preparation and full wireless exchange routine. The physical radio remains attached to the Mac's existing transport. This is not direct iPhone USB radio support.

The companion can prepare a Pokémon from the current loaded game. To trade from another saved collection, load that collection on the Mac first, then select Current game on mobile. A completed physical trade initiated from mobile still needs device/hardware validation; simulator screen tests do not establish that result.

## Build

The companion isn't distributed as a download; build it with Xcode and a free or paid Apple ID. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`), then:

```sh
python3 native/ios/build-companion.py --output build/companion --bundle-id com.yourname.pokemonsuite
xcodegen generate --spec build/companion/project.json --project build/companion
open build/companion/PokemonSuiteCompanion.xcodeproj
```

In Xcode, choose your Apple ID as the Team for both the `PokemonSuiteCompanion` and `SuiteCore` targets, pick your device and press Run. Pass `--team YOURTEAMID` to `build-companion.py` to set it for every target at once. The first run on a device needs Developer Mode (Settings → Privacy & Security) and, with a free Apple ID, trusting your developer profile under Settings → General → VPN & Device Management. [Apple's free-account limits](https://developer.apple.com/help/account/basics/about-your-developer-account/): the app must be reinstalled from Xcode every 7 days, and up to 3 apps per device.

For a scripted build: `xcodebuild -project build/companion/PokemonSuiteCompanion.xcodeproj -scheme PokemonSuiteCompanion -destination 'generic/platform=iOS' -allowProvisioningUpdates build`.

The companion bundles no emulator, ROM or save. The earlier standalone FireRed prototype remains in `native/ios/App` with its own builder. The companion does not read, migrate or delete its `Documents/Suite` checkpoints. Private development provisioning can place a connection record in `Documents/Companion.json`; launch consumes it into Keychain and removes the file. `Documents/Companion-status.json` contains a sanitized connection/frame diagnostic, without credentials.

## Verification

Companion build 7 adds window-width-aware layouts for iPad. Pokédex and Trading use inline details when the content area is wide enough and a detail sheet in narrower windows. Farming moves its plan and queue into a sheet when two readable columns do not fit. Accessibility text sizes use the single-column presentation. Selection remains available across size changes. The layout follows Apple's [iPad navigation and window guidance](https://developer.apple.com/videos/play/wwdc2025/208/), with native sidebars, system toolbars and bounded scrolling regions.

Build 7 was installed and tested on a 13-inch M5 iPad Pro on September 12, 2026. The physical-device test verified the existing Mac pairing, live frame delivery, new frames after background/foreground, and access to shared Bot Settings without starting a task. This does not establish off-network connectivity or a completed physical trade initiated from iPad.

`tests/test_companion.py` exercises authentication, route limits, command forwarding, listener shutdown, retained pairing across a changed Mac service port, and recovery when Tailscale becomes available. `macos/Tests/SuiteCoreTests/CompanionTests.swift` covers pairing validation and request isolation. Companion UI tests navigate the real Mac library, shiny inventory, live frame stream and bot form without starting a task or trade. Device builds and simulator checks are separate from physical device connection and trade verification.
