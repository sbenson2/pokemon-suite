"""Pinned local Laya runtime for the request interpreter (G4).

Laya runs in a sidecar process, never inside the host: the host's own Python
(``sys.executable``) is started in isolated mode (``-I -S``) on
``laya_sidecar.py`` with an external, pinned asset folder that holds an ONNX
export of the model and a small runtime (numpy, onnxruntime, tokenizers).
Nothing is added to the app bundle and torch is never needed.

The asset is pinned like a cartridge (see rom_integrity.py): the reviewed
identities below list the sha256 of every model file and a digest of the whole
runtime tree. Before the sidecar starts, the host checks that the folder's
pins.sha256 equals a reviewed entry, that every file on disk is pinned (no
symlinks, no extra files such as a dropped-in sitecustomize.py) and that every
file matches its sha256. A local pins file can never approve other weights.

The host starts the sidecar with itself and on a warm-up call (otherwise on
the first consult); it answers JSON lines over stdin/stdout, exits after an
idle period and is killed when a request stays unanswered too long. Every
failure is LayaUnavailable; the interpreter then keeps the deterministic
parser's decision.
"""
from __future__ import annotations

import hashlib
import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

ASSET_SCHEMA = 'pokemon-suite/laya-asset/v1'
PINS_NAME = 'pins.sha256'
MANIFEST_NAME = 'asset.json'
SIDECAR = Path(__file__).with_name('laya_sidecar.py')
DEFAULT_TIMEOUT = 1.5
DEFAULT_LOAD_TIMEOUT = 120.0
DEFAULT_IDLE_EXIT = 600
DEFAULT_THREADS = 4
RETRY_AFTER = 60.0

# Reviewed Laya assets. Adding or changing one requires a source review and a
# fresh calibration (pokemon_requests.LAYA_CALIBRATIONS). The weights come from
# convaiinnovations/laya (Apache-2.0) snapshot aa8c91ca…, exported to ONNX by
# receptron/laya-onnx @68f27dfe… (fp32, sha256 of laya.onnx.data 48774636…),
# then weight-only 8-bit quantized (onnxruntime MatMulNBits, block 32, symmetric,
# accuracy level 4; onnx 1.23.0, onnxruntime 1.30.0, onnx-ir 1.0.0; reproducible).
# The runtime is numpy 2.5.3, onnxruntime 1.30.0 and tokenizers 0.23.2 wheels
# for CPython 3.13 on macOS arm64, unpacked as-is.
LAYA_ASSETS = {
    'laya-en-aa8c91ca-onnx-q8': {
        'files': {
            'asset.json': '6018b5b3e18f80a34f2580ed7db26bff8ed01028d4ac5d3d5f073afbe1bce781',
            'model/laya.onnx': 'ee29e320cf22c7b1cd703da70cd382be203a472ecd0a99f605cadfb8cd31eb21',
            'model/laya.onnx.data': '9dd4023acab4e01a333b6bc6e7dfea5fc34c193d6490f0e130c3ec395e229b85',
            'model/laya_config.json': '5049005dc6ae3ca5e82cc7d85c421357d5c543817300c8e8c5281ddbc69bb561',
            'model/tokenizer/tokenizer.json': '6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30',
            'model/tokenizer/tokenizer_config.json': '50044de60daaa73df97d262e15a40d4faf0160e7d742df64b377877a1320dd12',
        },
        'runtimeTree': '657ab0d33fa02a537acdf1e14acf05bb61fc1f5f4088b08712a077d2c14ee2e0',
    },
    # L0.6 (.private/laya-finetune-20260924): convaiinnovations/laya@aa8c91ca multilingual/ (mmBERT-base, Apache-2.0)
    # fully fine-tuned on the request interpreter's typed decisions (intent / species tie-break / actionable),
    # ONNX export (torch dynamo, opset 18) + the same 8-bit MatMulNBits recipe and runtime wheels as above.
    # Calibrated in pokemon_requests.LAYA_CALIBRATIONS (Laya primary, deterministic fallback).
    'laya-ml-ft-l06-0762007a-onnx-q8': {
        'files': {
            'asset.json': '361895c2c077237a49ae95bd0b8aa2a83e26783e6e8b2bd936307734ef196239',
            'model/laya.onnx': 'a0c18846b298dab51333ab6e982950fa5f6aba14bda4fe98a18a3a6346e3db02',
            'model/laya.onnx.data': '0762007aef74432ae0ab98a765f8188bd5fa0f5a46e80db7b9c17868280bd45a',
            'model/laya_config.json': '7de12d5029e6834fa6ce19939380488cf9012e164fe2da91568b23d4075a2ddb',
            'model/tokenizer/tokenizer.json': '609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f',
            'model/tokenizer/tokenizer_config.json': '6c6b2d8e3c84ce0e671c129cd6b374b235d6f9863042a5836358d00a89bbb5a1',
        },
        'runtimeTree': '657ab0d33fa02a537acdf1e14acf05bb61fc1f5f4088b08712a077d2c14ee2e0',
    },
}


