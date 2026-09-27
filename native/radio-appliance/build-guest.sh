#!/bin/sh
# Run inside the disposable Alpine builder with kmod and the LTS modloop mounted.
# ROOT must be an unpacked Alpine minirootfs with python3, iw and
# iproute2-minimal installed by apk (BusyBox ip lacks permanent neighbors).
set -eu
root=$(realpath "${1:?root filesystem required}")
output=$(realpath "${2:?existing output directory required}")
tools=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$root" in /tmp/*) ;; *) echo 'Use a disposable root under /tmp' >&2; exit 1;; esac
test -x "$root/usr/bin/python3"
test -x "$root/usr/sbin/iw"
chroot "$root" apk info -e iproute2-minimal > /dev/null
test ! -e "$root/init"
kernel=$(uname -r)
mkdir -p "$root/lib/modules/$kernel" "$root/lib/firmware/rtw88" "$root/opt/suite"
# Resolve each driver's complete dependency closure using the running kernel.
# CCMP is requested by mac80211 at key-install time, not a static driver import.
# Include the cipher and its kernel self-check interface explicitly.
for module in virtio_pci virtio_console xhci_pci af_packet rtw88_8822bu tun ccm aes_ce_ccm algif_aead; do
    modprobe --show-depends "$module" > "$output/module-$module.txt"
    awk '$1 == "insmod" {print $2}' "$output/module-$module.txt" | while read -r file; do
        mkdir -p "$root$(dirname "$file")"
        cp -L "$file" "$root$file"
    done
done
for file in /lib/modules/"$kernel"/modules.builtin*; do
    test ! -f "$file" || cp -L "$file" "$root/lib/modules/$kernel/"
done
for file in /lib/firmware/rtw88/rtw8822b_fw.bin*; do
    cp -L "$file" "$root/lib/firmware/rtw88/"
done
for file in /lib/firmware/regulatory.db*; do
    test ! -f "$file" || cp -L "$file" "$root/lib/firmware/"
done
depmod -b "$root" "$kernel"
cp "$tools/guest_probe.py" "$root/opt/suite/"
cp "$tools/init" "$root/init"
chmod 755 "$root/init"
chroot "$root" apk info -v > "$output/installed-packages.txt"
# Numeric root ownership is explicit; no host filesystems are mounted at runtime.
(cd "$root" && find . -xdev -print0 | sort -z | cpio --null -o -H newc -R 0:0) > "$output/rootfs.cpio"
gzip -9 -n -c "$output/rootfs.cpio" > "$output/initramfs.cpio.gz"
cp /media/cdrom/boot/vmlinuz-lts "$output/vmlinuz"
sha256sum "$output/vmlinuz" "$output/initramfs.cpio.gz"
