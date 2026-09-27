"""G4: the pinned Laya sidecar behind the request interpreter.

Written before the implementation (fail-first). The model and its runtime are
pinned in reviewed source like a cartridge; a missing, tampered, slow or
crashing model always leaves the deterministic parser's answer unchanged.
"""
import copy
import hashlib
import json
import os
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from pokemon_suite import laya_runtime as lr
from pokemon_suite import pokemon_requests as pr

DATA = Path(__file__).resolve().parent / 'data'
CONTEXT = json.loads((DATA / 'request-context.json').read_text())
ROWS = [json.loads(line) for line in (DATA / 'request-phrasings.jsonl').read_text().splitlines() if line.strip()]
# blind2-b is the never-tuned split: it is kept out of every G4 test and calibration fit.
BLIND = [r for r in (json.loads(line) for line in (DATA / 'request-phrasings-blind.jsonl').read_text().splitlines() if line.strip()) if r['split'] != 'blind2-b']
SAMPLE = ['get me a shiny mewtwo', 'heal up', 'where are you', 'make me a sandwich', 'catch a mewt', 'buy 5 ultra balls and then save',
          'trade my shiny charizard', 'release my magikarp', 'start a new game as NOVA with squirtle', 'yo could u grab me a timid abra']


def context():
    return copy.deepcopy(CONTEXT)


def stable(result):
    """An interpret result without its volatile fields (uuid, time) and Laya diagnostics."""
    out = copy.deepcopy(result)
    for k in ('draftId', 'laya', 'parser'):
        out.pop(k, None)
    goal = out.get('goal')
    if goal:
        goal.pop('id', None)
        goal.pop('createdAt', None)
        (goal.get('source') or {}).get('interpreter', {}).pop('parser', None)
    return out


def deterministic(text, answers=None):
    return pr.Interpreter().interpret(text, via='typed', context=context(), answers=answers)


# --------------------------------------------------------------------------------------------
# A fake asset folder with the real layout (asset.json, pins.sha256, model/, runtime/)
# --------------------------------------------------------------------------------------------
def build_asset(root, asset_id='test-asset', extra_runtime=None):
    root = Path(root)
    files = {
        'model/laya.onnx': b'graph',
        'model/laya.onnx.data': b'weights' * 100,
        'model/laya_config.json': b'{"max_len": 512, "head_max_len": 192}',
        'model/tokenizer/tokenizer.json': b'{}',
        'model/tokenizer/tokenizer_config.json': b'{"mask_token": "[MASK]"}',
        'runtime/site-packages/fakeort/__init__.py': b'# runtime package',
    }
    files.update(extra_runtime or {})
    manifest = {'schema': lr.ASSET_SCHEMA, 'id': asset_id, 'python': lr.python_tag(), 'model': 'model', 'runtime': 'runtime/site-packages'}
    files['asset.json'] = json.dumps(manifest, sort_keys=True).encode()
    for rel, data in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(data)
    pins = {rel: hashlib.sha256(data).hexdigest() for rel, data in files.items()}
    (root / lr.PINS_NAME).write_text(''.join(f'{pins[rel]}  {rel}\n' for rel in sorted(pins)))
    known = {asset_id: lr.reviewed_entry(pins)}
    return root, known


