"""Hardware probe must not confuse USB presence with a usable radio."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json
import os
import sys

PATH = Path(__file__).resolve().parents[1] / 'native/radio-appliance/guest_probe.py'
spec = importlib.util.spec_from_file_location('guest_probe', PATH)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
host_spec = importlib.util.spec_from_file_location('radio_host_probe', PATH.parents[2] / 'scripts/probe-radio-appliance.py')
host = importlib.util.module_from_spec(host_spec)
host_spec.loader.exec_module(host)


class RadioDiscoveryTests(unittest.TestCase):
    def setUp(self):
        network = patch.object(probe, 'verify_network_tools', create=True)
        network.start()
        self.addCleanup(network.stop)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def radio(self, phy, vendor='2357', product='012d', interface='wlan0'):
        usb = self.root / 'devices' / phy
        device = usb / '1-1:1.0'
        (device / 'net' / interface).mkdir(parents=True)
        (usb / 'idVendor').write_text(vendor + '\n')
        (usb / 'idProduct').write_text(product + '\n')
        wireless = self.root / 'class/ieee80211' / phy
        wireless.mkdir(parents=True)
        (wireless / 'device').symlink_to(device)

    def test_follows_actual_phy_after_usb_reenumeration(self):
        self.radio('phy3', interface='wlan2')
        self.assertEqual(probe.discover(self.root), ('phy3', 'wlan2'))

    def test_ignores_other_wireless_hardware(self):
        self.radio('phy0', vendor='8086')
        self.assertIsNone(probe.discover(self.root))

    def test_usb_device_without_registered_phy_is_not_ready(self):
        usb = self.root / 'devices/usb1'
        usb.mkdir(parents=True)
        (usb / 'idVendor').write_text('2357')
        (usb / 'idProduct').write_text('012d')
        self.assertIsNone(probe.discover(self.root))

    def test_multiple_matching_adapters_are_not_chosen_arbitrarily(self):
        self.radio('phy1')
        self.radio('phy2')
        with self.assertRaisesRegex(RuntimeError, 'Multiple'):
            probe.discover(self.root)

    def test_failed_channel_setup_removes_created_monitor(self):
        self.radio('phy3', interface='wlan2')
        calls = []
        def command(*args):
            calls.append(args)
            if args == ('iw', 'phy', 'phy3', 'info'):
                return 'Supported interface modes:\n\t * AP\n\t * monitor\n'
            if args == ('iw', 'dev', 'suite-probe', 'set', 'channel', '1'):
                raise RuntimeError('Channel setup failed')
            return ''
        with patch.object(probe, 'command', side_effect=command):
            with self.assertRaisesRegex(RuntimeError, 'Channel setup failed'):
                probe.qualify(self.root)

        self.assertEqual(calls[-1], ('iw', 'dev', 'suite-probe', 'del'))

    def test_reports_ready_only_after_monitor_channel_is_usable(self):
        self.radio('phy3', interface='wlan2')
        calls = []
        def command(*args):
            calls.append(args)
            return '\t * AP\n\t * monitor\n' if args[-1] == 'info' else ''
        with patch.object(probe, 'command', side_effect=command):
            result = probe.qualify(self.root)
        self.assertTrue(result['ready'])
        self.assertEqual(result['phy'], 'phy3')
        self.assertIn(('iw', 'dev', 'suite-probe', 'set', 'channel', '1'), calls)
        self.assertEqual(calls[-1], ('iw', 'dev', 'suite-probe', 'del'))

    def test_missing_ap_capability_is_not_trade_hardware_readiness(self):
        self.radio('phy1')
        with patch.object(probe, 'command', return_value='\t * monitor\n'):
            with self.assertRaisesRegex(RuntimeError, 'AP and monitor'):
                probe.qualify(self.root)


class NetworkToolTests(unittest.TestCase):
    def test_probe_requires_a_verified_permanent_neighbor_and_removes_test_interface(self):
        ip, mac = '169.254.1.2', '02:00:00:00:00:02'
        for entries in ([], [{'dst':ip,'lladdr':mac,'state':['STALE']}],
                        [{'dst':ip,'lladdr':mac,'state':['PERMANENT']}]):
            calls = []
            def command(*args):
                calls.append(args)
                return json.dumps(entries) if '-j' in args else ''
            with patch.object(probe, 'command', side_effect=command):
                if entries and entries[0]['state'] == ['PERMANENT']:
                    self.assertTrue(probe.verify_network_tools())
                else:
                    with self.assertRaisesRegex(RuntimeError, 'network'):
                        probe.verify_network_tools()
            self.assertEqual(calls[-1], ('ip', 'link', 'del', 'suite-net-probe'))

    def test_unsupported_replace_command_prevents_radio_readiness(self):
        calls = []
        def command(*args):
            calls.append(args)
            if 'replace' in args:
                raise RuntimeError("ip: invalid argument 'replace' to 'ip'")
            return ''
        with patch.object(probe, 'command', side_effect=command):
            with self.assertRaisesRegex(RuntimeError, 'network'):
                probe.verify_network_tools()
        self.assertEqual(calls[-1], ('ip', 'link', 'del', 'suite-net-probe'))


class HostLifecycleTests(unittest.TestCase):
    report = {'schema': 'pokemon-suite/radio-probe/v1', 'ready': True, 'tradeQualified': False}

    def command(self, suffix=''):
        return [sys.executable, '-u', '-c', 'print(' + repr('SUITE_RADIO_PROBE=' + json.dumps(self.report)) + ')\n' + suffix]

    def test_accepts_report_only_after_guest_process_exits(self):
        self.assertTrue(host.run_probe_command(self.command()).get('ready'))

    def test_crashing_guest_cannot_report_success(self):
        with self.assertRaisesRegex(RuntimeError, 'exit'):
            host.run_probe_command(self.command('raise SystemExit(7)'))

    def test_missing_guest_report_is_not_success(self):
        with self.assertRaisesRegex(RuntimeError, 'report'):
            host.run_probe_command([sys.executable, '-c', 'print("USB detected")'])

    def test_hung_guest_is_reaped_even_if_it_reported_ready(self):
        with tempfile.TemporaryDirectory() as d:
            pid = Path(d) / 'pid'
            command = self.command('import os,time\nopen(' + repr(str(pid)) + ', "w").write(str(os.getpid()))\ntime.sleep(60)')
            with self.assertRaises(TimeoutError):
                host.run_probe_command(command, timeout=0.5)
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pid.read_text()), 0)

    def test_timeout_stops_descendant_when_direct_process_already_exited(self):
        with tempfile.TemporaryDirectory() as d:
            pid_file = Path(d) / 'pid'
            stopped = Path(d) / 'stopped'
            child = ('import os,time,signal,sys\n'
                     'def stop(*args):\n open(' + repr(str(stopped)) + ', "w").write("stopped")\n sys.exit(0)\n'
                     'signal.signal(signal.SIGTERM,stop)\nopen(' + repr(str(pid_file)) + ', "w").write(str(os.getpid()))\ntime.sleep(60)')
            parent = 'import subprocess,sys\nsubprocess.Popen([sys.executable,"-c",' + repr(child) + '])'
            try:
                with self.assertRaises(TimeoutError):
                    host.run_probe_command(self.command(parent), timeout=0.5)
                self.assertTrue(stopped.exists(), 'Descendant was left running after timeout')
            finally:
                if pid_file.exists():
                    try:
                        os.kill(int(pid_file.read_text()), 9)
                    except ProcessLookupError:
                        pass


if __name__ == '__main__':
    unittest.main()
