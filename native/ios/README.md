# Native mobile targets

**September 12, 2026:** iPhone and iPad companion work has resumed. The [native Mac app](../../docs/MACOS.md) hosts games, bots, saves and the wireless radio. Standalone mobile emulation and direct USB-radio development remain paused; their existing device data is retained.

The existing iPhone/iPad companion is documented in [Mac companion](../../docs/MOBILE-COMPANION.md) and built with `build-companion.py`. Its interface shares the Mac app’s destinations and Swift forms. The earlier standalone emulator prototype below remains available as a separate development target.

# Standalone mobile prototype

This is a development app for iPhone and iPad, beginning with FireRed US revision
1. SwiftUI owns the controls and lifecycle; an embedded WKWebView executes the
bundled mGBA WebAssembly core and the existing FireRed campaign planner locally.
It does not start a web server, connect to the desktop service, or stream a Mac.
It is not a PWA or the complete mobile Suite: Pokédex, hunting, collection,
additional cores, and physical-console trades still need mobile integration.

## Build

Use Xcode, XcodeGen, Node 22+ and an Apple development team. From the repository:

```sh
npm ci --prefix native/ios --ignore-scripts --no-audit --no-fund
node native/ios/build.mjs --config=/path/to/local-profile/config.json --output=.private/mobile-build --team=YOUR_TEAM --bundle-id=your.identifier.suite
xcodegen generate --spec .private/mobile-build/project.json --project .private/mobile-build
xcodebuild -project .private/mobile-build/PokemonSuiteMobile.xcodeproj -scheme PokemonSuiteMobile -destination 'generic/platform=iOS' -derivedDataPath .private/mobile-derived -allowProvisioningUpdates build
```

The profile must supply `games.firered.core` and its `runtime`, `world`, `story`
and `battle` input paths, as used by the desktop adapter. The builder verifies
the local core's recorded JavaScript and WASM hashes. This is a private developer
build using existing local resources; it is not a public resource acquisition
or redistribution workflow. The source export contains no core, ROM or private
knowledge pack. Import the ROM through the app after installation. The supported
cartridge SHA-1 is `dd5945db9b930750cb39d00c84da8571feebf417`.

Play offers manual controls and pause/save. Bot lets you choose a starter, review
a randomly committed team, and start the existing campaign. The game view stays
mounted above these tabs so WebKit does not suspend the emulator when switching
tabs. Ordinary gameplay has no remote dependency.

Each installation stores `Documents/Suite/FireRed.gba` and its own checkpoint.
Checkpoints bind the cartridge and emulator hashes, preserve bot state, and are
written atomically with a previous copy. Creating another adventure archives the
current checkpoint first. Leaving the app pauses and checkpoints; background
bot execution is not promised. A sudden process termination may lose progress
since the last checkpoint. This prototype checkpoints about every ten seconds
while the bot runs; it is not an external-trade transaction journal.

## Verify

```sh
POKEMON_SUITE_MOBILE_TEST_CONFIG=/path/to/local-profile/config.json node --test tests/mobile-runtime.test.mjs
swift test --package-path native/ios --scratch-path .private/mobile-swift-tests
xcodebuild -project .private/mobile-build/PokemonSuiteMobile.xcodeproj -scheme PokemonSuiteMobile -destination 'id=YOUR_DEVICE_UDID' -derivedDataPath .private/mobile-derived -allowProvisioningUpdates test
```

The physical-device test requires the supported ROM already imported and the
device unlocked. It starts the bot, checks increasing decisions with Bot open,
pauses, relaunches, verifies the saved decision count, and resumes. It changes
the test installation's local game and leaves it paused. It does not test a full
campaign, long-term thermal performance, or physical trading.

## iPad radio probe

The separate `RadioProbe` app is a read-only USB experiment for an M-series iPad.
It matches only Archer T3U USB identity `2357:012d`, reads its device descriptor,
and exposes six scalar diagnostic values. It contains no firmware loader,
packet transmitter, Nintendo protocol, or trading implementation.

```sh
python3 native/ios/RadioProbe/build.py --output .private/radio-probe --team YOUR_TEAM --bundle-id your.identifier.probe
xcodegen generate --spec .private/radio-probe/project.json --project .private/radio-probe
xcodebuild -project .private/radio-probe/SuiteRadioProbe.xcodeproj -scheme SuiteRadioProbe -destination 'generic/platform=iOS' -derivedDataPath .private/radio-derived -allowProvisioningUpdates build
clang++ -std=c++17 native/ios/RadioProbe/Tests/descriptor.cpp -o .private/descriptor-test
.private/descriptor-test
```

Install on the iPad, connect the adapter, enable the app's driver in Settings if
requested, then tap **Read adapter descriptor**. Development uses Apple's USB
wildcard entitlement while the driver's matching dictionary remains restricted
to that exact adapter. Public driver distribution is separate entitlement work.
Stock iPhone has no supported DriverKit route for this dongle; a successful iPad
probe would not establish iPhone or Switch trade compatibility.

Apple's [DriverKit guide](https://developer.apple.com/documentation/driverkit/creating-a-driver-using-the-driverkit-sdk)
explicitly excludes USB devices communicating over Wi-Fi or Bluetooth from
DriverKit support. The descriptor probe is therefore a limited experiment, not
an established route to a supported iPad Wi-Fi driver. Neither mobile build can
advertise a Switch trade lobby with this adapter. Standard iOS Wi-Fi APIs do not
replace the Linux radio stack used by the Mac integration.

See [architecture and radio evidence](../../docs/MOBILE-ARCHITECTURE.md).
