# Trading with a Switch

Pokémon Suite can trade between the FireRed game on your Mac and FireRed or LeafGreen on a real Nintendo Switch or Switch 2, over the console's local wireless. This page covers what you need and why.

> [!WARNING]
> This is experimental. It has been tested on one Mac, one adapter and one Switch 2 with English LeafGreen. Read [what's been tested](#whats-been-tested) before you trade anything you care about.

## What you need

| | |
|---|---|
| **A Mac with Apple silicon** | macOS 14 or later, with Pokémon Suite installed |
| **TP-Link Archer T3U** | The plain AC1300 model, USB ID `2357:012d`. Not the T3U Plus or T3U Nano. It has a USB-A plug, so most Macs also need a USB-C to USB-A adapter. |
| **FireRed or LeafGreen on Switch** | The Nintendo eShop release for Switch and Switch 2. It's standalone software; no Nintendo Switch Online membership is needed.<sup>[1]</sup> Play it until the Pokémon Center's Direct Corner opens, about 20–40 minutes in.<sup>[2]</sup> |
| **`prod.keys` from your own Switch** | The console's key file. Only four keys from it are used (see [below](#the-key-file)). Getting this file means running homebrew on your own Switch. If you can't do that, this feature isn't for you. |

The Mac's built-in Wi-Fi can't do this, and neither can most USB adapters on macOS.

## Why this adapter

The Switch trades over its own local wireless protocol, LDN. Talking to it needs an adapter that Linux can put into access-point mode and monitor mode at the same time.<sup>[3]</sup> macOS can't do that, so the app starts a small Linux virtual machine only while a trade is running and hands this one USB adapter to it. The VM has no disk, no network access to your Mac and no display; it exits when the trade is done.

The Archer T3U works for that because:

- Its chip is a Realtek RTL8812BU.<sup>[4]</sup>
- Linux's `rtw88_8822bu` driver supports it by name: the driver's device table lists `0x2357, 0x012d` as *"TP-Link Archer T3U v1"*. That support has been in the kernel since Linux 6.2.<sup>[5]</sup>
- The trade relay this app builds on rates it *"High"*, its best rating.<sup>[2]</sup>

TP-Link only lists version 1 of the T3U (sold as V1, V1.6, V1.8 and V1.46), and all of TP-Link's own drivers for it match the same USB ID.<sup>[6]</sup> Any T3U you can buy new should work.

Other adapters with the same chip, such as the Archer T3U Plus (`2357:0138`) or Archer T4U v3 (`2357:0115`), are in the same Linux driver,<sup>[5]</sup> but Pokémon Suite only passes `2357:012d` into the VM and hasn't been tested with anything else.

### Check that you have the right one

Plug the adapter in, then open **System Information** (hold ⌥ Option and choose Apple menu → System Information) and select **USB**. macOS lists it as **802.11ac NIC** from Realtek, with **USB Vendor ID 0x2357** and **USB Product ID 0x012d**.

Don't install TP-Link's Mac driver (it only supports up to macOS 10.14 anyway).<sup>[6]</sup> The VM uses its own Linux driver, and a macOS driver holding the adapter can stop the VM from taking it.

## The key file

The trade protocol is encrypted with keys derived from the Switch's own. Pokémon Suite reads four values from your `prod.keys`: `master_key_00`, `master_key_12`, `aes_kek_generation_source` and `aes_key_generation_source`.<sup>[7]</sup> When a trade starts, only those four are copied into the VM's memory. The file itself stays where you put it, and the app never uploads it anywhere.

This project doesn't include keys and doesn't explain how to get them. They have to come from your own console.

## Trading

1. In the Mac app, open **Trading**. It checks the setup on its own and tells you if the adapter or key file is missing. Choose **Console Keys** once to point it at your `prod.keys`.
2. Pick a Pokémon from your party or PC boxes and choose **Prepare Trade**. The bot heals your team, saves, walks to the Direct Corner and opens a room as the leader.
3. On the Switch, go to the Pokémon Center's upstairs Direct Corner and join the room. Choose the Pokémon to trade on the Switch as usual.
4. Both games save the way they normally do after a trade. The Mac checks that the new Pokémon is really in its save before calling the trade done, then shuts the VM down.

You can cancel while the bot is preparing or waiting for the Switch. Once the exchange has started, it won't stop halfway; an interrupted trade is kept for review, never retried on its own.

## What's been tested

| Date | Setup | Result |
|---|---|---|
| September 2026 | Mac mini (M1), Archer T3U, Switch 2, English LeafGreen | One complete exchange: a shiny Wigglytuff for a Chansey. Both games saved, the room was left normally, and the received Pokémon was confirmed in the Mac's save. |
| September 2026 | Same | A second exchange saved on both sides, then the connection dropped while leaving the room. The bot recovered with both saves intact. A fix for the likely cause is in the current release but hasn't been tried on hardware yet. |
| September 2026 | Same Mac and adapter, with the rebuilt radio (runtime local.7) | One complete exchange: a shiny Hitmonlee for a shiny Meowth. Both games saved, the room was left normally, and the received Pokémon was confirmed in the Mac's save. The trade was chosen while the bot was on Four Island, and the release it ran on couldn't route from the Sevii Islands to the Pokémon Center, so it was walked to the ferry by hand. The bot now takes the ferry itself. |

Not tested yet: the original Switch, Switch Lite and OLED, other Macs, repeated trades in one session, and pulling the adapter out mid-trade.

## Licenses and source

The VM bundles [QEMU](https://www.qemu.org) (GPL-2.0),<sup>[8]</sup> a Linux kernel and Alpine Linux packages, Realtek's redistributable firmware for the adapter,<sup>[9]</sup> the [pokeldn](https://github.com/Decryptu/pokeldn) trade relay (AGPL-3.0) and the [LDN](https://github.com/kinnay/LDN) protocol library (GPL-3.0), with the changes this project made to them. The complete corresponding source is attached to every release as `pokemon-suite-radio-sources-<version>.tar.gz`. See [licenses/radio](../licenses/radio/README.md).

## Other radios

The upstream relay, pokeldn, has since added support for an ESP32 board as the radio, which needs no Linux VM.<sup>[2]</sup> Pokémon Suite doesn't use that yet.

## Sources

1. Nintendo, [FireRed and LeafGreen on Nintendo Switch: FAQ](https://en-americas-support.nintendo.com/app/answers/detail/a_id/71365/): *"No, a Nintendo Switch Online membership is not needed"*; local wireless trading in the Pokémon Wireless Club works on Switch and Switch 2.
2. Decryptu/pokeldn (formerly frlg-ldn-trade), [README at the pinned revision](https://github.com/Decryptu/pokeldn/blob/d68be4d1985a9b9cad5d881e9b1221b8cbe76037/README.md): requirements, Direct Corner note and tested adapters (*"TP-Link Archer T3U (2357:012d) … rtw88_8822bu … High"*). Current [README](https://github.com/Decryptu/pokeldn) for the ESP32 radio.
3. kinnay/LDN, [README](https://github.com/kinnay/LDN): *"Your wireless hardware must also be able to receive and transmit action frames in monitor mode"*.
4. [linux-usb.org USB ID list](http://www.linux-usb.org/usb.ids): `2357 TP-Link` → `012d Archer T3U [Realtek RTL8812BU]`.
5. Linux kernel, [`rtw8822bu.c` device table](https://github.com/torvalds/linux/blob/v6.18/drivers/net/wireless/realtek/rtw88/rtw8822bu.c#L50-L51), added in [45794099f5e1](https://github.com/torvalds/linux/commit/45794099f5e1d7abc5eb07e6eec7e1e5c6cb540d) (Linux 6.2).
6. TP-Link, [Archer T3U product page](https://www.tp-link.com/us/home-networking/usb-adapter/archer-t3u/) and [support downloads](https://www.tp-link.com/us/support/download/archer-t3u/) (hardware versions; driver INF files match `USB\VID_2357&PID_012D`).
7. pokeldn's vendored LDN, [key loading](https://github.com/Decryptu/pokeldn/blob/d68be4d1985a9b9cad5d881e9b1221b8cbe76037/vendor/LDN/ldn/__init__.py#L136-L155).
8. QEMU, [license](https://www.qemu.org/docs/master/about/license.html).
9. linux-firmware, [WHENCE](https://git.kernel.org/pub/scm/linux/kernel/git/firmware/linux-firmware.git/tree/WHENCE) (`rtw88/rtw8822b_fw.bin`, *"Redistributable"*) and [LICENCE.rtlwifi_firmware.txt](https://git.kernel.org/pub/scm/linux/kernel/git/firmware/linux-firmware.git/tree/LICENSES/LICENCE.rtlwifi_firmware.txt).
