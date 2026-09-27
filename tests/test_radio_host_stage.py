"""Run a relocated Mach-O program after its original libraries disappear."""
import importlib.util
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/stage-radio-host.py'
spec = importlib.util.spec_from_file_location('stage_radio_host', SCRIPT)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


@unittest.skipUnless(platform.system() == 'Darwin', 'Mach-O packaging requires macOS')
class RelocationTests(unittest.TestCase):
    def test_staged_program_uses_its_transitive_libraries_after_originals_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            source.mkdir()
            (source / 'base.c').write_text('int base(void) { return 40; }')
            (source / 'answer.c').write_text('int base(void); int answer(void) { return base()+2; }')
            (source / 'main.c').write_text('#include <stdio.h>\nint answer(void); int main(void) { printf("%d\\n",answer()); return 0; }')
            for name, extra in [('base', []), ('answer', [str(source / 'libbase.dylib')])]:
                library = source / ('lib' + name + '.dylib')
                subprocess.run(['clang', '-dynamiclib', str(source / (name + '.c')), *extra,
                                '-install_name', str(library), '-o', str(library)], check=True, capture_output=True)
            subprocess.run(['clang', str(source / 'main.c'), str(source / 'libanswer.dylib'),
                            '-o', str(source / 'probe')], check=True, capture_output=True)
            output = root / 'staged'
            executable = host.stage(source / 'probe', output)
            self.assertIsNotNone(executable, 'Staging must produce a runnable executable')
            shutil.rmtree(source)
            self.assertEqual(subprocess.check_output([str(executable)], text=True).strip(), '42')
            self.assertEqual(len(list((output / 'lib').glob('*.dylib'))), 2)

    def test_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            keep = output / 'keep'
            keep.write_text('existing')
            with self.assertRaises(ValueError):
                host.stage(Path('/missing'), output)
            self.assertEqual(keep.read_text(), 'existing')


if __name__ == '__main__':
    unittest.main()
