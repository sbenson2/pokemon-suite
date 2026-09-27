"""Exercise the actual native input transport against an isolated HTTP receiver."""
import http.server
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('swift'), 'Native Mac playback requires Swift on macOS')
class NativePlaybackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory(prefix='suite-native-input-')
        cls.addClassCleanup(cls.workspace.cleanup)
        root = Path(cls.workspace.name)
        shutil.copytree(ROOT / 'macos/Sources/SuiteCore', root / 'Sources/SuiteCore')
        (root / 'Sources/Probe').mkdir(parents=True)
        shutil.copyfile(ROOT / 'macos/Sources/PokemonSuiteMac/GamePlayback.swift', root / 'Sources/Probe/GamePlayback.swift')
        (root / 'Package.swift').write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "NativeInputTest", platforms: [.macOS(.v14)], targets: [.target(name: "SuiteCore"), .executableTarget(name: "Probe", dependencies: ["SuiteCore"])], swiftLanguageModes: [.v5])
''')
        (root / 'Sources/Probe/Probe.swift').write_text('''import Foundation
import SuiteCore
@main struct Probe {
    @MainActor static func main() async throws {
        let api = SuiteAPI(baseURL: URL(string: CommandLine.arguments[1])!)
        try await api.connect()
        let playback = GamePlayback()
        let mode = CommandLine.arguments[2]
        let platform = mode == "touch" ? "nds" : mode == "analog" ? "switch" : "gba"
        playback.connect(api: api, game: "firered", sessionID: "fixture-red", platform: platform)
        playback.manual = true
        if mode == "touch" { playback.updateInput(GameInputState(touch: GameTouch(x: 128, y: 96)), source: "touch") }
        else if mode == "analog" { playback.updateInput(GameInputState(axes: [0.8, -0.6, 0, 0]), source: "controller") }
        else { playback.input(["up", "left"]) }
        if CommandLine.arguments[2] == "switch" {
            try await Task.sleep(for: .milliseconds(300))
            playback.connect(api: api, game: "emerald", sessionID: "fixture-green")
            playback.manual = true
            playback.input(["right"])
        }
        for _ in 0..<6 {
            try await Task.sleep(for: .milliseconds(200))
            if CommandLine.arguments[2] == "hold" { playback.input(["up", "left"]) }
        }
        if CommandLine.arguments[2] == "manual-off" { playback.manual = false }
        else { playback.releaseInput() }
        try await Task.sleep(for: .milliseconds(350))
        try await api.post("/finished")
        playback.stop()
    }
}
''')
        build = subprocess.run(['swift', 'build', '--package-path', str(root)], capture_output=True, text=True, timeout=120)
        if build.returncode:
            raise RuntimeError(build.stderr)
        cls.executable = root / '.build/debug/Probe'

    def exercise(self, mode):
        calls = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path.startswith('/game/'):
                    self.send_error(503, 'No emulator attached to this fixture')
                    return
                self.send_response(200)
                self.send_header('Set-Cookie', 'suite=test')
                self.end_headers()
                self.wfile.write(b'{}')

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                calls.append({'path': self.path, 'body': body, 'time': time.monotonic()})
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}')

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            process = subprocess.run([str(self.executable), f'http://127.0.0.1:{server.server_port}', mode], capture_output=True, text=True, timeout=12)
            self.assertEqual(process.returncode, 0, process.stderr)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        end = next(i for i, call in enumerate(calls) if call['path'] == '/finished')
        return [call for call in calls[:end] if call['path'] == '/api/pokemon-suite/input']

    def test_held_directions_refresh_before_the_emulator_failsafe_expires(self):
        calls = self.exercise('hold')
        held = [call for call in calls if call['body']['buttons']]
        self.assertGreaterEqual(len(held), 3, 'A held input needs periodic refresh, even when the key set is unchanged')
        self.assertTrue(all(set(call['body']['buttons']) == {'up', 'left'} for call in held))
        self.assertLess(max(b['time'] - a['time'] for a, b in zip(calls, calls[1:])), .75)
        self.assertEqual(calls[-1]['body']['buttons'], [])

    def test_disabling_manual_control_releases_held_buttons(self):
        calls = self.exercise('manual-off')
        self.assertEqual(calls[-1]['body']['buttons'], [], 'Taking manual control away must release the controller immediately')

    def test_touch_only_hold_refreshes_and_releases(self):
        calls = self.exercise('touch')
        held = [call for call in calls if call['body']['touch']['pressed']]
        self.assertGreaterEqual(len(held), 3)
        self.assertTrue(all(call['body']['touch'] == {'x': 128, 'y': 96, 'pressed': True} for call in held))
        self.assertFalse(calls[-1]['body']['touch']['pressed'])
        self.assertLess(max(b['time'] - a['time'] for a, b in zip(calls, calls[1:])), .75)

    def test_analog_only_hold_refreshes_and_centers(self):
        calls = self.exercise('analog')
        held = [call for call in calls if any(call['body']['axes'])]
        self.assertGreaterEqual(len(held), 3)
        self.assertTrue(all(call['body']['axes'] == [0.8, -0.6, 0, 0] for call in held))
        self.assertEqual(calls[-1]['body']['axes'], [0, 0, 0, 0])

    def test_switching_games_releases_the_original_controller_before_the_new_press(self):
        calls = self.exercise('switch')
        old_release = next(i for i, call in enumerate(calls) if call['body'] == {'game': 'firered', 'buttons': []})
        new_press = next(i for i, call in enumerate(calls) if call['body'] == {'game': 'emerald', 'buttons': ['right']})
        self.assertLess(old_release, new_press)
        self.assertTrue(all(call['body']['game'] == 'emerald' for call in calls[new_press:]))
        self.assertEqual(calls[-1]['body']['buttons'], [])


if __name__ == '__main__':
    unittest.main()
