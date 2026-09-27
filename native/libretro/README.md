# Native libretro bridge

`suite_bridge.c` supplies video, PCM audio, input, cartridge RAM and emulator checkpoints to `pokemon_suite/suite_playback_worker.py`. It supports software-rendering cores. Current native playback remains experimental in the standalone distribution.

Build on an Apple Silicon development host:

```sh
mkdir -p .private/engines
clang -O2 -Wall -Wextra -dynamiclib native/libretro/suite_bridge.c -o .private/engines/suite_bridge.dylib
```

The public source package includes the frontend and the MIT-noticed libretro API header. It does not include emulator cores. The mGBA core uses MPL-2.0; melonDS DS uses GPL-3.0. Their dependency terms and corresponding-source obligations must be satisfied before bundling binaries. A source or binary hash by itself does not establish those obligations have been met.

Install the user's cores and games in private profile resources. There is no standalone GB–DS native installation wizard or exported legacy installer script yet. The old host application's installation/test commands are not part of this distribution. See the root README and `docs/RELEASING.md` for the qualified FireRed intake and remaining native platform work.
