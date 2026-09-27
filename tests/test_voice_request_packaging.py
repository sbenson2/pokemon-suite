"""Voice requests (G5): the Mac app and the iOS companion declare why they use
the microphone and speech recognition, link Speech, and share the Ask UI.

The build scripts are inspected, not run (a Mac build needs a gate receipt;
the companion build needs Xcode). Without the usage descriptions macOS and iOS
terminate the app the first time it asks for either permission.
"""
import ast
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MAC = ROOT/'scripts/build-macos.py'
IOS = ROOT/'native/ios/build-companion.py'
USAGE = ('NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription')


def literal_dicts(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict) and all(isinstance(k, ast.Constant) for k in node.keys):
            yield {k.value: v for k, v in zip(node.keys, node.values)}


def string(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


class MacInfoPlistTests(unittest.TestCase):
    def setUp(self):
        self.source = MAC.read_text()
        tree = ast.parse(self.source)
        build = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build')
        assigned = [n for n in ast.walk(build) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'info' for t in n.targets)]
        self.assertEqual(len(assigned), 1, 'one Info.plist dictionary')
        self.info = {k.value: v for k, v in zip(assigned[0].value.keys, assigned[0].value.values)}

    def test_usage_descriptions_explain_voice_requests(self):
        for key in USAGE:
            with self.subTest(key=key):
                text = string(self.info.get(key))
                self.assertTrue(text, f'{key} is missing from the Mac Info.plist')
                self.assertIn('request', text.lower())
        self.assertIn('on this Mac', string(self.info['NSSpeechRecognitionUsageDescription']), 'recognition stays on the device')

    def test_no_hardened_runtime_without_the_audio_input_entitlement(self):
        # The app is ad-hoc signed without the hardened runtime or the App
        # Sandbox, so TCC needs only the usage descriptions. Enabling either
        # later also requires com.apple.security.device.audio-input
        # (or device.microphone in the sandbox).
        hardened = '--options' in self.source or 'runtime' in {string(a) for n in ast.walk(ast.parse(self.source)) if isinstance(n, ast.List) for a in n.elts}
        if hardened:
            self.assertIn('com.apple.security.device.audio-input', self.source)
        self.assertNotIn('com.apple.security.app-sandbox', self.source)


class CompanionProjectTests(unittest.TestCase):
    def setUp(self):
        self.tree = ast.parse(IOS.read_text())
        self.dicts = list(literal_dicts(self.tree))

    def test_usage_descriptions_are_generated_into_the_companion_plist(self):
        settings = next(d for d in self.dicts if 'INFOPLIST_KEY_NSLocalNetworkUsageDescription' in d)
        for key in USAGE:
            with self.subTest(key=key):
                text = string(settings.get('INFOPLIST_KEY_' + key))
                self.assertTrue(text, f'INFOPLIST_KEY_{key} is missing from the companion build settings')
                self.assertIn('request', text.lower())
        self.assertIn('on this device', string(settings['INFOPLIST_KEY_NSSpeechRecognitionUsageDescription']))

    def test_companion_links_speech_and_compiles_the_shared_ask_ui(self):
        target = next(d for d in self.dicts if string(d.get('type')) == 'application')
        sdks = [string(dep.get('sdk')) for dep in literal_dicts(target['dependencies'])]
        self.assertIn('Speech.framework', sdks)
        self.assertIn('AVFoundation.framework', sdks)
        shared = [string(e) for n in ast.walk(target['sources']) if isinstance(n, ast.List) for e in n.elts if string(e)]
        for name in ('BotView.swift', 'BotAskView.swift', 'SpeechDictation.swift'):
            self.assertIn(name, shared)
        for name in shared:
            self.assertTrue((ROOT/'macos/Sources/PokemonSuiteMac'/name).is_file(), name)