class AssetPins(unittest.TestCase):
    def test_a_verified_asset_names_its_reviewed_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root, known = build_asset(folder)
            info = lr.verify_asset(root, known=known)
            self.assertEqual(info['id'], 'test-asset')
            self.assertEqual(Path(info['model']), root / 'model')

    def test_a_tampered_model_file_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root, known = build_asset(folder)
            data = bytearray((root / 'model/laya.onnx.data').read_bytes())
            data[3] ^= 1
            (root / 'model/laya.onnx.data').write_bytes(bytes(data))
            with self.assertRaisesRegex(lr.LayaUnavailable, 'sha256'):
                lr.verify_asset(root, known=known)

    def test_local_pins_cannot_approve_other_weights(self):
        """Rewriting pins.sha256 to match tampered weights is still refused: the reviewed source decides."""
        with tempfile.TemporaryDirectory() as folder:
            root, known = build_asset(folder)
            (root / 'model/laya.onnx.data').write_bytes(b'other weights')
            lines = [line for line in (root / lr.PINS_NAME).read_text().splitlines() if not line.endswith('model/laya.onnx.data')]
            lines.append(f"{hashlib.sha256(b'other weights').hexdigest()}  model/laya.onnx.data")
            (root / lr.PINS_NAME).write_text('\n'.join(sorted(lines, key=lambda l: l.split('  ')[1])) + '\n')
            with self.assertRaisesRegex(lr.LayaUnavailable, 'reviewed'):
                lr.verify_asset(root, known=known)

    def test_an_unknown_asset_id_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root, _ = build_asset(folder, asset_id='someone-elses-model')
            with self.assertRaisesRegex(lr.LayaUnavailable, 'reviewed'):
                lr.verify_asset(root, known={})

    def test_an_unpinned_extra_file_is_refused(self):
        """A dropped-in sitecustomize.py or .pth would run inside the sidecar."""
        with tempfile.TemporaryDirectory() as folder:
            root, known = build_asset(folder)
            (root / 'runtime/site-packages/sitecustomize.py').write_text('print("hi")')
            with self.assertRaisesRegex(lr.LayaUnavailable, 'not pinned'):
                lr.verify_asset(root, known=known)

    def test_a_missing_pinned_file_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root, known = build_asset(folder)
            (root / 'model/tokenizer/tokenizer.json').unlink()
            with self.assertRaisesRegex(lr.LayaUnavailable, 'missing'):
                lr.verify_asset(root, known=known)

    def test_symlinks_and_escaping_pins_are_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root, known = build_asset(Path(folder) / 'asset')
            outside = Path(folder) / 'outside.bin'
            outside.write_bytes(b'weights' * 100)
            (root / 'model/laya.onnx.data').unlink()
            (root / 'model/laya.onnx.data').symlink_to(outside)
            with self.assertRaisesRegex(lr.LayaUnavailable, 'symlink'):
                lr.verify_asset(root, known=known)
        with tempfile.TemporaryDirectory() as folder:
            root, known = build_asset(folder)
            with (root / lr.PINS_NAME).open('a') as stream:
                stream.write(f"{'0' * 64}  ../escape.bin\n")
            with self.assertRaises(lr.LayaUnavailable):
                lr.verify_asset(root, known=known)

    def test_the_runtime_must_match_the_host_python(self):
        with tempfile.TemporaryDirectory() as folder:
            root, known = build_asset(folder)
            with self.assertRaisesRegex(lr.LayaUnavailable, 'Python'):
                lr.verify_asset(root, known=known, python='cp399')

    def test_the_reviewed_assets_pin_every_model_file(self):
        self.assertTrue(lr.LAYA_ASSETS, 'at least one reviewed Laya asset')
        for asset_id, entry in lr.LAYA_ASSETS.items():
            with self.subTest(asset=asset_id):
                self.assertIn('model/laya.onnx', entry['files'])
                self.assertIn('model/laya.onnx.data', entry['files'])
                self.assertIn('asset.json', entry['files'])
                self.assertRegex(entry['runtimeTree'], r'^[0-9a-f]{64}$')
                for rel, digest in entry['files'].items():
                    self.assertRegex(digest, r'^[0-9a-f]{64}$')
                    self.assertFalse(rel.startswith('/') or '..' in rel.split('/'))


# --------------------------------------------------------------------------------------------
# Sidecar process: lazy start, timeouts, crashes (a fake sidecar stands in for onnxruntime)
# --------------------------------------------------------------------------------------------
FAKE_SIDECAR = textwrap.dedent('''
    import json, os, sys, time
    mode = sys.argv[1]
    marker = sys.argv[2] if len(sys.argv) > 2 else None
    if marker:
        open(marker, "a").write("started %d\\n" % os.getpid())
    if mode == "slow-load":
        time.sleep(2.0)
    if mode == "fail-load":
        print(json.dumps({"ready": False, "error": "could not load"}), flush=True)
        sys.exit(1)
    print(json.dumps({"ready": True, "asset": "test-asset", "loadMs": 1}), flush=True)
    calls = 0
    for line in sys.stdin:
        if not line.strip():  # like the real sidecar: read (its idle exit starts over), never answered
            if marker:
                open(marker, "a").write("touched\\n")
            continue
        request = json.loads(line)
        calls += 1
        if mode == "hang":
            time.sleep(30)
        if mode in ("slow-call", "slow-then-hang") and calls == 1:
            time.sleep(0.8)
        if mode == "slow-then-hang" and calls > 1:
            time.sleep(30)
        if mode == "crash" and calls == 1:
            sys.exit(3)
        answers = {}
        for qid, q in request["questions"].items():
            if q["type"] == "choice":
                keys = list(q["criteria"])
                pick = "heal" if "heal" in keys else keys[0]
                if mode == "slow-call":
                    pick = keys[0]
                answers[qid] = {"type": "choice", "choice": pick, "probabilities": {k: (0.9 if k == pick else 0.1 / max(1, len(keys) - 1)) for k in keys}, "confidence": 0.8}
            else:
                answers[qid] = {"type": "noul", "noul": 0.9, "confidence": 0.9}
        print(json.dumps({"id": request["id"], "answers": answers}), flush=True)
''')


