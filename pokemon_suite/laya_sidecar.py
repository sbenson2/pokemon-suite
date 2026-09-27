"""Laya sidecar for the request interpreter (G4).

Started by the host (laya_runtime.SidecarAgent) as
``<host python> -I -S -B laya_sidecar.py --asset <folder>`` after the host has
verified every pinned file of the asset. Standalone on purpose: it imports
only the standard library until it adds the asset's pinned runtime folder
(numpy, onnxruntime, tokenizers) to sys.path. No torch.

Protocol (JSON lines): first a greeting {"ready": true, "asset", "loadMs"} or
{"ready": false, "error"}; then one reply {"id", "answers"} or {"id", "error"}
per request {"id", "state", "questions", "headMaxLen"?}. It exits on end of
input (the host went away) or after --idle-exit seconds without a request.

Sequence building and answer decoding mirror laya 0.3.11
(laya/common.py build_sequence, render_options; laya/agent.py
_decode_answers); the ONNX graph is the model's forward pass
(receptron/laya export: logits [B,K], act_probs [B,2]).
"""
import argparse
import io
import json
import math
import os
import select
import sys
import time
from pathlib import Path

QTYPES = {'choice': 0, 'score': 1, 'noul': 2}
QTYPE_NAMES = {v: k for k, v in QTYPES.items()}
TEMP_MIN, TEMP_MAX = 0.5, 5.0


def clamp_temperature(t):
    try:
        t = float(t)
    except (TypeError, ValueError):
        return 1.0
    if t != t or t in (float('inf'), float('-inf')):
        return 1.0
    return min(TEMP_MAX, max(TEMP_MIN, t))


def temp_bucket(qtype, k):
    size = '2' if k <= 2 else '3-5' if k <= 5 else '6-10' if k <= 10 else '11+'
    return '%s:%s' % (QTYPE_NAMES[int(qtype)], size)


def render_criterion(value):
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(', ', ': '), default=str)


def render_options(q):
    t, crit = q['t'], q.get('crit')
    if t == 'choice':
        return [k if v is None or v == '' else '%s: %s' % (k, render_criterion(v)) for k, v in crit.items()]
    if t == 'score':
        return ['level %d: %s' % (i, render_criterion(c)) for i, c in enumerate(crit)]
    crit = crit or {}
    false, true = crit.get('false'), crit.get('true')
    return ['false: ' + (render_criterion(false) if false not in (None, '') else 'no, the statement does not hold'),
            'true: ' + (render_criterion(true) if true not in (None, '') else 'yes, the statement holds')]


def internal(qdef):
    """A validated question in laya's internal form {t, ins, crit}."""
    if not isinstance(qdef, dict) or qdef.get('type') not in QTYPES or 'instructions' not in qdef:
        raise ValueError('a question needs a type (choice, score, noul) and instructions')
    t = qdef['type']
    crit = qdef.get('criteria')
    if t == 'choice':
        if isinstance(crit, list):
            crit = {str(c): None for c in crit}
        if not isinstance(crit, dict) or not crit:
            raise ValueError('a choice question needs criteria')
        crit = {str(k): v for k, v in crit.items()}
    elif t == 'score':
        if not isinstance(crit, list) or not crit:
            raise ValueError('a score question needs a list of levels')
    elif crit is not None:
        if not isinstance(crit, dict) or not {str(k).lower() for k in crit} <= {'true', 'false'}:
            raise ValueError('a noul question takes criteria keyed true/false')
        crit = {str(k).lower(): v for k, v in crit.items()}
    ins = qdef['instructions']
    if not isinstance(ins, str):
        ins = json.dumps(ins, ensure_ascii=False)
    return {'t': t, 'ins': ins, 'crit': crit}


def serialize_state(state):
    return state if isinstance(state, str) else json.dumps(state, ensure_ascii=False)


