import collections
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


class ServerBurstTests(unittest.TestCase):
    def test_a_page_load_burst_gets_every_file(self):
        # A browser opens many connections at once for the page's scripts and
        # styles (about thirty). Chrome 154 was refused some of them by the
        # listen backlog of five, so scripts went missing and the page broke.
        with tempfile.TemporaryDirectory() as data:
            server = subprocess.Popen([sys.executable, '-m', 'pokemon_suite', '--data-dir', data, 'serve', '--port', '0'],
                                      cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            try:
                url = json.loads(server.stdout.readline())['url']
                files = ['pokemon-suite.js', 'standalone.js', 'pokemon-items.js', 'style.css', 'pokemon-suite.css'] * 12
                results, lock = collections.Counter(), threading.Lock()
                barrier = threading.Barrier(len(files))

                def fetch(name):
                    barrier.wait()
                    try:
                        with urllib.request.urlopen(url + name, timeout=20) as response:
                            outcome = response.status
                    except OSError as error:
                        outcome = type(error).__name__
                    with lock:
                        results[outcome] += 1

                threads = [threading.Thread(target=fetch, args=(name,)) for name in files]
                for thread in threads: thread.start()
                for thread in threads: thread.join()
            finally:
                server.terminate()
                server.wait(timeout=20)
        self.assertEqual(dict(results), {200: len(files)})


if __name__ == '__main__':
    unittest.main()