class Sidecar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root, self.known = build_asset(Path(self.tmp.name) / 'asset')
        self.script = Path(self.tmp.name) / 'fake_sidecar.py'
        self.script.write_text(FAKE_SIDECAR)
        self.marker = Path(self.tmp.name) / 'started.txt'
        self.agents = []

    def tearDown(self):
        for agent in self.agents:
            agent.close()
        self.tmp.cleanup()

    def agent(self, mode='ok', timeout=1.0, **extra):
        agent = lr.SidecarAgent(self.root, known=self.known, timeout=timeout, command=[sys.executable, str(self.script), mode, str(self.marker)], **extra)
        self.agents.append(agent)
        return agent

    def wait_ready(self, agent, seconds=10):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if agent.ready():
                return True
            if agent.failed():
                return False
            time.sleep(0.02)
        return False

    def test_round_trip_through_the_sidecar(self):
        agent = self.agent()
        agent.start()
        self.assertTrue(self.wait_ready(agent), agent.reason)
        answers = agent.predict({'request': 'heal up'}, {'intent': {'type': 'choice', 'instructions': 'x', 'criteria': {'travel': 'a', 'heal': 'b'}}})['answers']
        self.assertEqual(answers['intent']['choice'], 'heal')

    def test_a_hanging_call_times_out_and_the_interpreter_stays_deterministic(self):
        agent = self.agent('hang', timeout=0.5, hang_after=30)
        agent.start()
        self.assertTrue(self.wait_ready(agent), agent.reason)
        started = time.monotonic()
        with self.assertRaises(lr.LayaTimeout):
            agent.predict({'request': 'heal up'}, {'q': {'type': 'noul', 'instructions': 'x'}})
        self.assertLess(time.monotonic() - started, 2.0, 'the call returns within its budget')
        agent2 = self.agent('hang', timeout=0.3)
        agent2.start()
        self.assertTrue(self.wait_ready(agent2), agent2.reason)
        classifier = pr.LayaClassifier(agent_factory=lambda: agent2)
        interp = pr.Interpreter(classifier=classifier)
        for text in ('heal up', 'catch a mewt', 'get me a shiny mewtwo'):
            with self.subTest(text=text):
                self.assertEqual(stable(interp.interpret(text, context=context())), stable(deterministic(text)))

    def test_a_sidecar_that_stays_unresponsive_is_killed_and_restarted(self):
        agent = self.agent('hang', timeout=0.3, hang_after=0.6)
        agent.start()
        self.assertTrue(self.wait_ready(agent), agent.reason)
        with self.assertRaises(lr.LayaTimeout):
            agent.predict({'request': 'x'}, {'q': {'type': 'noul', 'instructions': 'x'}})
        self.assertTrue(agent.running(), 'one slow answer does not cost a reload')
        time.sleep(0.7)
        with self.assertRaises(lr.LayaWarmingUp):
            agent.predict({'request': 'x'}, {'q': {'type': 'noul', 'instructions': 'x'}})
        self.assertTrue(self.wait_ready(agent), agent.reason)
        self.assertEqual(self.marker.read_text().count('started'), 2, 'the hung sidecar was replaced')

    def test_a_late_answer_is_discarded_and_the_next_call_gets_its_own(self):
        agent = self.agent('slow-call', timeout=0.4, hang_after=30)
        agent.start()
        self.assertTrue(self.wait_ready(agent), agent.reason)
        with self.assertRaises(lr.LayaTimeout):
            agent.predict({'request': 'first'}, {'q': {'type': 'choice', 'instructions': 'x', 'criteria': {'first': 'a', 'b': 'b'}}})
        time.sleep(0.5)
        answers = agent.predict({'request': 'second'}, {'q': {'type': 'choice', 'instructions': 'x', 'criteria': {'second': 'a', 'b': 'b'}}})['answers']
        self.assertEqual(answers['q']['choice'], 'second', 'the stale reply to the first call is skipped')

    def test_a_late_answer_never_gets_a_healthy_sidecar_killed(self):
        """Regression (NL audit): after one timeout the late reply sat unread, so the next call made more than
        hang_after later took the healthy sidecar for hung, killed it and fell back (LayaWarmingUp)."""
        agent = self.agent('slow-call', timeout=0.3, hang_after=0.6)
        agent.start()
        self.assertTrue(self.wait_ready(agent), agent.reason)
        q = {'q': {'type': 'noul', 'instructions': 'x'}}
        with self.assertRaises(lr.LayaTimeout):
            agent.predict({'request': 'a'}, q)
        time.sleep(1.0)  # the late answer (after 0.8 s) has arrived: the sidecar is healthy
        self.assertEqual(agent.predict({'request': 'b'}, q)['answers']['q']['noul'], 0.9)
        self.assertEqual(self.marker.read_text().count('started'), 1, 'the healthy sidecar was kept')

    def test_a_request_still_unanswered_after_a_late_reply_is_hung(self):
        """Only a request the sidecar never answered counts: here the first reply arrives late, the second never."""
        agent = self.agent('slow-then-hang', timeout=0.3, hang_after=0.6)
        agent.start()
        self.assertTrue(self.wait_ready(agent), agent.reason)
        q = {'q': {'type': 'noul', 'instructions': 'x'}}
        with self.assertRaises(lr.LayaTimeout):
            agent.predict({'request': 'a'}, q)
        time.sleep(1.0)
        with self.assertRaises(lr.LayaTimeout):
            agent.predict({'request': 'b'}, q)
        self.assertTrue(agent.running(), 'one slow answer does not cost a reload')
        time.sleep(0.7)
        with self.assertRaises(lr.LayaWarmingUp):
            agent.predict({'request': 'c'}, q)
        self.assertTrue(self.wait_ready(agent), agent.reason)
        self.assertEqual(self.marker.read_text().count('started'), 2, 'the hung sidecar was replaced')

    def test_wait_ready_gives_a_loading_sidecar_a_bounded_wait(self):
        agent = self.agent('slow-load')
        started = time.monotonic()
        self.assertFalse(agent.wait_ready(0.2))
        self.assertLess(time.monotonic() - started, 1.0)
        self.assertTrue(agent.wait_ready(10), agent.reason)
        self.assertTrue(agent.wait_ready(0))
        self.assertEqual(self.marker.read_text().count('started'), 1, 'waiting never starts a second sidecar')
        (self.root / 'model/laya.onnx.data').write_bytes(b'tampered')
        broken = self.agent()
        started = time.monotonic()
        self.assertFalse(broken.wait_ready(3))
        self.assertLess(time.monotonic() - started, 2.0, 'a sidecar that cannot start is not waited for')

    def pids(self):
        return [int(line.split()[1]) for line in self.marker.read_text().splitlines() if line.startswith('started ')] if self.marker.exists() else []

    @staticmethod
    def alive(pid):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        return True

    def test_close_cancels_a_boot_still_in_progress(self):
        """Release-1 review: close() during the host's startup warm-up (the asset still being verified) left the boot to spawn a sidecar
        afterwards; a later start() then launched a second one and the first was orphaned."""
        verify = lr.verify_asset

        def slow_verify(*args, **kwargs):
            time.sleep(0.5)
            return verify(*args, **kwargs)
        with patch.object(lr, 'verify_asset', slow_verify):
            agent = self.agent()
            agent.start()
            time.sleep(0.1)
            agent.close()
            time.sleep(1.5)
            self.assertFalse(agent.running())
            self.assertFalse(agent.ready())
            self.assertFalse(agent.failed(), 'a cancelled boot is no failure: the next request starts Laya again')
            self.assertEqual([pid for pid in self.pids() if self.alive(pid)], [], 'no sidecar outlives close()')
            agent.start()
            agent.close()
            agent.start()
            self.assertTrue(self.wait_ready(agent), agent.reason)
            time.sleep(0.8)  # every superseded boot has finished
            self.assertEqual(len([pid for pid in self.pids() if self.alive(pid)]), 1, 'one live sidecar')
            agent.close()
            deadline = time.monotonic() + 3
            while any(self.alive(pid) for pid in self.pids()) and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertEqual([pid for pid in self.pids() if self.alive(pid)], [], 'close() stops every sidecar it started')

    def test_a_close_while_loading_is_no_failure(self):
        agent = self.agent('slow-load')
        agent.start()
        deadline = time.monotonic() + 5
        while not self.pids() and time.monotonic() < deadline:
            time.sleep(0.02)
        agent.close()
        time.sleep(0.3)
        self.assertFalse(agent.failed(), agent.reason)
        self.assertTrue(agent.wait_ready(10), 'restarts at once: no retry_after back-off')

    def test_warming_a_ready_sidecar_resets_its_idle_exit(self):
        """Release-1 review: warm() on a ready sidecar sent nothing, so Ask opened at minute 9:59 of idle found it exiting moments later."""
        agent = self.agent()
        service = self.service(agent)
        agent.start()
        self.assertTrue(self.wait_ready(agent), agent.reason)
        self.assertNotIn('touched', self.marker.read_text())
        self.assertEqual(service.warm(), {'laya': 'ready'})
        deadline = time.monotonic() + 3
        while 'touched' not in self.marker.read_text() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertIn('touched', self.marker.read_text(), 'a blank line: the sidecar reads it and its idle timer starts over')
        self.assertEqual(agent.predict({'request': 'heal up'}, {'q': {'type': 'noul', 'instructions': 'x'}})['answers']['q']['noul'], 0.9,
                         'the keep-alive is never answered, so it never takes the next call\'s reply')
        self.assertEqual(self.marker.read_text().count('started'), 1)

    def test_a_classifier_closed_with_the_host_starts_no_sidecar(self):
        agent = self.agent()
        classifier = pr.LayaClassifier(agent_factory=lambda: agent, calibration=pr.G3_COMBINATION)
        classifier.close()
        self.assertEqual(classifier.warm(), 'unavailable')
        self.assertFalse(classifier.wait_ready(0.3))
        with self.assertRaises(lr.LayaUnavailable):
            classifier.predict({'request': 'x'}, {'q': {'type': 'noul', 'instructions': 'x'}})
        self.assertEqual(pr.Interpreter(classifier=classifier).interpret('heal up', context=context())['parser'], 'deterministic')
        time.sleep(0.3)
        self.assertEqual(self.pids(), [], 'a late warm-up or request after shutdown launches nothing')

    def service(self, agent, calibration=pr.G3_COMBINATION):
        class Server:
            pass
        return pr.RequestService(Server(), interpreter=pr.Interpreter(classifier=pr.LayaClassifier(agent_factory=lambda: agent, calibration=calibration)),
                                 context_provider=context)

    def test_the_request_service_warms_laya_without_waiting(self):
        agent = self.agent('slow-load')
        service = self.service(agent)
        started = time.monotonic()
        self.assertEqual(service.warm(), {'laya': 'loading'})
        self.assertLess(time.monotonic() - started, 0.5, 'warming up never waits for the model')
        self.assertTrue(self.wait_ready(agent), agent.reason)
        self.assertEqual(service.warm(), {'laya': 'ready'})
        self.assertEqual(self.marker.read_text().count('started'), 1)
        self.assertEqual(service.interpret({'text': 'heal up', 'via': 'typed'})['parser'], 'laya', 'the warmed sidecar answers the first request')
        self.assertEqual(pr.RequestService(type('Server', (), {})(), interpreter=pr.Interpreter()).warm(), {'laya': 'off'})
        with self.assertRaises(pr.RequestError):
            service.warm({'text': 'heal'})

    def test_the_first_and_every_voice_request_wait_for_a_loading_sidecar(self):
        self.assertTrue(2.0 <= pr.RequestService.laya_wait <= 3.5, 'about 3 s')
        agent = self.agent('slow-load')  # loads in about 2 s
        service = self.service(agent)
        service.laya_wait = 8.0  # headroom for a busy test machine; the default is about 3 s
        first = service.interpret({'text': 'heal up', 'via': 'typed'})
        self.assertEqual(first['parser'], 'laya', 'the first request after startup waits for the sidecar')
        self.assertGreater(first['laya']['waitMs'], 0)
        agent.close()  # e.g. the idle exit
        started = time.monotonic()
        typed = service.interpret({'text': 'heal up', 'via': 'typed'})
        self.assertLess(time.monotonic() - started, 1.0, 'a later typed request never waits')
        self.assertEqual(typed['parser'], 'deterministic')
        self.assertNotIn('waitMs', typed['laya'])
        self.assertTrue(self.wait_ready(agent), agent.reason)
        agent.close()
        voice = service.interpret({'text': 'heal up', 'via': 'voice'})
        self.assertEqual(voice['parser'], 'laya', 'a spoken request waits for the sidecar it starts')
        self.assertEqual(self.marker.read_text().count('started'), 3)

    def test_a_voice_request_never_waits_for_a_shadow_only_laya(self):
        agent = self.agent('slow-load')
        service = self.service(agent, calibration=None)
        service.laya_wait = 8.0
        started = time.monotonic()
        result = service.interpret({'text': 'heal up', 'via': 'voice'})
        self.assertLess(time.monotonic() - started, 1.0, 'Laya cannot change this decision, so it is not worth a wait')
        self.assertEqual(result['parser'], 'deterministic')

    def test_the_request_that_starts_the_sidecar_never_kills_it(self):
        """Regression (G4 e2e): the first request waited for loading, got the leftover budget, timed out and
        killed the sidecar it had just started, so Laya never came up."""
        agent = self.agent('slow-load', timeout=2.5)
        started = time.monotonic()
        with self.assertRaises(lr.LayaWarmingUp):
            agent.predict({'request': 'x'}, {'q': {'type': 'noul', 'instructions': 'x'}})
        self.assertLess(time.monotonic() - started, 0.5, 'a request never waits for the model to load')
        self.assertTrue(self.wait_ready(agent), agent.reason)
        self.assertEqual(agent.predict({'request': 'x'}, {'q': {'type': 'noul', 'instructions': 'x'}})['answers']['q']['noul'], 0.9)
        self.assertEqual(self.marker.read_text().count('started'), 1)

    def test_a_crash_falls_back_and_the_next_request_restarts_it(self):
        agent = self.agent('crash', timeout=1.0)
        agent.start()
        self.assertTrue(self.wait_ready(agent), agent.reason)
        with self.assertRaises(lr.LayaUnavailable):
            agent.predict({'request': 'heal'}, {'q': {'type': 'noul', 'instructions': 'x'}})
        agent.start()
        self.assertTrue(self.wait_ready(agent), agent.reason)
        self.assertEqual(self.marker.read_text().count('started'), 2)

    def test_a_request_while_loading_uses_the_deterministic_parser(self):
        agent = self.agent('slow-load', timeout=0.2)
        classifier = pr.LayaClassifier(agent_factory=lambda: agent)
        interp = pr.Interpreter(classifier=classifier)
        started = time.monotonic()
        result = interp.interpret('heal up', context=context())
        self.assertLess(time.monotonic() - started, 1.5, 'the first request never waits for the model to load')
        self.assertEqual(stable(result), stable(deterministic('heal up')))
        self.assertEqual(result['parser'], 'deterministic')
        self.assertTrue(self.wait_ready(agent), agent.reason)
        later = interp.interpret('heal up', context=context())
        self.assertEqual(later['parser'], 'laya')
        self.assertTrue(later['understood'])

    def test_a_failed_verification_never_launches_the_sidecar(self):
        (self.root / 'model/laya.onnx.data').write_bytes(b'tampered')
        agent = self.agent()
        agent.start()
        deadline = time.monotonic() + 5
        while not agent.failed() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(agent.failed())
        self.assertIn('sha256', agent.reason)
        self.assertFalse(self.marker.exists(), 'the sidecar was never started')
        with self.assertRaises(lr.LayaUnavailable):
            agent.predict({'request': 'x'}, {'q': {'type': 'noul', 'instructions': 'x'}})

    def test_a_load_failure_is_reported(self):
        agent = self.agent('fail-load')
        agent.start()
        deadline = time.monotonic() + 5
        while not agent.failed() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(agent.failed())
        self.assertIn('could not load', agent.reason)

    def test_the_real_sidecar_is_launched_isolated_from_the_app_environment(self):
        command = lr.SidecarAgent(self.root, known=self.known).command()
        self.assertEqual(command[0], sys.executable)
        self.assertIn('-I', command)
        self.assertIn('-S', command)
        self.assertIn('-B', command, 'no .pyc may be written into the pinned runtime folder')
        script = next(part for part in command if part.endswith('laya_sidecar.py'))
        self.assertTrue(Path(script).is_file())
        self.assertLess(command.index('-B'), command.index(script))


