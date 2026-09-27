"""Extract which pokefirered event scripts award which Fame Checker facts.

Writes engine/firered/test-support/fame-script-awards.json, the fixture the
Fame source table test checks postgame-fame-facts.json against. Run it on the
pinned pokefirered source:

    python3 scripts/extract-fame-script-awards.py <pokefirered-source-root>

Flow analysis (read-only on the source). For an entry label it returns, per
(person, index) awarded by `famechecker <PERSON>, <n>` (default function only), the
disjunction of branch-condition sets under which the award executes.

Flow model:
  - labels `X::`/`X:`; `.macro ... .endm` blocks are not code; `.byte/.2byte/.4byte/.string`
    are data (flow stops); comments start at '@'.
  - terminal: end, return, goto, gotostd, step_end, endram/returnram, data.
  - a label block whose last instruction is not terminal falls through into the next label
    of the same file (the ROM layout).
  - call/call_if_*: subroutine with return. callstd: no flow effect.
  - goto_if_*/call_if_*/switch+case: two-way branches with a recorded condition.
  - trainerbattle*: not-yet-defeated -> battle -> continuation script (CONTINUE_SCRIPT forms)
    or back to the field; already defeated -> next instruction.
  - VAR_RESULT conditions record the instruction that last set VAR_RESULT (e.g. a YES/NO box).
"""
import re, pathlib, json, sys
from functools import lru_cache

TERMINAL = re.compile(r'^(end|return|goto|gotostd|goto_std|step_end|endram|returnram|releaseall_end)\b')
DATA = re.compile(r'^\.(byte|2byte|4byte|string|align)\b')

def parse_source(root):
    """Return (labels, order): labels[name] = list of (file, lineno, text); order[name] = next label in file."""
    files = sorted((root / 'data').rglob('*.inc')) + [root / 'data/event_scripts.s']
    labels, nxt, where = {}, {}, {}
    for p in files:
        if 'text' in p.parts or p.name.startswith('text'):
            continue
        rel = str(p.relative_to(root))
        name, in_macro, prev = None, False, None
        for n, raw in enumerate(p.read_text().splitlines(), 1):
            line = raw.split('@')[0].strip()
            if not line:
                continue
            if line.startswith('.macro'):
                in_macro = True; continue
            if line.startswith('.endm'):
                in_macro = False; continue
            if in_macro:
                continue
            m = re.match(r'^(\w+)::?$', line)
            if m:
                label = m[1]
                if prev is not None:
                    nxt[prev] = label
                labels.setdefault(label, []); where[label] = rel
                name = prev = label
                continue
            if line.startswith(('.set', '.equ', '.include', '.section', '.global', '.if', '.endif', '.else')):
                continue
            if name is not None:
                labels[name].append((rel, n, line))
    return labels, nxt, where

def args_of(line):
    parts = line.split(None, 1)
    # GNU as macro arguments may be separated by commas or blanks (pkmn_center_nurse.inc: `case 1 X`)
    return [a for a in re.split(r'[\s,]+', parts[1].strip()) if a] if len(parts) > 1 else []

