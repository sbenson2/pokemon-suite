import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

script=Path(__file__).resolve().parents[1]/'scripts/build-macos.py'
spec=importlib.util.spec_from_file_location('mac_builder',script);builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)


class RadioPackagingTests(unittest.TestCase):
    def fixture(self,root,with_keys=False):
        entries=[]
        for name in ['bin/qemu-system-aarch64','guest/vmlinuz','guest/initramfs.cpio.gz']+(['prod.keys'] if with_keys else []):
            p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'fixture')
            entries.append({'path':name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
        (root/'radio-manifest.json').write_text(json.dumps({'schema':'pokemon-suite/radio-runtime/v1','entrypoints':{'qemu':'bin/qemu-system-aarch64','kernel':'guest/vmlinuz','initramfs':'guest/initramfs.cpio.gz'},'files':entries}))

    def test_only_verified_runtime_files_are_bundled(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'source';source.mkdir();self.fixture(source)
            (source/'unlisted-private-file').write_text('private')
            target=root/'target';builder.copy_radio_runtime(source,target)
            self.assertTrue((target/'guest/initramfs.cpio.gz').is_file())
            self.assertFalse((target/'unlisted-private-file').exists())

    def test_licence_notices_ship_beside_the_radio_runtime(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'source';source.mkdir();self.fixture(source)
            notices=root/'notices';(notices/'licenses').mkdir(parents=True)
            (notices/'NOTICE.md').write_text('notice');(notices/'licenses/GPL-2.0.txt').write_text('gpl')
            runtime=root/'Runtime';runtime.mkdir()
            builder.copy_radio_runtime(source,runtime/'RadioHost',notices=notices)
            self.assertEqual((runtime/'RadioHost-licenses/NOTICE.md').read_text(),'notice')
            self.assertTrue((runtime/'RadioHost-licenses/licenses/GPL-2.0.txt').is_file())
            self.assertFalse((runtime/'RadioHost/NOTICE.md').exists(),'the verified runtime folder holds only manifest files')

    def test_console_key_file_cannot_be_bundled_even_if_listed(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'source';source.mkdir();self.fixture(source,with_keys=True)
            with self.assertRaises(ValueError):builder.copy_radio_runtime(source,root/'target')


if __name__=='__main__':unittest.main()