# --------------------------------------------------------------------------------------------
# The sidecar script's pure parts (no numpy/onnxruntime needed): sequences and answers
# --------------------------------------------------------------------------------------------
class FakeTokenizer:
    """Whitespace tokenizer with laya's special tokens."""
    def __init__(self):
        self.vocab = {'[CLS]': 1, '[SEP]': 2, '[MASK]': 3, '[PAD]': 0}

    def encode(self, text):
        out = []
        for word in text.split():
            out.append(self.vocab.setdefault(word, len(self.vocab)))
        return out


class SidecarScript(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import importlib.util
        path = Path(pr.__file__).with_name('laya_sidecar.py')
        spec = importlib.util.spec_from_file_location('laya_sidecar_under_test', path)
        cls.sc = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.sc)

    def test_the_sequence_matches_laya_layout(self):
        tok = FakeTokenizer()
        q = self.sc.internal({'type': 'choice', 'instructions': 'Which?', 'criteria': {'heal': 'Heal the party', 'travel': None}})
        ids, markers = self.sc.build_sequence(tok.encode, {'cls': 1, 'sep': 2, 'mask': 3}, '[MASK]', 'heal up', q, 512, 192)
        self.assertEqual(ids[0], 1)
        self.assertEqual(len(markers), 2)
        self.assertTrue(all(ids[m] == 3 for m in markers))
        self.assertEqual(ids[-1], 2)

    def test_many_options_are_truncated_like_laya(self):
        tok = FakeTokenizer()
        crit = {f'option-{i}': 'a long description with many many words to overflow the head budget' for i in range(38)}
        q = self.sc.internal({'type': 'choice', 'instructions': 'Which?', 'criteria': crit})
        ids, markers = self.sc.build_sequence(tok.encode, {'cls': 1, 'sep': 2, 'mask': 3}, '[MASK]', 'x', q, 512, 192)
        self.assertEqual(len(markers), 38)
        gaps = [b - a for a, b in zip(markers, markers[1:])]
        self.assertEqual(set(gaps), {4}, 'max(4, (192 - 16) // 38) tokens per option')

    def test_answers_apply_the_checkpoint_temperature(self):
        q = self.sc.internal({'type': 'choice', 'instructions': 'x', 'criteria': {'a': None, 'b': None}})
        answer = self.sc.decode_answer(q, [2.0, 0.0], 0, {'temperature': [2.0, 1.0, 1.0], 'temperature_by_options': {}})
        import math
        expected = math.exp(1.0) / (math.exp(1.0) + 1.0)
        self.assertAlmostEqual(answer['probabilities']['a'], round(expected, 4), places=4)
        self.assertEqual(answer['choice'], 'a')
        noul = self.sc.decode_answer(self.sc.internal({'type': 'noul', 'instructions': 'x'}), [0.0, 0.0], 2, {'temperature': [1, 1, 1]})
        self.assertAlmostEqual(noul['noul'], 0.5)

    def test_the_protocol_loop_answers_by_id_and_exits_when_idle(self):
        import io

        class Backend:
            def predict(self, state, questions, head_max_len=None):
                return {q: {'type': 'noul', 'noul': 0.25, 'confidence': 0.75} for q in questions}

        stdin = io.StringIO(json.dumps({'id': 7, 'state': 's', 'questions': {'q': {'type': 'noul', 'instructions': 'x'}}}) + '\n' + '{bad json\n')
        stdout = io.StringIO()
        self.sc.serve(Backend(), stdin, stdout, idle_exit=0)
        lines = [json.loads(l) for l in stdout.getvalue().splitlines()]
        self.assertEqual(lines[0]['id'], 7)
        self.assertEqual(lines[0]['answers']['q']['noul'], 0.25)
        self.assertIn('error', lines[1])
        stdout = io.StringIO()
        self.sc.serve(Backend(), io.StringIO('\n' + json.dumps({'id': 8, 'state': 's', 'questions': {'q': {'type': 'noul', 'instructions': 'x'}}}) + '\n'),
                      stdout, idle_exit=0)
        self.assertEqual([json.loads(l)['id'] for l in stdout.getvalue().splitlines()], [8], 'a blank keep-alive line is read and never answered')