class Flow:
    def __init__(self, labels, nxt, people):
        self.labels, self.nxt, self.people = labels, nxt, people
        self.missing = set()
        self.visited = set()
        self.memo = {}
        self.active = set()

    def block(self, label):
        if label not in self.labels:
            self.missing.add(label)
            return None
        self.visited.add(label)
        return self.labels[label]

    def results(self, label, pc=0, stack=(), vr=None, seen=frozenset()):
        """dict award -> set(frozenset(conditions)); memoized, a cycle back-edge contributes nothing."""
        key = (label, pc, stack, vr)
        if key in self.memo:
            return self.memo[key]
        if key in self.active:
            return {}
        self.active.add(key)
        try:
            res = self._results(label, pc, stack, vr, seen | {key})
        finally:
            self.active.discard(key)
        self.memo[key] = res
        return res

    def _results(self, label, pc, stack, vr, seen):
        code = self.block(label)
        if code is None:
            return {}
        out = {}
        def merge(res, cond=None):
            for award, clauses in res.items():
                tgt = out.setdefault(award, set())
                for c in clauses:
                    tgt.add(frozenset(c | ({cond} if cond else set())))
        i = pc
        while True:
            if i >= len(code):
                # fall through into the next label of the file
                follow = self.nxt.get(label)
                if follow is None:
                    return simplify(out)
                label, i, code = follow, 0, self.block(follow)
                if code is None:
                    return simplify(out)
                k2 = (label, 0, stack, vr)
                if k2 in seen:
                    return simplify(out)
                seen = seen | {k2}
                continue
            _, _, line = code[i]
            op = line.split(None, 1)[0]
            a = args_of(line)
            if DATA.match(line):
                return simplify(out)
            if op == 'famechecker':
                if len(a) == 2 and a[0] in self.people and a[1].isdigit():
                    merge({(self.people[a[0]], int(a[1])): {frozenset()}})
                i += 1; continue
            if op in ('end', 'releaseall_end', 'endram'):
                return simplify(out)
            if op in ('return', 'returnram'):
                if not stack:
                    return simplify(out)
                (rl, rpc), rest = stack[-1], stack[:-1]
                merge(self.results(rl, rpc, rest, vr, seen)); return simplify(out)
            if op in ('goto', 'goto_std', 'gotostd'):
                if op == 'goto' and a:
                    merge(self.results(a[0], 0, stack, vr, seen))
                return simplify(out)
            if op == 'step_end':
                return simplify(out)
            if op == 'call' and a:
                merge(self.results(a[0], 0, stack + ((label, i + 1),), vr, seen)); return simplify(out)
            m = re.match(r'^(goto|call)_if_(\w+)$', op)
            if m:
                kind, rel = m[1], m[2]
                if rel in ('set', 'unset'):
                    cond = f'{a[0]} {rel}'; target = a[1]
                elif rel in ('defeated', 'not_defeated'):
                    cond = f'{a[0]} {rel}'; target = a[1]
                elif rel == 'questlog':
                    cond = 'questlog-playback'; target = a[0]
                else:
                    src = f'[{vr}]' if a[0] == 'VAR_RESULT' and vr else ''
                    cond = f'{a[0]}{src} {rel} {a[1]}'; target = a[2]
                if kind == 'goto':
                    merge(self.results(target, 0, stack, vr, seen), cond)
                else:
                    merge(self.results(target, 0, stack + ((label, i + 1),), vr, seen), cond)
                merge(self.results(label, i + 1, stack, vr, seen), '!' + cond)
                return simplify(out)
            if op == 'switch':
                sw = a[0]; j = i + 1; cases = []
                while j < len(code) and code[j][2].startswith('case '):
                    ca = args_of(code[j][2]); cases.append((ca[0], ca[1])); j += 1
                src = f'[{vr}]' if sw == 'VAR_RESULT' and vr else ''
                for val, target in cases:
                    merge(self.results(target, 0, stack, vr, seen), f'{sw}{src} eq {val}')
                merge(self.results(label, j, stack, vr, seen), f'{sw}{src} not-in-cases')
                return simplify(out)
            if op == 'map_script' and len(a) >= 2:
                merge(self.results(a[1], 0, (), None, seen), f'map_script {a[0]}')
                i += 1; continue
            if op == 'map_script_2' and len(a) >= 3:
                merge(self.results(a[2], 0, (), None, seen), f'{a[0]} eq {a[1]}')
                i += 1; continue
            if op.startswith('trainerbattle'):
                trainer = a[0] if op != 'trainerbattle' else a[1]
                cont = None
                if op in ('trainerbattle_single',) and len(a) >= 4 and a[3] not in ('FALSE', 'NO_MUSIC'):
                    cont = a[3]
                elif op in ('trainerbattle_double',) and len(a) >= 5 and a[4] not in ('FALSE', 'NO_MUSIC'):
                    cont = a[4]
                if cont:
                    merge(self.results(cont, 0, stack, vr, seen), f'{trainer} first-defeat')
                merge(self.results(label, i + 1, stack, vr, seen), f'{trainer} defeated')
                return simplify(out)
            # VAR_RESULT setters
            if op == 'msgbox' and len(a) >= 2 and a[1] == 'MSGBOX_YESNO' or op == 'yesnobox':
                vr = 'yesno@%s' % label
            elif op in ('multichoice', 'multichoicedefault', 'multichoicegrid'):
                vr = 'multichoice@%s' % label
            elif op == 'specialvar' and a and a[0] == 'VAR_RESULT':
                vr = 'special:%s' % a[1]
            elif op in ('checkitem', 'checkitemspace', 'checkpcitem', 'checkpartymove', 'getpartysize', 'checkmoney',
                        'checkitemtype', 'checkplayergender', 'checkcoins', 'checkdecor', 'checkdecorspace'):
                vr = op
            i += 1

def simplify(out):
    res = {}
    for award, clauses in out.items():
        cl = set(clauses)
        changed = True
        while changed:
            changed = False
            # absorption: a clause subsumed by a smaller clause is dropped
            for c in list(cl):
                if any(d < c for d in cl):
                    cl.discard(c); changed = True
            # resolution on complementary literals with identical rest
            for c in list(cl):
                for lit in c:
                    neg = lit[1:] if lit.startswith('!') else '!' + lit
                    other = (c - {lit}) | {neg}
                    if other in cl:
                        cl.discard(c); cl.discard(other); cl.add(c - {lit}); changed = True; break
                if changed:
                    break
        res[award] = cl
    return res

def load(root):
    root = pathlib.Path(root)
    people = {k: int(v) for k, v in re.findall(r'#define\s+(FAMECHECKER_\w+)\s+(\d+)', (root / 'include/constants/fame_checker.h').read_text())}
    labels, nxt, where = parse_source(root)
    return people, labels, nxt, where

def main(argv):
    root = pathlib.Path(argv[1])
    repo = pathlib.Path(__file__).resolve().parents[1]
    table = json.loads((repo / 'engine/firered/src/suite/postgame-fame-facts.json').read_text())
    people, labels, nxt, where = load(root)
    names = {v: k[len('FAMECHECKER_'):] for k, v in people.items()}
    flow = Flow(labels, nxt, people)
    scripts = {}
    for label in sorted({t['script'] for t in table['targets']}):
        awards = flow.results(label)
        scripts[label] = sorted([p, i, 'unconditional' if frozenset() in cl else 'conditional']
                                for (p, i), cl in awards.items())
    head = (root / '.git/HEAD')
    commit = None
    if head.exists():
        ref = head.read_text().strip()
        commit = (root / '.git' / ref[5:]).read_text().strip() if ref.startswith('ref: ') and (root / '.git' / ref[5:]).exists() else ref
    out = {'schema': 'pokemon-suite/fame-script-awards/v1',
           'source': {'project': 'pokefirered', 'commit': commit, 'generator': 'scripts/extract-fame-script-awards.py'},
           'people': [names[i] for i in sorted(names)],
           'scripts': scripts,
           'missingLabels': sorted(flow.missing)}
    target = repo / 'engine/firered/test-support/fame-script-awards.json'
    target.write_text(json.dumps(out, indent=1) + '\n')
    print(target, len(scripts), 'scripts', 'missing', out['missingLabels'])

if __name__ == '__main__':
    main(sys.argv)