class AskSourceTests(unittest.TestCase):
    """Guards for code that needs a microphone or a live host to exercise."""
    SHARED = ROOT/'macos/Sources/PokemonSuiteMac'

    def test_dictation_never_falls_back_to_server_recognition(self):
        source = (self.SHARED/'SpeechDictation.swift').read_text()
        self.assertIn('requiresOnDeviceRecognition = true', source)
        self.assertNotIn('requiresOnDeviceRecognition = false', source)
        self.assertIn('supportsOnDeviceRecognition', source, 'a language without on-device recognition is explained, not sent to a server')

    def test_dictation_punctuates_and_hears_the_game_vocabulary(self):
        # Unpunctuated multi-step requests used to lose steps, and names were heard with no hints (voice audit).
        source = (self.SHARED/'SpeechDictation.swift').read_text()
        self.assertIn('addsPunctuation = true', source)
        self.assertRegex(source, r'contextualStrings = Array\(\w+\.prefix\(DictationVocabulary\.limit\)\)', 'at most 100 hints (Apple limit)')
        self.assertIn('requiresOnDeviceRecognition = true', source, 'hints never loosen on-device recognition')
        ask = (self.SHARED/'BotAskView.swift').read_text()
        self.assertIn('DictationVocabulary.phrases(session: model.session', ask, 'hints come from the live session (party, hunt target)')
        self.assertIn('hints: vocabulary', ask)

    def test_every_place_and_item_hint_is_a_spelling_the_interpreter_reads(self):
        # A hint steers what the recognizer writes, so each must parse ("Exp Share"; the host does not read "Poké Mart" or "PC box").
        import copy, json
        from pokemon_suite import pokemon_requests as pr
        source = (ROOT/'macos/Sources/SuiteCore/DictationVocabulary.swift').read_text()
        hints = {name: re.findall(r'"([^"]+)"', re.search(rf'static let {name} = \[(.*?)\]', source, re.S).group(1)) for name in ('commands', 'places')}
        context = json.loads((ROOT/'tests/data/request-context.json').read_text())
        def steps(text):
            r = pr.Interpreter().interpret(text, via='voice', context=copy.deepcopy(context))
            return r['understood'], [c['intent'] for c in r['clauses'] if c['status'] == 'accepted']
        self.assertGreaterEqual(len(hints['places']), 30)
        self.assertLessEqual(len(hints['commands']) + len(hints['places']), 88, 'room for a full party, its nicknames and the hunt targets under 100')
        for place in hints['places']:
            self.assertEqual(steps(f'Go to {place}.'), (True, ['travel']), place)
        for item in ('Poké Ball', 'Great Ball', 'Ultra Ball', 'Master Ball', 'Rare Candy', 'Exp Share', 'Silph Scope'):
            self.assertIn(item, hints['commands'])
            self.assertEqual(steps(f'Get me a {item}.'), (True, ['item']), item)

    def test_ask_warms_laya_when_it_opens_and_when_the_mic_is_tapped(self):
        ask = (self.SHARED/'BotAskView.swift').read_text()
        opened = re.search(r'\.task \{[^\n]*flow\.warm\(\)', ask)
        self.assertTrue(opened, 'Ask opening starts Laya loading')
        mic = ask[ask.index('private func toggleDictation'):]
        self.assertIn('flow.warm()', mic[:mic.index('dictation.toggle')], 'a mic tap starts Laya loading before the owner speaks')

    def test_ask_ui_only_calls_the_request_and_goal_endpoints(self):
        sources = [(self.SHARED/'BotAskView.swift').read_text(), (ROOT/'macos/Sources/SuiteCore/BotRequest.swift').read_text()]
        for source in sources:
            for forbidden in ('/api/pokemon-suite/input', 'player-tasks', 'playback', 'GameInput', 'pressButton', 'sendInput'):
                self.assertNotIn(forbidden, source, 'the Ask UI never sends game input')
        endpoints = set(re.findall(r'"(/api/[^"]+)"', sources[1]))
        self.assertEqual(endpoints, {'/api/pokemon-suite/requests/interpret', '/api/pokemon-suite/requests/commit', '/api/pokemon-suite/requests/cancel',
                                     '/api/pokemon-suite/requests/warm', '/api/pokemon-suite/goals', '/api/pokemon-suite/goals/cancel'})

    def test_companion_relay_allows_every_ask_endpoint(self):
        from pokemon_suite.companion import allowed_route
        for path in ('/api/pokemon-suite/requests/interpret', '/api/pokemon-suite/requests/commit', '/api/pokemon-suite/requests/cancel',
                     '/api/pokemon-suite/requests/warm', '/api/pokemon-suite/goals/cancel'):
            self.assertTrue(allowed_route('POST', path), path)
        self.assertTrue(allowed_route('GET', '/api/pokemon-suite/goals'))


if __name__ == '__main__':
    unittest.main()