# --------------------------------------------------------------------------------------------
# Configuration: off by default, missing runtime -> today's deterministic parser exactly
# --------------------------------------------------------------------------------------------
class Configuration(unittest.TestCase):
    def test_laya_is_off_unless_the_owner_turns_it_on(self):
        self.assertIsNone(pr.LayaClassifier.from_config({'laya': {'asset': '/nonexistent/laya-asset'}}))
        self.assertIsNone(pr.LayaClassifier.from_config({'laya': {'asset': '/nonexistent/laya-asset', 'mode': 'off'}}))
        self.assertIsNone(pr.LayaClassifier.from_config({}))

    def test_a_missing_asset_gives_exactly_the_deterministic_answers(self):
        classifier = pr.LayaClassifier.from_config({'laya': {'asset': '/nonexistent/laya-asset', 'mode': 'on'}})
        self.assertIsNotNone(classifier)
        interp = pr.Interpreter(classifier=classifier)
        for text in SAMPLE:
            with self.subTest(text=text):
                result = interp.interpret(text, context=context())
                self.assertEqual(stable(result), stable(deterministic(text)))
                self.assertEqual(result['parser'], 'deterministic')
        deadline = time.monotonic() + 5
        while not classifier.agent_failed() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertIn('not found', classifier.reason or classifier.agent_reason())

    def test_request_service_reads_the_asset_config(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'request-interpreter.json').write_text(json.dumps({'laya': {'asset': str(Path(folder) / 'missing'), 'mode': 'shadow', 'timeoutMs': 900}}))

            class Server:
                directory = folder
            service = pr.RequestService(Server(), context_provider=lambda: context())
            classifier = service.interpreter.classifier
            self.assertIsNotNone(classifier)
            self.assertEqual(classifier.mode, 'shadow')
            self.assertEqual(classifier.timeout, 0.9)
            result = service.interpret({'text': 'heal up'})
            self.assertEqual(stable(result), stable(deterministic('heal up')))
            service.close()