class LayaUnavailable(Exception):
    """Laya cannot answer (not installed, not verified, loading, stopped or failed)."""


class LayaWarmingUp(LayaUnavailable):
    pass


class LayaTimeout(LayaUnavailable):
    pass


def python_tag(version=None):
    major, minor = (version or sys.version_info)[:2]
    return f'cp{major}{minor}'


def tree_digest(pins):
    """sha256 over the sorted "<sha256>  <path>" lines (the runtime's identity)."""
    return hashlib.sha256(''.join(f'{pins[rel]}  {rel}\n' for rel in sorted(pins)).encode()).hexdigest()


def reviewed_entry(pins):
    """The reviewed-source form of a complete pins mapping (runtime files folded into one digest)."""
    runtime = {rel: digest for rel, digest in pins.items() if rel.startswith('runtime/')}
    return {'files': {rel: digest for rel, digest in pins.items() if not rel.startswith('runtime/')}, 'runtimeTree': tree_digest(runtime)}


def read_pins(root):
    path = Path(root) / PINS_NAME
    try:
        text = path.read_text(encoding='utf-8')
    except OSError:
        raise LayaUnavailable(f'The Laya asset has no {PINS_NAME}: {root}') from None
    pins = {}
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        digest, sep, rel = line.partition('  ')
        parts = rel.split('/')
        if not sep or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest) or not rel or rel.startswith('/') \
                or '\\' in rel or any(p in ('', '.', '..') for p in parts) or rel == PINS_NAME:
            raise LayaUnavailable(f'{PINS_NAME} line {number} is not "<sha256>  <relative path>" inside the asset.')
        if rel in pins:
            raise LayaUnavailable(f'{PINS_NAME} pins {rel} twice.')
        pins[rel] = digest
    if not pins:
        raise LayaUnavailable(f'{PINS_NAME} is empty.')
    return pins


