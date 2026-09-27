# Native Switch transport

This directory contains an optional local transport for the owner's installed
Ryubing 1.3.3 release. `SuiteBridge.cs` communicates over the private Unix socket
named by `POKEMON_SUITE_SOCKET`. With that variable absent, the existing engine
paths remain active. The adapter is intended for the headless Suite owner.

`patcher/Program.cs` uses Mono.Cecil to insert four hooks in a private copy of the
release assemblies: Vulkan presentation, SDL audio output, the native controller
state and the software-keyboard callback. The original app, cartridge and saves
are not patched. Exact release identity is checked by the build script before
extraction. Normal Switch VSync and 1× resolution are selected by the owner.
The owner uses the JIT CPU backend with the Apple hypervisor disabled, after a
Violet verification session froze with the hypervisor enabled.

The framed protocol uses a four-byte kind and a big-endian 32-bit payload length.
`VID2` includes width, height and orientation flags followed by native pixels.
`AUD2` includes sample format, sample rate and channels followed by native audio.
`REQ1` carries a bounded text prompt or JSON null when the prompt closes. Input
uses bounded newline-delimited JSON, expires after one second and includes both
sticks. Text responses must match the current request ID.

The legacy desktop build script is not included in the standalone source release. This optional transport requires an independently installed, matching emulator and a manually prepared adapter; no standalone installer is advertised here. `SuiteBridge.csproj` targets .NET 9, while `patcher/Patcher.csproj` requires the .NET 10 SDK to build its patcher. The .NET 9 runtime used by the emulator is a separate input. No runtime or patched assembly is bundled.

Source packages:

- Ryubing 1.3.3: https://git.ryujinx.app/ryubing/ryujinx — MIT, Ryujinx Team and Contributors.
- .NET runtime 9.0.9: https://github.com/dotnet/runtime/tree/v9.0.9 — MIT.
- Mono.Cecil 0.11.6: https://github.com/jbevain/cecil — MIT.
- Azahar 2126.0: https://github.com/azahar-emu/azahar/tree/2126.0 — GPL-2.0-or-later.

The existing emulator distributions include additional dependency notices and
licenses, which continue to apply. ROMs, firmware and keys are supplied locally
by the owner and are not included in the repository.