class HostPrewarm(unittest.TestCase):
    """The host starts Laya with itself (restarts and deploys used to leave the next requests rule-only)."""

    def test_the_host_warms_laya_at_startup_without_blocking(self):
        from pokemon_suite.server import SuiteServer
        calls, release = [], threading.Event()

        def warm(service, payload=None):
            calls.append((service, threading.current_thread() is threading.main_thread()))
            release.wait(5)
            return {'laya': 'loading'}
        with tempfile.TemporaryDirectory() as folder, patch.object(pr.RequestService, 'warm', warm):
            started = time.monotonic()
            server = SuiteServer(folder, 0)
            try:
                self.assertLess(time.monotonic() - started, 4.5, 'startup never waits for the warm-up')
                deadline = time.monotonic() + 5
                while not calls and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertEqual(len(calls), 1, 'the request service is created and warmed at startup')
                self.assertIs(calls[0][0], server.pokemon_requests)
                self.assertFalse(calls[0][1], 'the warm-up runs off the startup thread')
            finally:
                release.set()
                server.server_close()

    def test_closing_the_host_waits_for_its_warm_up_and_closes_what_it_started(self):
        """Release-1 review: a warm-up still running at shutdown created the service (and its sidecar) after server_close."""
        from pokemon_suite.server import SuiteServer
        closed = []

        def slow(server):
            time.sleep(0.5)
            return pr.service(server).warm()
        with tempfile.TemporaryDirectory() as folder, patch.object(pr, 'prewarm', slow), \
                patch.object(pr.RequestService, 'close', lambda service: closed.append(service)):
            server = SuiteServer(folder, 0)
            server.server_close()
            self.assertEqual(closed, [server.pokemon_requests])

    def test_a_failing_warm_up_never_escapes(self):
        def broken(service, payload=None):
            raise RuntimeError('boom')

        class Server:
            pass
        with patch.object(pr.RequestService, 'warm', broken):
            self.assertIsNone(pr.prewarm(Server()))
        server = Server()
        self.assertEqual(pr.prewarm(server), {'laya': 'off'})
        self.assertIsInstance(server.pokemon_requests, pr.RequestService, 'later requests reuse the warmed service')


