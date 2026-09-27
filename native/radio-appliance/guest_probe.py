"""Disposable hardware qualification guest; never opens a trading lobby."""
from pathlib import Path
import json
import re
import subprocess
import time


def command(*args):
    return subprocess.check_output(args, stderr=subprocess.STDOUT, text=True, timeout=5)


def verify_network_tools():
    # BusyBox accepts most setup commands but lacks `ip neigh replace`.
    # Exercise the real TAP/neighbor path before a console can join the lobby.
    interface, ip, mac = 'suite-net-probe', '169.254.1.2', '02:00:00:00:00:02'
    created = False
    try:
        command('ip', 'tuntap', 'add', 'dev', interface, 'mode', 'tap')
        created = True
        command('ip', 'link', 'set', interface, 'up')
        command('ip', 'addr', 'add', '169.254.1.1/24', 'dev', interface)
        command('ip', 'neigh', 'replace', ip, 'lladdr', mac, 'dev', interface, 'nud', 'permanent')
        entries = json.loads(command('ip', '-j', 'neigh', 'show', 'dev', interface))
        if not any(e.get('dst') == ip and e.get('lladdr') == mac and 'PERMANENT' in e.get('state', []) for e in entries):
            raise RuntimeError('Permanent neighbor was not installed')
        return True
    except Exception:
        raise RuntimeError('Radio network setup is unavailable; reinstall the radio runtime.') from None
    finally:
        if created:
            command('ip', 'link', 'del', interface)


def qualify(root=Path('/sys'), timeout=20):
    verify_network_tools()
    deadline = time.monotonic() + timeout
    while (radio := discover(root)) is None:
        if time.monotonic() >= deadline:
            raise TimeoutError('Archer USB adapter has no ready wireless interface')
        time.sleep(0.1)
    phy, interface = radio
    capabilities = command('iw', 'phy', phy, 'info')
    if not all(re.search(r'^\s*\* ' + mode + r'\s*$', capabilities, re.M) for mode in ('AP', 'monitor')):
        raise RuntimeError('Radio must support AP and monitor modes')
    command('iw', 'phy', phy, 'interface', 'add', 'suite-probe', 'type', 'monitor')
    try:
        command('ip', 'link', 'set', 'suite-probe', 'up')
        command('iw', 'dev', 'suite-probe', 'set', 'channel', '1')
    finally:
        command('iw', 'dev', 'suite-probe', 'del')
    return {'ready': True, 'phy': phy, 'interface': interface,
            'usb': '2357:012d', 'monitorChannel': 1, 'apSupported': True,
            'permanentNeighborsVerified': True,
            'tradeQualified': False}


def discover(root):
    matches = []
    for phy in (Path(root) / 'class/ieee80211').glob('phy*'):
        device = (phy / 'device').resolve()
        try:
            for ancestor in (device, *device.parents):
                vendor, product = ancestor / 'idVendor', ancestor / 'idProduct'
                if vendor.exists() and product.exists():
                    if (vendor.read_text().strip().lower(), product.read_text().strip().lower()) == ('2357', '012d'):
                        interfaces = sorted((device / 'net').iterdir())
                        if len(interfaces) == 1:
                            matches.append((phy.name, interfaces[0].name))
                    break
        except FileNotFoundError:
            # USB mode changes can remove this sysfs entry while it is read.
            continue
    if len(matches) > 1:
        raise RuntimeError('Multiple Archer adapters require explicit selection')
    return matches[0] if matches else None


if __name__ == '__main__':
    try:
        report = qualify()
    except Exception as error:
        report = {'ready': False, 'error': str(error), 'tradeQualified': False}
    report['schema'] = 'pokemon-suite/radio-probe/v1'
    report['uptimeSeconds'] = float(Path('/proc/uptime').read_text().split()[0])
    report['kernel'] = command('uname', '-r').strip()
    print('SUITE_RADIO_PROBE=' + json.dumps(report, separators=(',', ':')), flush=True)
