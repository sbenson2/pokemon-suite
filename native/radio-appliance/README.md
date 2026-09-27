# Mac radio appliance

The original probe is a disposable hardware qualification image and a relocatable Mac QEMU helper. It boots Linux, identifies the Archer adapter by USB identity, waits for its actual wireless interface, verifies AP/monitor capabilities, creates a monitor interface on channel 1, removes it, reports the result and powers off.

It does not start a trading lobby, load a game or use console keys. This probe was the first gate in [the appliance plan](../../docs/RADIO-APPLIANCE.md). The subsequent app integration and physical trade result are recorded below.

## Verified on 11 September 2026

On the development Apple Silicon Mac running macOS 26.4.1, the prototype used QEMU 11.1.1 with HVF and the attached USB `2357:012d` adapter. It worked with UTM stopped, with both 512 MiB and 256 MiB guest RAM.

| Measurement | Result |
| --- | --- |
| Kernel plus compressed guest filesystem | 34,570,383 bytes |
| Relocated helper, its libraries and guest package | 93,565,231 bytes |
| Local prototype ZIP | 48,020,565 bytes |
| Three consecutive bundled-helper cycles at 256 MiB | 2.272, 7.197 and 2.382 seconds, each with a successful hardware report and normal QEMU exit |
| Guest uptime at radio report during those cycles | 1.99–2.09 seconds |
| Unbundled-helper 256 MiB probe, `/usr/bin/time -l` maximum RSS | 370,966,528 bytes; this is a probe measurement, not full trading memory |
| Runtime loader inspection | 29 bundled native executable/library entries, no Homebrew load paths |

The initial Alpine live-image test hit a USB 2-to-3 mode transition during driver initialization. The small image sets `rtw88_usb.switch_usb_mode=N` to avoid initiating that transition. Discovery follows the actual USB-backed PHY and interface instead of assuming `phy0`/`wlan0`. Software reattachment and repeated boots passed; physical unplug/replug and recovery under a live exchange still require testing. Some host launches/exits took several seconds beyond guest uptime; no fixed two-second startup guarantee is implied.

## Build the guest

The first image uses an Alpine minirootfs plus a small kernel-module dependency closure. This avoids a lengthy kernel build while checking hardware. It is not yet the proposed pinned Buildroot release image.

Inputs used:

- [Alpine standard 3.24.1 aarch64 ISO](https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/aarch64/alpine-standard-3.24.1-aarch64.iso), SHA-256 `95eba9066d7920fe703dd62b8b8e7f38c45eba0bad225dbe2ccfb5b76cf5356d`.
- [Alpine minirootfs 3.24.1 aarch64](https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/aarch64/alpine-minirootfs-3.24.1-aarch64.tar.gz), SHA-256 `f55a90f69052c5bd6f92cb09a8f47065970830b194c917a006fb94028e721259`.

Inside a disposable Alpine builder booted from that ISO, mount the builder input/output directory, unpack the minirootfs into a new directory under `/tmp`, and install `python3`, `iw` and `iproute2-minimal` into that root using Alpine's signed packages. BusyBox's `ip` lacks `neigh replace`; the relay requires a verified permanent neighbor entry for the console. The probe exercises that capability on a temporary TAP before opening a lobby. Install `kmod` in the builder. Ensure the builder's clock is correct before HTTPS downloads; do not bypass certificate validation. Then run:

```sh
sh /mnt/tools/build-guest.sh /tmp/radio-root /mnt/output
```

The tool directory must contain `build-guest.sh`, `init` and `guest_probe.py`. The ISO must remain mounted at `/media/cdrom`, with its modloop mounted. The build writes the kernel, initramfs, package inventory and selected module dependencies into the output directory. The builder's shared folder and temporary package networking are absent from the resulting probe VM.

The package inventory records the prototype's versions. A reproducible public build additionally needs pinned package archives/hashes, normalized filesystem metadata, corresponding source and the completed firmware/license inventory.

## Stage and run on macOS

Stage the existing local QEMU executable and its transitive native libraries into a new directory:

```sh
python3 scripts/stage-radio-host.py \
  --qemu /opt/homebrew/bin/qemu-system-aarch64 \
  --output /path/to/new/RadioHost
```

The stager resolves absolute native dependencies, rewrites their references, signs the copies locally and checks that no external non-system load paths remain. It preserves the source installation and refuses to overwrite an existing output directory. Unexpected unresolved `@rpath` dependencies fail rather than producing an incomplete bundle. The local signature is ad hoc; it is not a Developer ID signature or notarization.

With other radio owners stopped, run the one-shot probe:

```sh
python3 scripts/probe-radio-appliance.py \
  --qemu /path/to/RadioHost/bin/qemu-system-aarch64 \
  --kernel /path/to/output/vmlinuz \
  --initramfs /path/to/output/initramfs.cpio.gz \
  --memory 256 \
  --output /path/to/probe-result.json
```

No disk, network interface, display or shared host folder is attached. The probe waits for the guest process to exit before accepting success. A missing/failed report, process crash or shutdown timeout fails the command. Timeout cleanup also terminates descendants in the probe's process group. `--diagnostic-log` saves console and QEMU output for local investigation.

The relocation test compiles a real Mach-O program with a transitive library dependency, stages it, removes the originals and runs the relocated program. The hardware probe tests cover changing PHY names, wrong/missing/ambiguous hardware, monitor cleanup, false success and process cleanup:

```sh
python3 -m unittest discover -s tests -p 'test_radio_*.py' -v
```

## Integrated relay and remaining qualification

The [integrated relay](../../docs/RADIO-RELAY-INTEGRATION.md) now includes the patched transport and dependencies, a private virtio-serial channel, temporary credential provisioning and app-owned guest lifecycle. Startup and complete shutdown passed through the actual JavaScript transport with synthetic credentials. On 12 September, app build 28 completed a physical shiny Wigglytuff trade with Switch 2 / English LeafGreen, all six save handshakes, normal room exit and native-save verification. The relay used one CPU, 512 MiB RAM, the Ubuntu 6.8.0-138 kernel and owner-to-relay flow control; UTM remained stopped and the guest shut down afterward. This is one verified exchange, with repeated-trade and broader hardware qualification still outstanding. See the integration record for the failed earlier attempts and fix.

The local prototype archive is not a distributable release: license/source packaging, firmware redistribution review, release signing and a clean-machine test remain outstanding. The original UTM disk and paused story campaign are preserved. The installed app now includes the relay; game/save changes in the physical test came from the native trade itself.