# --------------------------------------------------------------------------------------------
# Calibrated combination: Laya never accepts what the deterministic layer rejects
# --------------------------------------------------------------------------------------------
class Adversary:
    """Always certain of one intent / entity and always 'actionable'."""
    def __init__(self, intent='catch', noul=1.0, raise_on=()):
        self.intent, self.noul, self.raise_on = intent, noul, set(raise_on)
        self.calls = 0

    def predict(self, state, questions):
        self.calls += 1
        answers = {}
        for qid, q in questions.items():
            if qid in self.raise_on:
                raise RuntimeError('model exploded')
            if q['type'] == 'choice':
                keys = list(q['criteria'])
                pick = self.intent if self.intent in keys else keys[-1]
                answers[qid] = {'type': 'choice', 'choice': pick, 'probabilities': {k: (1.0 if k == pick else 0.0) for k in keys}, 'confidence': 1.0}
            else:
                answers[qid] = {'type': 'noul', 'noul': self.noul, 'confidence': 1.0}
        return {'answers': answers}


PERMISSIVE = pr.LayaCalibration(intent_temperature=1.0, weight=1.0, switch_margin=0.0, promote=0.0, reject=None, entity_threshold=0.0)


_DET = {}


def det_result(text):
    if text not in _DET:
        _DET[text] = deterministic(text)
    return _DET[text]