def _sha256(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_asset(folder, known=None, python=None):
    """Check a Laya asset folder against the reviewed identities; returns its paths.

    Raises LayaUnavailable naming the first problem. Nothing is imported or loaded.
    """
    known = LAYA_ASSETS if known is None else known
    python = python or python_tag()
    root = Path(os.path.abspath(os.path.expanduser(str(folder))))
    if not root.is_dir():
        raise LayaUnavailable(f'Laya asset folder not found: {root}')
    pins = read_pins(root)
    if MANIFEST_NAME not in pins:
        raise LayaUnavailable(f'{MANIFEST_NAME} is not pinned.')
    try:
        manifest = json.loads((root / MANIFEST_NAME).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise LayaUnavailable(f'The Laya asset {MANIFEST_NAME} is missing or unreadable.') from None
    if not isinstance(manifest, dict) or manifest.get('schema') != ASSET_SCHEMA or not isinstance(manifest.get('id'), str):
        raise LayaUnavailable(f'The Laya asset {MANIFEST_NAME} is not a {ASSET_SCHEMA} manifest.')
    entry = known.get(manifest['id'])
    if not isinstance(entry, dict):
        raise LayaUnavailable(f'Laya asset {manifest["id"]!r} is not a reviewed asset.')
    if reviewed_entry(pins) != {'files': entry.get('files'), 'runtimeTree': entry.get('runtimeTree')}:
        raise LayaUnavailable(f'The pins of Laya asset {manifest["id"]!r} differ from its reviewed identity.')
    if manifest.get('python') != python:
        raise LayaUnavailable(f'The Laya runtime was built for Python {manifest.get("python")}; the host Python is {python}.')
    for key in ('model', 'runtime'):
        value = manifest.get(key)
        if not isinstance(value, str) or value.startswith('/') or '..' in value.split('/'):
            raise LayaUnavailable(f'The Laya asset {MANIFEST_NAME} names an invalid {key} folder.')
    for directory, subdirs, names in os.walk(root, followlinks=False):
        for name in subdirs + names:
            path = Path(directory) / name
            rel = path.relative_to(root).as_posix()
            if path.is_symlink():
                raise LayaUnavailable(f'The Laya asset contains a symlink: {rel}')
            if name in names and rel != PINS_NAME and rel not in pins:
                raise LayaUnavailable(f'The Laya asset file {rel} is not pinned.')
    for rel, expected in sorted(pins.items()):
        path = root / rel
        if not path.is_file():
            raise LayaUnavailable(f'Pinned Laya file is missing: {rel}')
        if _sha256(path) != expected:
            raise LayaUnavailable(f'Laya file {rel} does not match its pinned sha256.')
    return {'id': manifest['id'], 'root': str(root), 'model': str(root / manifest['model']), 'runtime': str(root / manifest['runtime']), 'manifest': manifest}


def read_asset_id(folder):
    """The asset id a folder claims (unverified; used only to pick a calibration)."""
    try:
        value = json.loads((Path(os.path.expanduser(str(folder))) / MANIFEST_NAME).read_text(encoding='utf-8'))
        return value.get('id') if isinstance(value, dict) and isinstance(value.get('id'), str) else None
    except (OSError, ValueError):
        return None


_EOF = object()


def _kill(proc):
    """Stop a sidecar process and close its pipes (its reader thread then ends)."""
    if proc.poll() is None:
        try:
            proc.kill()
            proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass
    for stream in (proc.stdin, proc.stdout):
        try:
            stream.close()
        except (OSError, ValueError, AttributeError):
            pass


class SidecarAgent:
    """The laya agent interface (predict(state, questions) -> {'answers': …}) over a sidecar process.

    start() verifies the asset and launches the sidecar in the background.
    predict() never waits for loading: a request that finds the sidecar not
    ready starts it and gets LayaWarmingUp (the caller stays deterministic);
    wait_ready() is the bounded wait for callers that want one.
    A ready sidecar has `timeout` seconds to answer; a late answer is
    discarded by id. A sidecar that leaves a request unanswered for
    `hang_after` seconds is killed and restarted on the next request; a
    late answer counts as an answer, so one slow call never costs a reload.
    close() also cancels a boot still in progress (it spawns nothing, or
    kills what it spawned); touch() restarts a ready sidecar's idle exit.
    """

    def __init__(self, asset, known=None, timeout=DEFAULT_TIMEOUT, load_timeout=DEFAULT_LOAD_TIMEOUT, idle_exit=DEFAULT_IDLE_EXIT,
                 threads=DEFAULT_THREADS, command=None, log_path=None, retry_after=RETRY_AFTER, python=None, executable=None,
                 hang_after=None):
        self.asset = Path(os.path.expanduser(str(asset)))
        self.known = known
        self.timeout = float(timeout)
        # A sidecar still busy with an unanswered request this long after it was sent is hung: kill and restart it.
        self.hang_after = float(hang_after) if hang_after is not None else max(5.0, 4 * self.timeout)
        self._sent = {}  # request id -> when it was sent, until its reply (or any later one) is read
        self._answered = 0  # the highest request id the sidecar has answered, noted by the reader thread
        self.load_timeout = float(load_timeout)
        self.idle_exit = int(idle_exit)
        self.threads = int(threads)
        self._command = list(command) if command else None
        self.log_path = Path(log_path) if log_path else None
        self.retry_after = float(retry_after)
        self.python = python
        self.executable = executable or sys.executable
        self.reason = None
        self.asset_id = None
        self.load_ms = None
        self._state = 'idle'
        self._failed_at = None
        self._proc = None
        self._lines = None
        self._settled = threading.Event()
        self._lock = threading.Lock()
        self._call = threading.Lock()
        self._next_id = 0
        self._boots = 0  # the current boot; close() or a newer start() supersedes one still in progress

    # -- state ------------------------------------------------------------------
    def command(self):
        # -I: no PYTHONPATH/user site; -S: not even the app's site-packages; -B: never write .pyc into the pinned runtime.
        return [self.executable, '-I', '-S', '-B', str(SIDECAR), '--asset', str(self.asset), '--threads', str(self.threads), '--idle-exit', str(self.idle_exit)]

    def ready(self):
        return self._state == 'ready' and self._proc is not None and self._proc.poll() is None

    def failed(self):
        return self._state == 'failed'

    def running(self):
        return self._proc is not None and self._proc.poll() is None

    def wait_ready(self, seconds):
        """Start the sidecar if needed and wait up to `seconds` for it to finish loading; True when ready."""
        if not self.ready():
            self.start()
            self._settled.wait(max(0.0, float(seconds)))
        return self.ready()

    def _unanswered_since(self):
        """When the oldest request the sidecar has not answered yet was sent (None when every reply arrived).

        The sidecar answers in order, so a reply to one id answers every earlier id too."""
        answered = self._answered
        return min((at for rid, at in list(self._sent.items()) if rid > answered), default=None)

    def start(self):
        with self._lock:
            if self._state == 'starting' or self.ready():
                return
            if self._state == 'failed' and time.monotonic() - (self._failed_at or 0) < self.retry_after:
                return
            self._stop_locked()
            self._state = 'starting'
            self.reason = None
            self._settled.clear()
            self._boots += 1
            threading.Thread(target=self._boot, args=(self._boots,), name='laya-sidecar-boot', daemon=True).start()

    def _fail(self, reason, boot):
        with self._lock:
            if boot != self._boots:
                return  # superseded (closed or restarted): not this boot's failure to report
            self._stop_locked()
            self._state = 'failed'
            self._failed_at = time.monotonic()
            self.reason = reason
            self._settled.set()

    def _boot(self, boot):
        try:
            info = verify_asset(self.asset, known=self.known, python=self.python)
        except LayaUnavailable as error:
            return self._fail(str(error), boot)
        except Exception as error:  # unreadable folder, permissions
            return self._fail(f'Laya asset check failed: {error}', boot)
        if boot != self._boots:
            return  # closed while the asset was checked: spawn nothing
        self.asset_id = info['id']
        lines = queue.Queue()
        try:
            log = open(self.log_path, 'ab') if self.log_path else subprocess.DEVNULL
        except OSError:
            log = subprocess.DEVNULL
        try:
            proc = subprocess.Popen(self._command or self.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                                    text=True, encoding='utf-8', bufsize=1, close_fds=True)
        except OSError as error:
            return self._fail(f'Could not start the Laya sidecar: {error}', boot)
        finally:
            if log is not subprocess.DEVNULL:
                log.close()
        threading.Thread(target=self._read, args=(proc, lines), name='laya-sidecar-reader', daemon=True).start()
        with self._lock:
            current = boot == self._boots
            if current:
                self._proc, self._lines = proc, lines
        if not current:  # closed or restarted while it spawned: never leave an untracked sidecar behind
            return _kill(proc)
        try:
            first = lines.get(timeout=self.load_timeout)
        except queue.Empty:
            return self._fail('The Laya sidecar did not finish loading in time.', boot)
        if first is _EOF:
            return self._fail('The Laya sidecar stopped while loading.', boot)
        try:
            hello = json.loads(first)
        except ValueError:
            return self._fail('The Laya sidecar sent an invalid greeting.', boot)
        if not isinstance(hello, dict) or hello.get('ready') is not True:
            return self._fail('The Laya sidecar could not load the model: ' + str((hello or {}).get('error') if isinstance(hello, dict) else hello), boot)
        with self._lock:
            if self._proc is proc and boot == self._boots:
                self._state = 'ready'
                self.load_ms = hello.get('loadMs')
                self._settled.set()

    def _read(self, proc, lines):
        try:
            for line in proc.stdout:
                self._note_reply(proc, line)
                lines.put(line)
        except (OSError, ValueError):
            pass
        lines.put(_EOF)

    def _note_reply(self, proc, line):
        """Record that the sidecar answered (even after its call gave up), so it is never taken for hung."""
        try:
            rid = json.loads(line).get('id')
        except (ValueError, AttributeError):
            return
        if type(rid) is int:
            with self._lock:
                if self._proc is proc and rid > self._answered:
                    self._answered = rid

    def _stop_locked(self):
        proc, self._proc, self._lines = self._proc, None, None
        self._sent = {}
        if proc is not None:
            _kill(proc)
        if self._state in ('ready', 'starting'):
            self._state = 'idle'
            self._boots += 1  # a boot still in progress is superseded

    def close(self):
        with self._lock:
            self._stop_locked()
            self._state = 'idle'
            self._boots += 1
            self._settled.set()  # nothing to wait for

    def touch(self):
        """Keep a ready, idle sidecar alive: a blank line restarts its idle-exit timer and is never answered."""
        if not self.ready() or not self._call.acquire(blocking=False):
            return  # not running, or a request in flight restarts the timer anyway
        try:
            proc = self._proc
            if proc is not None:
                proc.stdin.write('\n')
                proc.stdin.flush()
        except (OSError, ValueError, AttributeError):
            pass
        finally:
            self._call.release()

    def _stopped(self, reason):
        with self._lock:
            self._stop_locked()
            self._state = 'idle'
        raise LayaUnavailable(reason)

    # -- calls ------------------------------------------------------------------
    def predict(self, state, questions, head_max_len=None):
        started = time.monotonic()
        pending = self._unanswered_since()
        if self.ready() and pending is not None and started - pending > self.hang_after:
            with self._lock:
                pending = self._unanswered_since()  # again under the lock: a concurrent call may have restarted it already
                if self.ready() and pending is not None and started - pending > self.hang_after:
                    self._stop_locked()
                    self._state = 'idle'
        if not self.ready():
            with self._lock:
                if self._state == 'ready':  # it exited (idle exit or crash)
                    self._state = 'idle'
            self.start()
            if self._state == 'failed':
                raise LayaUnavailable(self.reason or 'Laya is unavailable.')
            raise LayaWarmingUp('Laya is loading; this request uses the deterministic parser.')
        if not self._call.acquire(timeout=self.timeout):
            raise LayaTimeout('Laya is busy with another request.')
        try:
            proc, lines = self._proc, self._lines
            if proc is None or lines is None or proc.poll() is not None:
                self._stopped('The Laya sidecar stopped.')
            self._next_id += 1
            request_id = self._next_id
            message = {'id': request_id, 'state': state, 'questions': questions}
            if head_max_len:
                message['headMaxLen'] = int(head_max_len)
            try:
                proc.stdin.write(json.dumps(message, ensure_ascii=False) + '\n')
                proc.stdin.flush()
            except (OSError, ValueError):
                self._stopped('The Laya sidecar stopped.')
            answered = self._answered
            self._sent = {**{rid: at for rid, at in self._sent.items() if rid > answered}, request_id: time.monotonic()}
            deadline = started + self.timeout
            while True:
                left = deadline - time.monotonic()
                if left <= 0:
                    raise LayaTimeout(f'Laya did not answer within {self.timeout:.1f} s.')
                try:
                    line = lines.get(timeout=left)
                except queue.Empty:
                    continue
                if line is _EOF:
                    self._stopped('The Laya sidecar stopped.')
                try:
                    reply = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(reply, dict) or reply.get('id') != request_id:
                    continue  # a late answer to a call that already timed out
                self._sent = {rid: at for rid, at in self._sent.items() if rid > request_id}
                if 'error' in reply:
                    raise LayaUnavailable(f'Laya could not answer: {reply["error"]}')
                return {'answers': reply.get('answers') or {}}
        finally:
            self._call.release()
