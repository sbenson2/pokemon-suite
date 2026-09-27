import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import os
import socket
import threading
from unittest.mock import patch

from pokemon_suite import radio_appliance as radio


class ApplianceTests(unittest.TestCase):
    def test_packet_stream_sends_stop_on_owner_eof_without_closing_guest_response_channel(self):
        left,right=socket.socketpair();read,write=os.pipe();out_read,out_write=os.pipe()
        heartbeat=b'{"type":"heartbeat","game":"firered"}\n'
        response=b'{"type":"flow","received":0,"pending":0}\n{"type":"available","advertising":false}\n'
        observed=[]
        def guest():
            right.settimeout(2)
            try:
                data=b''
                while b'{"type":"stop"}\n' not in data:
                    chunk=right.recv(4096)
                    if not chunk:break
                    data+=chunk
                observed.append(data)
                right.sendall(response[:7]);right.sendall(response[7:])
            except OSError as error:observed.append(str(error))
            finally:right.close()
        thread=threading.Thread(target=guest);thread.start()
        try:
            os.write(write,heartbeat);os.close(write)
            radio.pump(read,left,out_write,timeout=3)
            os.close(out_write);out_write=None
            self.assertEqual(os.read(out_read,4096),response)
            thread.join(3)
            self.assertEqual(observed,[heartbeat+b'{"type":"stop"}\n'])
        finally:
            left.close();right.close();os.close(read);os.close(out_read)
            if out_write is not None:os.close(out_write)
            thread.join(3)

    def test_new_attempt_preserves_previous_guest_logs_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for attempt in range(7):
                with radio.open_attempt_log(root) as log:
                    log.write(f'attempt {attempt}'.encode())
            self.assertEqual((root/'appliance.log').read_text(),'attempt 6')
            self.assertEqual((root/'appliance.1.log').read_text(),'attempt 5')
            self.assertEqual((root/'appliance.5.log').read_text(),'attempt 1')
            self.assertFalse((root/'appliance.6.log').exists())
            self.assertEqual((root/'appliance.log').stat().st_mode & 0o777,0o600)
            (root/'appliance.log').unlink()
            other=root/'other';other.write_text('untouched')
            (root/'appliance.log').symlink_to(other)
            with self.assertRaises(ValueError):radio.open_attempt_log(root)
            self.assertEqual(other.read_text(),'untouched')

    def test_only_the_four_required_radio_keys_leave_the_host(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'keys'
            path.write_text('\n'.join(k+' = '+'ab'*16 for k in radio.REQUIRED_KEYS) + '\nother_console_secret = '+'cd'*16)
            value = radio.read_credentials(path)
            self.assertEqual(set(value), set(radio.REQUIRED_KEYS))
            self.assertNotIn('other_console_secret', json.dumps(value))

    def test_missing_or_malformed_keys_never_report_their_contents(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'keys';path.write_text('master_key_00 = SECRET-CONTENT')
            with self.assertRaises(ValueError) as error:radio.read_credentials(path)
            self.assertNotIn('SECRET-CONTENT', str(error.exception))

    def test_usb_match_uses_vendor_and_product_not_display_name(self):
        devices=[{'USB Product Name':'Archer','idVendor':1,'idProduct':301},
                 {'IORegistryEntryChildren':[{'idVendor':9047,'idProduct':301}]}]
        self.assertTrue(radio.has_adapter(devices))
        self.assertFalse(radio.has_adapter(devices[:1]))

    def test_missing_hardware_gives_actionable_instructions_without_booting_vm(self):
        with patch.object(radio, 'runtime_paths', return_value={'qemu':'q','kernel':'k','initramfs':'i'}), \
             patch.object(radio, 'read_credentials', return_value={}), \
             patch.object(radio, 'attached', return_value=False):
            result=radio.readiness({'runtime':'/runtime','keysPath':'/keys'})
        self.assertFalse(result['ready'])
        self.assertEqual(result['state'],'hardware-missing')
        self.assertIn('Archer',result['reason'])

    def test_rejects_runtime_manifest_escape(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/'radio-manifest.json').write_text(json.dumps({'schema':'pokemon-suite/radio-runtime/v1',
                'files':[{'path':'../outside','sha256':'0'*64}],
                'entrypoints':{'qemu':'../outside','kernel':'kernel','initramfs':'root'}}))
            with self.assertRaises(ValueError):radio.runtime_paths(root)

    def test_malformed_runtime_manifest_reports_unavailable(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for value in [[], {'schema':'pokemon-suite/radio-runtime/v1','files':[None]},
                          {'schema':'pokemon-suite/radio-runtime/v1','files':[],'entrypoints':[]}]:
                (root/'radio-manifest.json').write_text(json.dumps(value))
                self.assertEqual(radio.readiness({'runtime':d})['state'],'runtime-missing')


if __name__=='__main__':unittest.main()