class Calibration(unittest.TestCase):
    def test_temperature_rescales_probabilities(self):
        p = pr.calibrate({'a': 0.8, 'b': 0.2}, 2.0)
        self.assertAlmostEqual(p['a'], 2 / 3, places=4)
        self.assertAlmostEqual(sum(p.values()), 1.0, places=6)
        self.assertEqual(pr.calibrate({'a': 0.8, 'b': 0.2}, 1.0), {'a': 0.8, 'b': 0.2})

    def test_never_accepts_a_clause_the_code_layer_rejects(self):
        """Over every corpus row, with adversarial answers and the most permissive calibration."""
        rejected = [row['text'] for row in ROWS + BLIND if not det_result(row['text'])['understood'] and not det_result(row['text']).get('clarification')]
        self.assertGreater(len(rejected), 50)
        for intent in ('catch', 'travel', 'status-team', 'new-game', 'trade-shiny'):
            laya = pr.LayaClassifier(agent_factory=lambda intent=intent: Adversary(intent), calibration=PERMISSIVE)
            combined = pr.Interpreter(classifier=laya)
            for text in rejected:
                with self.subTest(intent=intent, text=text):
                    self.assertFalse(combined.interpret(text, context=context())['understood'])

    def test_never_picks_an_intent_the_code_layer_scored_below_clarify(self):
        seen = []
        original = pr.Interpreter._decide

        def spy(self, clause, laya, *a, **k):
            viable = {i for i, s, _ in clause.ranking if s >= pr.CLARIFY}
            original(self, clause, laya, *a, **k)
            if laya is not None and clause.status == 'accepted':
                seen.append((clause.text, clause.intent, viable))
        laya = pr.LayaClassifier(agent_factory=lambda: Adversary('cheat'), calibration=PERMISSIVE)
        pr.Interpreter._decide = spy
        try:
            interp = pr.Interpreter(classifier=laya)
            for row in ROWS[:300]:
                interp.interpret(row['text'], context=context())
        finally:
            pr.Interpreter._decide = original
        self.assertTrue(seen)
        for text, intent, viable in seen:
            self.assertIn(intent, viable, text)

    def test_a_promoted_clause_always_asks_the_owner_to_confirm(self):
        laya = pr.LayaClassifier(agent_factory=lambda: Adversary('catch'), calibration=PERMISSIVE)
        interp = pr.Interpreter(classifier=laya)
        promoted = 0
        for row in ROWS + BLIND:
            base = det_result(row['text'])
            if not base.get('clarification') or (base['clarification'] or {}).get('slot') != 'intent':
                continue
            result = interp.interpret(row['text'], context=context())
            if result['understood']:
                promoted += 1
                self.assertTrue(result['confirmation']['required'], row['text'])
        self.assertGreater(promoted, 0)

    def test_shadow_mode_never_changes_a_decision(self):
        laya = pr.LayaClassifier(agent_factory=lambda: Adversary('cheat', noul=0.0), calibration=PERMISSIVE, mode='shadow')
        interp = pr.Interpreter(classifier=laya)
        for text in SAMPLE:
            with self.subTest(text=text):
                result = interp.interpret(text, context=context())
                self.assertEqual(stable(result), stable(deterministic(text)))
                self.assertEqual(result['parser'], 'deterministic')
                self.assertEqual(result['laya']['mode'], 'shadow')
                self.assertTrue(result['laya']['consults'])

    def test_an_uncalibrated_model_is_consulted_in_shadow_only(self):
        laya = pr.LayaClassifier(agent_factory=lambda: Adversary('cheat', noul=0.0), calibration=None, mode='on')
        interp = pr.Interpreter(classifier=laya)
        for text in SAMPLE:
            with self.subTest(text=text):
                self.assertEqual(stable(interp.interpret(text, context=context())), stable(deterministic(text)))

    def test_a_model_error_during_the_entity_tiebreak_keeps_the_question(self):
        laya = pr.LayaClassifier(agent_factory=lambda: Adversary('catch', raise_on={'entity'}))
        result = pr.Interpreter(classifier=laya).interpret('catch a mewt', context=context())
        self.assertEqual(stable(result), stable(deterministic('catch a mewt')))
        self.assertEqual(result['clarification']['slot'], 'species')

    def test_the_shipped_calibrations_are_for_reviewed_assets(self):
        for asset_id, calibration in pr.LAYA_CALIBRATIONS.items():
            with self.subTest(asset=asset_id):
                self.assertIn(asset_id, lr.LAYA_ASSETS)
                self.assertIsInstance(calibration, pr.LayaCalibration)


if __name__ == '__main__':
    unittest.main()