def build_sequence(encode, ids, mask_token, state, q, max_len=512, head_max_len=192):
    """[CLS] <type> instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP] (laya's layout)."""
    opts = render_options(q)
    ins = str(q['ins']).replace(mask_token, ' ')
    head_ids = encode('%s question: %s' % (q['t'], ins))
    opt_ids = [[ids['mask']] + encode(' ' + o.replace(mask_token, ' '))[:48] for o in opts]
    budget = head_max_len - sum(len(o) for o in opt_ids)
    if budget < 16:
        per = max(4, (head_max_len - 16) // max(1, len(opt_ids)))
        opt_ids = [o[:per] for o in opt_ids]
        budget = head_max_len - sum(len(o) for o in opt_ids)
    head_ids = head_ids[:max(8, budget)]
    seq = [ids['cls']] + head_ids + [ids['sep']]
    markers = []
    for o in opt_ids:
        markers.append(len(seq))
        seq.extend(o)
    seq.append(ids['sep'])
    room = max(0, max_len - len(seq) - 1)
    st = encode(serialize_state(state).replace(mask_token, ' '))[:room]
    seq = seq + st + [ids['sep']]
    return seq[:max_len], [m for m in markers if m < max_len]


def decode_answer(q, logits, qtype, cfg):
    """Typed answer from one row of option logits (laya's temperatures, clamped as laya does)."""
    k = len(logits)
    by_options = {key: clamp_temperature(v) for key, v in (cfg.get('temperature_by_options') or {}).items()}
    temperature = [clamp_temperature(t) for t in (cfg.get('temperature') or [1.0, 1.0, 1.0])]
    scale = by_options.get(temp_bucket(qtype, k), temperature[qtype])
    z = [float(x) / scale for x in logits]
    top = max(z)
    e = [math.exp(x - top) for x in z]
    total = sum(e)
    p = [x / total for x in e]
    if k >= 2:
        entropy = -sum(x * math.log(min(1.0, max(x, 1e-12))) for x in p)
        confidence = min(1.0, max(0.0, 1.0 - entropy / math.log(k)))
    else:
        confidence = 1.0
    if q['t'] == 'choice':
        keys = list(q['crit'])
        best = max(range(k), key=lambda i: p[i])
        return {'type': 'choice', 'choice': keys[best], 'probabilities': {key: round(v, 4) for key, v in zip(keys, p)}, 'confidence': round(confidence, 4)}
    if q['t'] == 'score':
        return {'type': 'score', 'score': round(sum(i * v for i, v in enumerate(p)), 4), 'probabilities': {str(i): round(v, 4) for i, v in enumerate(p)},
                'confidence': round(confidence, 4)}
    return {'type': 'noul', 'noul': round(p[1], 4), 'confidence': round(max(p[1], 1.0 - p[1]), 4)}


class OnnxBackend:
    """The pinned ONNX export on onnxruntime's CPU provider (fixed threads: deterministic)."""

    def __init__(self, model_dir, threads=4):
        import numpy
        import onnxruntime
        from tokenizers import Tokenizer
        model_dir = Path(model_dir)
        self.np = numpy
        self.cfg = json.loads((model_dir / 'laya_config.json').read_text(encoding='utf-8'))
        tcfg = json.loads((model_dir / 'tokenizer' / 'tokenizer_config.json').read_text(encoding='utf-8'))
        self.tok = Tokenizer.from_file(str(model_dir / 'tokenizer' / 'tokenizer.json'))
        self.mask_token = tcfg['mask_token']
        self.ids = {name: self.tok.token_to_id(tcfg[name + '_token']) for name in ('cls', 'sep', 'mask', 'pad')}
        if any(v is None for v in self.ids.values()):
            raise ValueError('the tokenizer lacks a special token')
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = max(1, int(threads))
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = onnxruntime.InferenceSession(str(model_dir / 'laya.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
        self.output = self.session.get_outputs()[0].name

    def encode(self, text):
        return self.tok.encode(text, add_special_tokens=False).ids

    def predict(self, state, questions, head_max_len=None):
        np = self.np
        if not isinstance(questions, dict) or not questions:
            raise ValueError('send at least one question')
        max_len = int(self.cfg.get('max_len', 512))
        head = int(head_max_len or self.cfg.get('head_max_len', 192))
        qids = list(questions)
        items = []
        for qid in qids:
            q = internal(questions[qid])
            seq, markers = build_sequence(self.encode, self.ids, self.mask_token, state, q, max_len, head)
            if len(markers) != len(render_options(q)):
                raise ValueError('question %r options exceed head_max_len=%d' % (qid, head))
            items.append((q, seq, markers))
        n, width = len(items), max(len(s) for _, s, _ in items)
        kmax = max(len(m) for _, _, m in items)
        input_ids = np.full((n, width), self.ids['pad'], dtype=np.int64)
        attention = np.zeros((n, width), dtype=np.int64)
        marker_pos = np.zeros((n, kmax), dtype=np.int64)
        marker_mask = np.zeros((n, kmax), dtype=bool)
        qtype = np.zeros((n,), dtype=np.int64)
        for i, (q, seq, markers) in enumerate(items):
            input_ids[i, :len(seq)] = seq
            attention[i, :len(seq)] = 1
            marker_pos[i, :len(markers)] = markers
            marker_mask[i, :len(markers)] = True
            qtype[i] = QTYPES[q['t']]
        logits = self.session.run([self.output], {'input_ids': input_ids, 'attention_mask': attention, 'marker_pos': marker_pos,
                                                  'marker_mask': marker_mask, 'qtype': qtype})[0]
        return {qid: decode_answer(q, logits[i, :len(markers)].tolist(), QTYPES[q['t']], self.cfg) for i, (qid, (q, _, markers)) in enumerate(zip(qids, items))}


def _handle(backend, line):
    try:
        request = json.loads(line)
    except ValueError:
        return {'id': None, 'error': 'invalid JSON'}
    if not isinstance(request, dict):
        return {'id': None, 'error': 'invalid request'}
    try:
        answers = backend.predict(request.get('state'), request.get('questions'), head_max_len=request.get('headMaxLen'))
        return {'id': request.get('id'), 'answers': answers}
    except Exception as error:  # a bad question never stops the sidecar
        return {'id': request.get('id'), 'error': f'{type(error).__name__}: {error}'[:500]}


def _lines(stdin, idle_exit):
    """Request lines; stops at end of input or after idle_exit seconds without one."""
    try:
        fd = stdin.fileno()
    except (AttributeError, OSError, io.UnsupportedOperation):
        fd = None
    if fd is None or not idle_exit:
        while True:
            line = stdin.readline()
            if not line:
                return
            yield line
    buffer = b''
    while True:
        while b'\n' not in buffer:
            ready, _, _ = select.select([fd], [], [], idle_exit)
            if not ready:
                return
            chunk = os.read(fd, 1 << 16)
            if not chunk:
                return
            buffer += chunk
        line, buffer = buffer.split(b'\n', 1)
        yield line.decode('utf-8', 'replace')


def serve(backend, stdin, stdout, idle_exit=600):
    for line in _lines(stdin, idle_exit):
        if not line.strip():
            continue
        stdout.write(json.dumps(_handle(backend, line), ensure_ascii=False) + '\n')
        stdout.flush()


def main(argv=None):
    parser = argparse.ArgumentParser(description='Laya sidecar (Pokémon Suite request interpreter)')
    parser.add_argument('--asset', required=True)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--idle-exit', type=int, default=600)
    args = parser.parse_args(argv)
    sys.dont_write_bytecode = True  # the pinned runtime folder must stay byte-identical
    # The protocol owns the original stdout; anything else that writes to fd 1 goes to stderr.
    out = os.fdopen(os.dup(1), 'w', encoding='utf-8', buffering=1)
    os.dup2(2, 1)
    started = time.monotonic()
    try:
        root = Path(args.asset)
        manifest = json.loads((root / 'asset.json').read_text(encoding='utf-8'))
        sys.path.insert(0, str(root / manifest['runtime']))
        backend = OnnxBackend(root / manifest['model'], threads=args.threads)
        backend.predict('warm up', {'q': {'type': 'noul', 'instructions': 'warm up'}})
    except Exception as error:
        out.write(json.dumps({'ready': False, 'error': f'{type(error).__name__}: {error}'[:500]}) + '\n')
        out.flush()
        return 1
    out.write(json.dumps({'ready': True, 'asset': manifest.get('id'), 'loadMs': round((time.monotonic() - started) * 1000)}) + '\n')
    out.flush()
    serve(backend, sys.stdin, out, idle_exit=args.idle_exit)
    return 0


if __name__ == '__main__':
    sys.exit(main())
