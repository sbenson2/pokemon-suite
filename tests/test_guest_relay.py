import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock

path=Path(__file__).resolve().parents[1]/'native/radio-appliance/guest_relay.py'
spec=importlib.util.spec_from_file_location('guest_relay',path);guest=importlib.util.module_from_spec(spec);spec.loader.exec_module(guest)


class BootstrapTests(unittest.TestCase):
    def test_missing_kernel_cipher_is_not_reported_as_radio_ready(self):
        with patch.object(guest.subprocess,'run'), patch.object(guest.socket,'socket',side_effect=OSError('algorithm missing')):
            with self.assertRaisesRegex(RuntimeError,'encryption'):
                guest.verify_kernel_crypto()

    def test_kernel_ccmp_key_setup_is_checked_with_synthetic_key_only(self):
        channel=MagicMock()
        with patch.object(guest.subprocess,'run'), patch.object(guest.socket,'socket',return_value=channel):
            guest.verify_kernel_crypto()
        opened=channel.__enter__.return_value
        opened.bind.assert_called_once_with(('aead','ccm(aes)'))
        opened.setsockopt.assert_called_once_with(279,1,bytes(16))

    def test_bootstrap_does_not_consume_first_rfu_command(self):
        read,write=os.pipe()
        request={'type':'bootstrap','version':1,'keys':{k:'ab'*16 for k in ('master_key_00','master_key_12','aes_kek_generation_source','aes_key_generation_source')}}
        following=b'{"type":"heartbeat","game":"firered"}\n'
        try:
            os.write(write,json.dumps(request).encode()+b'\n'+following)
            self.assertEqual(guest.read_request(read),request)
            self.assertEqual(os.read(read,4096),following)
        finally:os.close(read);os.close(write)

    def test_untrusted_request_is_rejected_without_echoing_keys(self):
        read,write=os.pipe()
        try:
            os.write(write,b'{"type":"bootstrap","keys":"PRIVATE-CREDENTIAL"}\n')
            with self.assertRaises(ValueError) as error:guest.read_request(read)
            self.assertNotIn('PRIVATE-CREDENTIAL',str(error.exception))
        finally:os.close(read);os.close(write)

    def test_bootstrap_eof_is_not_an_empty_valid_request(self):
        read,write=os.pipe();os.close(write)
        try:
            with self.assertRaises(EOFError):guest.read_request(read)
        finally:os.close(read)

    def test_bootstrap_timeout_is_bounded(self):
        read,write=os.pipe()
        try:
            with self.assertRaises(TimeoutError):guest.read_request(read,timeout=0.01)
        finally:os.close(read);os.close(write)


if __name__=='__main__':unittest.main()
