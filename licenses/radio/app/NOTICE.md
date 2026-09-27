# Radio runtime notices (0.1.0-local.7-minimal-qemu)

The Pokémon Suite Mac app bundles an optional wireless-trading radio in `Contents/Resources/Runtime/RadioHost/`. It contains:

- **Host:** QEMU and five libraries.
- **Guest:** a Linux kernel and a small Linux filesystem image, both run in a virtual machine.

These components are not covered by the Suite's MIT license. Each keeps its own license, listed below with the file here that holds its notice or license text.

The **complete corresponding source** for every component is published with each GitHub release that ships this runtime, as `pokemon-suite-radio-sources-0.1.0-local.7-minimal-qemu.tar.gz`. It includes:

- the exact upstream source archives, with their patches and build recipes
- the source of the relay, which is combined with the AGPL-3.0 pokeldn transport and therefore distributed under AGPL-3.0
- `SOURCES.md` and `sources.json`, which map every shipped file to its source

Anyone who receives this app, or who interacts with the running relay (including over its wireless link), may obtain that source there at no charge.

| Component | Version | License | Notice / license text |
| --- | --- | --- | --- |
| QEMU (minimal build for this runtime) | 11.1.1 | GPL-2.0-only | `third-party/qemu-LICENSE.txt`, `licenses/GPL-2.0.txt`, `licenses/LGPL-2.1.txt` |
| GLib (libglib only) | 2.88.3 | LGPL-2.1-or-later | `licenses/LGPL-2.1.txt` |
| GNU gettext (libintl) | 1.0 | LGPL-2.1-or-later | `licenses/LGPL-2.1.txt` |
| PCRE2 (libpcre2-8) | 10.47 | BSD-3-Clause WITH PCRE2-exception | `third-party/pcre2-LICENCE.md` |
| libusb | 1.0.30 | LGPL-2.1-or-later | `licenses/LGPL-2.1.txt` |
| dtc / libfdt | 1.8.1 | GPL-2.0-or-later OR BSD-2-Clause | `third-party/libfdt-README.license.txt`, `third-party/libfdt-BSD-2-Clause.txt` |
| Linux kernel (Ubuntu linux / linux-signed) | 6.8.0-138.138 | GPL-2.0-only WITH Linux-syscall-note | `third-party/linux-COPYING.txt`, `licenses/GPL-2.0.txt`, `licenses/Linux-syscall-note.txt` |
| Realtek RTL8822B firmware rtw88/rtw8822b_fw.bin | linux-firmware commit 338684a0c776 | LicenseRef-Realtek-rtlwifi-firmware | `third-party/realtek-LICENCE.rtlwifi_firmware.txt`, `third-party/realtek-WHENCE-rtw88.txt` |
| wireless-regdb (regulatory.db, regulatory.db.p7s) | 2025.10.07-r0 | ISC | `third-party/wireless-regdb-LICENSE.txt` |
| alpine-baselayout | 3.7.2-r1 | GPL-2.0-only | `licenses/GPL-2.0.txt` |
| alpine-keys | 2.6-r0 | MIT | see note below |
| alpine-base | 3.24.1-r0 | MIT | see note below |
| busybox | 1.37.0-r31 | GPL-2.0-only | `third-party/busybox-LICENSE.txt` |
| ca-certificates | 20260611-r0 | MPL-2.0 AND MIT | `licenses/MPL-2.0.txt` |
| gdbm | 1.26-r0 | GPL-3.0-or-later | `licenses/GPL-3.0.txt` |
| iw | 6.17-r0 | ISC | `third-party/iw-COPYING.txt` |
| bzip2 | 1.0.8-r6 | bzip2-1.0.6 | `third-party/bzip2-LICENSE.txt` |
| openssl | 3.5.7-r0 | Apache-2.0 | `licenses/Apache-2.0.txt` |
| expat | 2.8.4-r0 | MIT | `third-party/expat-COPYING.txt` |
| libffi | 3.5.2-r1 | MIT | `third-party/libffi-LICENSE.txt` |
| gcc | 15.2.0-r5 | GPL-2.0-or-later AND LGPL-2.1-or-later | `licenses/GPL-3.0.txt`, `licenses/GCC-exception-3.1.txt` |
| ncurses | 6.6_p20260516-r0 | X11 | `third-party/ncurses-COPYING.txt` |
| libnl3 | 3.11.0-r0 | LGPL-2.1-or-later | `licenses/LGPL-2.1.txt` |
| mpdecimal | 4.0.1-r0 | BSD-2-Clause | `third-party/mpdecimal-COPYRIGHT.txt` |
| musl | 1.2.6-r2 | MIT | `third-party/musl-COPYRIGHT.txt`, `licenses/GPL-2.0.txt` |
| py3-pip | 26.1.2-r0 | MIT | `third-party/pip/` |
| python3 | 3.14.7-r1 | PSF-2.0 | `third-party/python-LICENSE.txt` |
| readline | 8.3.3-r1 | GPL-3.0-or-later | `licenses/GPL-3.0.txt` |
| pax-utils | 1.3.9-r1 | GPL-2.0-only | `licenses/GPL-2.0.txt` |
| sqlite | 3.53.4-r0 | blessing | see note below |
| xz | 5.8.4-r0 | GPL-2.0-or-later AND 0BSD AND Public-Domain AND LGPL-2.1-or-later | `third-party/xz-COPYING.txt`, `third-party/xz-COPYING.0BSD.txt` |
| zlib | 1.3.2-r0 | Zlib | `third-party/zlib-LICENSE.txt` |
| iproute2 | 7.0.0-r0 | GPL-2.0-or-later | `licenses/GPL-2.0.txt` |
| libcap | 2.78-r0 | BSD-3-Clause OR GPL-2.0-only | `third-party/libcap-License.txt` |
| elfutils | 0.195-r0 | GPL-3.0-or-later AND | `licenses/GPL-2.0.txt`, `licenses/LGPL-3.0.txt` |
| libmnl | 1.0.5-r2 | LGPL-2.1-or-later | `licenses/LGPL-2.1.txt` |
| zstd | 1.5.7-r2 | BSD-3-Clause OR GPL-2.0-or-later | `third-party/zstd-LICENSE.txt` |
| Python package attrs | 26.1.0 | MIT | `third-party/attrs-LICENSE.txt` |
| Python package idna | 3.19 | BSD-3-Clause | `third-party/idna-LICENSE.md` |
| Python package outcome | 1.3.0.post0 | MIT OR Apache-2.0 | `third-party/outcome-LICENSE.MIT.txt`, `licenses/Apache-2.0.txt` |
| Python package pycryptodome | 3.23.0 | BSD-2-Clause AND LicenseRef-Public-Domain | `third-party/pycryptodome-LICENSE.rst` |
| Python package python-netlink | 0.0.15 | GPL-3.0 | `licenses/GPL-3.0.txt` |
| Python package sniffio | 1.3.1 | MIT OR Apache-2.0 | `third-party/sniffio-LICENSE.MIT.txt`, `licenses/Apache-2.0.txt` |
| Python package sortedcontainers | 2.4.0 | Apache-2.0 | `third-party/sortedcontainers-LICENSE.txt`, `licenses/Apache-2.0.txt` |
| Python package trio | 0.33.0 | MIT OR Apache-2.0 | `third-party/trio-LICENSE.MIT.txt`, `licenses/Apache-2.0.txt` |
| Python package zstandard | 0.25.0 | BSD-3-Clause | `third-party/zstandard-LICENSE.txt`, `third-party/zstd-LICENSE.txt` |
| pokeldn (formerly frlg-ldn-trade) transport package | d68be4d1985a9b9cad5d881e9b1221b8cbe76037 | AGPL-3.0 | `licenses/AGPL-3.0.txt` |
| LDN Python package (kinnay/LDN, vendored in pokeldn) | 0.0.17 | GPL-3.0-only | `licenses/GPL-3.0.txt`, `third-party/LDN-UPSTREAM.md` |
| Pokémon Suite radio relay, guest init and probe/bootstrap scripts | 0.1.0-local.7-minimal-qemu | MIT | `third-party/pokemon-suite-LICENSE.txt`, `licenses/AGPL-3.0.txt` |

## Notes

- **alpine-keys and alpine-release:** MIT per Alpine's package metadata. They contain only public signing keys and release data files; no upstream notice file exists.
- **SQLite:** public domain (<https://sqlite.org/copyright.html>).
- **Mozilla CA certificate data** (`ca-certificates-bundle`): MPL-2.0, generated by Alpine's MIT-licensed tools.
- **Realtek firmware** (`rtw88/rtw8822b_fw.bin`): redistributed unmodified in binary form under `third-party/realtek-LICENCE.rtlwifi_firmware.txt`.
- **Dual-licensed components:** the radio uses the BSD option for libfdt, zstd and libcap. libelf is used under GPL-2.0-or-later (LGPL-3.0-or-later is also offered).
- **QEMU:** GPL-2.0-only overall; `third-party/qemu-LICENSE.txt` explains the licenses of its individual files.
