# Radio runtime licenses

The Mac app bundles an optional wireless-trading radio at `Contents/Resources/Runtime/RadioHost/`. It is a separate program run in its own virtual machine. The Suite's MIT license does not cover the third-party parts listed here; each keeps its own license.

## What it contains

- **Host (macOS):** QEMU 11.1.1 (`bin/qemu-system-aarch64`), built from the upstream release with a minimal configuration, and five libraries from Homebrew bottles (`lib/`): GLib, gettext's libintl, PCRE2, libusb and libfdt.
- **Guest kernel:** Ubuntu `linux` 6.8.0-138.138 arm64 (`guest/vmlinuz`) and 14 of its modules.
- **Guest filesystem** (`guest/initramfs.cpio.gz`):
  - Alpine Linux 3.24 packages (BusyBox, musl, Python 3.14.7, iw, iproute2-minimal and their libraries)
  - the Realtek `rtw8822b_fw.bin` firmware and wireless-regdb
  - nine Python packages
  - the pokeldn transport and its vendored LDN library
  - the Suite's relay scripts

## Licenses

| License | Components |
| --- | --- |
| GPL-2.0-only | QEMU (some files GPL-2.0-or-later, LGPL-2.1-or-later, BSD or MIT), the Linux kernel and its modules, BusyBox, alpine-baselayout, pax-utils (scanelf) |
| GPL-2.0-or-later | iproute2 |
| GPL-3.0-or-later / GPL-3.0-only | GNU readline, gdbm, python-netlink, LDN (GPL-3.0-only) |
| AGPL-3.0 | pokeldn transport. The Suite relay (MIT) runs combined with it, so that combination is distributed under AGPL-3.0. |
| GPL-3.0-or-later with the GCC Runtime Library Exception | libgcc, libstdc++ |
| LGPL-2.1-or-later | GLib, libintl, libusb, libnl3, libmnl |
| GPL-2.0-or-later OR LGPL-3.0-or-later | elfutils libelf |
| MPL-2.0 | Mozilla CA certificate data (`ca-certificates-bundle`); certifi vendored in pip |
| Apache-2.0 | OpenSSL in the guest (libcrypto3, libssl3), sortedcontainers |
| Dual-licensed; BSD option used | libfdt (BSD-2-Clause), zstd (BSD-3-Clause), libcap (BSD-3-Clause) |
| BSD / MIT / ISC / Zlib / PSF and similar | PCRE2, musl, Python, pip, expat, libffi, bzip2, mpdecimal, zlib, xz, ncurses, iw, wireless-regdb, attrs, idna, outcome, pycryptodome, sniffio, trio, zstandard, the Suite relay (MIT) |
| Public domain | SQLite |
| Realtek firmware licence (binary redistribution, no modification) | `rtw88/rtw8822b_fw.bin` |

The app carries `NOTICE.md` and the license texts beside the runtime. Every component's full license text and notice files are in the source archive under `notices/`.

## Corresponding source

The complete corresponding source for each runtime version is attached to every GitHub release that ships it. The archive is named `pokemon-suite-radio-sources-<runtime version>.tar.gz` (for this version, `pokemon-suite-radio-sources-0.1.0-local.7-minimal-qemu.tar.gz`) and has a `.sha256` file. It contains:

- the exact upstream source archives
- the QEMU configure line and build recipe
- the Homebrew formulas, Alpine APKBUILDs and Ubuntu packaging, with their patches and the kernel configuration
- the patched transport and LDN trees
- the relay and build scripts

`SOURCES.md` and `sources.json` in the archive map every shipped file to its source and record the verified hashes.

The source is provided alongside the binary release itself. The GPL's alternative of a written offer to supply source later is not used.

The relay's complete AGPL-3.0 source is in the release archive under `sources/guest/`. It is offered at no charge to everyone who interacts with the running relay, including over its wireless link, through the release page that carries this runtime.
