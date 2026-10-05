"""Goal supervisor: a request becomes a goal the bot pursues end to end.

A goal (schema pokemon-suite/goal/v1, produced by the interpreter or a UI) is an
ordered list of steps. The supervisor decides which save can reach it (the
current save when it can; a new save from New Game only when asked or when no
save exists), executes each step through the Suite's existing controls and then
resumes the owner's standing goals. It never sends inputs, never writes game
memory, never restarts a bot the user stopped and never bypasses an engine
refusal: a refused command is retried later, never forced.
"""
from __future__ import annotations

import copy
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import threading
import time
import uuid

from . import file_lock
from .suite_save_store import atomic_file

SCHEMA = 'pokemon-suite/goal/v1'
STORE_SCHEMA = 'pokemon-suite/goals/v1'
TERMINAL = {'done', 'failed', 'cancelled'}
OPEN = {'queued', 'running', 'waiting'}
KEY = re.compile(r'[A-Za-z0-9_-]{8,100}\Z')
HEX64 = re.compile(r'[a-f0-9]{64}\Z')
DRAFT_ID = re.compile(r'[a-f0-9]{32}\Z')  # the request interpreter's draft (joins a goal's final status to its request-log row)
TASK_ID = re.compile(r'[A-Za-z0-9_-]{1,100}\Z')
SAVE_MODES = ('current-if-able', 'current', 'new')
THEN = ('standing-goals', 'await-command')
STEP_KINDS = ('farming', 'postgame', 'player-task', 'collection', 'trade', 'campaign', 'status')
PLAYER_ACTIONS = ('start', 'ready', 'resume', 'stop', 'stop-game', 'new-save', 'restore-save')
STATUS_QUESTIONS = ('team', 'hunt', 'location', 'progress', 'shinies', 'goals')
NEEDS_SAVE = {'farming', 'postgame', 'collection', 'trade'}
HOLD_DURING_CAMPAIGN = {'postgame', 'collection', 'trade'}  # hunts hold in _hunt (after saving the request)
SNORLAX = 143
KEEP_FINISHED = 50
USED_GRACE_SECONDS = 60


# Step results a later step can reference: {"$ref": "steps[N].result.<path>"}.
# Hunt results come from the capture/acquisition receipts (never guessed).
HUNT_RESULT = ('requestId', 'speciesId', 'name', 'caught', 'fingerprint', 'identity', 'species', 'personality', 'otId',
               'shiny', 'nature', 'ivs', 'location', 'shinyId', 'pokemonId', 'savedSramSha256', 'source', 'captures')
RESULT_FIELDS = {'farming': HUNT_RESULT, 'postgame': HUNT_RESULT, 'player-task': ('taskId', 'kind'),
                 'campaign': ('campaignId', 'trainerId'), 'status': ('answer',), 'trade': ('fingerprint',), 'collection': ()}
CONTAINERS = {'identity', 'ivs', 'captures'}  # result fields a path may descend into
REF = re.compile(r'steps\[(\d{1,2})\]\.result\.([A-Za-z][A-Za-z0-9]*(?:\.(?:[A-Za-z][A-Za-z0-9]*|\d{1,3}))*)\Z')
IV_STATS = ('hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense')


def references(value, path=()):
    """Every {"$ref": ...} inside a step, with its location."""
    if isinstance(value, dict):
        if '$ref' in value:
            yield path, value
            return
        for key, item in value.items():
            yield from references(item, path + (key,))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from references(item, path + (index,))


def replace_at(value, path, replacement):
    if not path:
        return replacement
    copy_ = copy.copy(value)
    copy_[path[0]] = replace_at(value[path[0]], path[1:], replacement)
    return copy_


def lookup(value, path):
    for part in path.split('.'):
        if isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        elif isinstance(value, dict) and part in value:
            value = value[part]
        else:
            raise KeyError(part)
    return value


def inventory_id(game, fingerprint):
    """The PC inventory's id for an individual (engine pokemon-inventory.js: sha256 of "<game>:<fingerprint>")."""
    return hashlib.sha256(f'{game}:{fingerprint}'.encode()).hexdigest()


def sample_result(step):
    """A well-typed stand-in used only to validate a step that references this one."""
    if step['kind'] in ('farming', 'postgame'):
        target = step.get('request') or (step.get('priorityTarget') or {}).get('request') or step.get('priorityTarget') or {}
        species = target.get('speciesId') if type(target.get('speciesId')) is int else 1
        native = species if 1 <= species <= 411 else 1
        quantity = target.get('quantity') if type(target.get('quantity')) is int and 1 <= target.get('quantity') <= 99 else 1

        def capture(k):
            fingerprint = json.dumps([native, k, 0, 0, 0, 0, 0, 0, 0], separators=(',', ':'))
            return {'fingerprint': fingerprint, 'identity': [native, k, 0, 0, 0, 0, 0, 0, 0],
                    'species': native, 'personality': k, 'otId': 0, 'shiny': False, 'nature': 'Hardy',
                    'ivs': {stat: 0 for stat in IV_STATS}, 'location': 'Party slot 1', 'shinyId': 'a' * 64,
                    'pokemonId': inventory_id('firered', fingerprint), 'savedSramSha256': '0' * 64, 'source': 'hunt-save'}
        captures = [capture(k) for k in range(quantity)]  # one per requested Pokémon, so "captures.N" can be referenced
        return {'requestId': 'goal-reference', 'speciesId': species, 'name': 'Pokémon', 'caught': quantity, **captures[0], 'captures': captures}
    return {'player-task': {'taskId': 'reference', 'kind': (step.get('task') or {}).get('kind', 'task')},
            'campaign': {'campaignId': 'run-00000000-0000-0000-0000-000000000000', 'trainerId': 0},
            'status': {'answer': ''}, 'trade': {'fingerprint': json.dumps([1, 0, 0, 0, 0, 0, 0, 0, 0], separators=(',', ':'))}}.get(step['kind'], {})


def hunt_request(step):
    target = step.get('priorityTarget') or {}
    return step.get('request') or target.get('request') or static_request(target['speciesId'], target.get('shiny', 'required'))


def read_json(path):
    try:
        value = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def identity_of(pokemon):
    """The engine's encounterFingerprint: [species, personality, otId, six IVs], compact JSON."""
    try:
        values = [pokemon['species'], pokemon['personality'], pokemon['otId'], *(pokemon['ivs'][stat] for stat in IV_STATS)]
    except (KeyError, TypeError):
        return None
    return json.dumps(values, separators=(',', ':')) if all(type(n) is int for n in values) else None


class Cancelled(Exception):
    """The goal was cancelled while the supervisor worked on it."""


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def fields(value, allowed, required, label):
    if not isinstance(value, dict):
        raise ValueError(f'{label} must be an object.')
    unknown = set(value) - set(allowed)
    if unknown:
        raise ValueError(f"{label} has unsupported settings: {', '.join(sorted(unknown))}.")
    missing = set(required) - set(value)
    if missing:
        raise ValueError(f"{label} is missing: {', '.join(sorted(missing))}.")


def static_target(species):
    """The engine's one-time static encounters a goal can hunt (G1 projection)."""
    from .pokemon_hunt_routes import static_encounter
    encounter = static_encounter(species) if type(species) is int else None
    if encounter:
        return {'speciesId': species, 'name': encounter['name'], 'level': encounter['level'], 'method': 'static'}
    if species == SNORLAX:
        return {'speciesId': SNORLAX, 'name': 'Snorlax', 'level': 30, 'method': 'snorlax'}
    return None


def static_request(species, shiny):
    """The farming request for a static target named without its own request."""
    return {'schema': 'pokemon-suite/farming-request/v1', 'game': 'firered', 'speciesId': species, 'quantity': 1, 'locationId': 'any',
            'shiny': shiny, 'natures': [], 'gender': 'any', 'abilityId': None, 'ball': {'id': 'any', 'requirement': 'preferred'},
            'minIvs': {}, 'minDvs': {}, 'encounterLevel': {'min': 1, 'max': 100}, 'finalLevel': None, 'moves': [], 'heldItemId': None,
            'limits': {'maxEncounters': 1000, 'maxMinutes': 240, 'minBalls': 10, 'maxSpend': 999999}, 'afterCompletion': 'stop-save'}


def species_name(species):
    target = static_target(species)
    if target:
        return target['name']
    try:
        from .pokemon_farming import catalog
        return next((p['name'] for p in catalog('firered')['species'] if p['id'] == species), f'Pokémon #{species}')
    except (OSError, ValueError, KeyError):
        return f'Pokémon #{species}'


def captured_species(record):
    national = record.get('nationalSpeciesId')
    return national if isinstance(national, int) else (record.get('pokemon') or {}).get('species')


def league_requirement(availability):
    return next((r.get('met') for r in (availability or {}).get('requirements') or [] if r.get('key') == 'leagueComplete'), None)


def objective_label(campaign):
    """The current story objective's label, or None. Objective ids are internal and never shown."""
    objective = campaign.get('objective')
    if not isinstance(objective, dict):
        return None  # a bare objective is an id
    label = objective.get('label')
    current = (campaign.get('storyProgress') or {}).get('current') or {}
    if not label and isinstance(current, dict) and objective.get('id') and current.get('id') == objective.get('id'):
        label = current.get('label')
    return label.strip() if isinstance(label, str) and label.strip() else None


def brief(goal):
    if not goal:
        return None
    progress = goal.get('progress') or {}
    return {'id': goal['id'], 'status': goal['status'], 'text': (goal.get('source') or {}).get('text'), 'step': progress.get('step'),
            'steps': progress.get('steps'), 'kind': progress.get('kind'), 'phase': progress.get('phase'), 'detail': progress.get('detail'),
            'question': goal.get('question'), 'result': goal.get('result'), 'updatedAt': goal.get('updatedAt')}


def active_goal(goals):
    """The goal the supervisor works on: the oldest open goal not waiting for the owner."""
    return next((g for g in goals if g['status'] in OPEN and (g.get('progress') or {}).get('phase') != 'needs-decision'), None)


class GoalStore:
    """<runtime>/goals.json: every open goal plus the latest finished goals."""

    def __init__(self, directory):
        self.directory = Path(directory)
        self.path = self.directory/'goals.json'
        self._lock = threading.RLock()
        self.finished = []  # callbacks(goal) once a goal reaches done, failed or cancelled (the request log's outcomes)

    @contextmanager
    def locked(self):
        with self._lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            with (self.directory/'goals.lock').open('a') as lock:
                file_lock.flock(lock, file_lock.LOCK_EX)
                try:
                    yield
                finally:
                    file_lock.flock(lock, file_lock.LOCK_UN)

    def read(self):
        try:
            data = json.loads(self.path.read_text())
        except FileNotFoundError:
            return {'schema': STORE_SCHEMA, 'goals': []}
        if data.get('schema') != STORE_SCHEMA or not isinstance(data.get('goals'), list):
            raise ValueError('The goal store has an unsupported format.')
        return data

    def write(self, data):
        finished = sorted((g for g in data['goals'] if g['status'] in TERMINAL), key=lambda g: g.get('finishedAt') or g.get('updatedAt') or '')
        drop = {g['id'] for g in finished[:-KEEP_FINISHED]} if len(finished) > KEEP_FINISHED else set()
        data = {'schema': STORE_SCHEMA, 'goals': [g for g in data['goals'] if g['id'] not in drop], 'updatedAt': now_iso()}
        atomic_file(self.path, json.dumps(data).encode())

    def list(self):
        with self.locked():
            return copy.deepcopy(self.read()['goals'])

    def get(self, goal_id):
        return next((g for g in self.list() if g['id'] == goal_id), None)

    def active(self):
        return active_goal(self.list())

    def create(self, goal):
        with self.locked():
            data = self.read()
            prior = next((g for g in data['goals'] if g['idempotencyKey'] == goal['idempotencyKey']), None)
            if prior:
                if prior['digest'] != goal['digest']:
                    raise ValueError('This goal identifier was already used with a different goal.')
                return copy.deepcopy(prior)
            data['goals'].append(goal)
            self.write(data)
            return copy.deepcopy(goal)

    def update(self, goal_id, apply):
        with self.locked():
            data = self.read()
            goal = next((g for g in data['goals'] if g['id'] == goal_id), None)
            if goal is None:
                raise ValueError('Goal not found.')
            before = goal['status']
            apply(goal)
            goal['updatedAt'] = now_iso()
            self.write(data)
            result = copy.deepcopy(goal)
        if before not in TERMINAL and result['status'] in TERMINAL:
            for listener in list(self.finished):
                try:
                    listener(copy.deepcopy(result))
                except Exception:  # a listener (the request log) never breaks the supervisor
                    pass
        return result

    def summary(self):
        """Goal status for the session payload (the Activity outline)."""
        try:
            goals = self.read()['goals']
        except (OSError, ValueError):
            return None
        active = active_goal(goals)
        finished = [g for g in goals if g['status'] in TERMINAL]
        last = max(finished, key=lambda g: g.get('finishedAt') or g.get('updatedAt') or '', default=None)
        return {'active': brief(active), 'queued': sum(g['status'] == 'queued' and g is not active for g in goals),
                'decisions': [brief(g) for g in goals if g['status'] == 'waiting' and (g.get('progress') or {}).get('phase') == 'needs-decision'],
                'last': brief(last)}


class GoalSupervisor:
    """Executes queued goals one at a time with the Suite's existing controls."""

    def __init__(self, sessions, farming, trading=None, *, clock=time.time, interval=2):
        self.sessions = sessions
        self.farming = farming
        self.trading = trading
        self.clock = clock
        self.interval = interval
        self.store = GoalStore(sessions.directory)
        self.error = None
        self._stop = threading.Event()
        self._thread = None
        self._tick_lock = threading.Lock()

    # Thread lifecycle (modeled on PostgamePartners).
    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name='suite-goal-supervisor', daemon=True)
        self._thread.start()

    def close(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def _run(self):
        while not self._stop.is_set():
            try:
                self.tick()
                self.error = None
            except Exception as error:  # The supervisor must outlive any single goal.
                self.error = f'{type(error).__name__}: {error}'
            self._stop.wait(self.interval)

    # Public API (HTTP endpoints).
    def submit(self, value):
        return self.store.create(self.normalize(value))

    def on_finish(self, listener):
        """Call listener(goal) once when a goal is done, failed or cancelled."""
        self.store.finished.append(listener)

    def cancel(self, goal_id):
        if not isinstance(goal_id, str) or not goal_id:
            raise ValueError('Choose a goal to cancel.')

        def apply(goal):
            if goal['status'] in TERMINAL:
                raise ValueError('This goal was already cancelled.' if goal['status'] == 'cancelled' else 'This goal has already finished.')
            started = any(s.get('started') for s in goal['execution'].get('steps') or [])
            goal['status'] = 'cancelled'
            goal['finishedAt'] = now_iso()
            goal['question'] = None
            goal['execution']['withdraw'] = {'status': 'pending' if started else 'none', 'effects': []}
            self._progress(goal, 'cancelled', 'Cancelled by you.' + (' Withdrawing what this goal started.' if started else ''))
        return self.store.update(goal_id, apply)

    def goals(self):
        goals = self.store.list()
        active = active_goal(goals)
        return {'goals': goals, 'active': active['id'] if active else None,
                'supervisor': {'running': bool(self._thread and self._thread.is_alive()), 'error': self.error}}

    # Validation.
    def normalize(self, value):
        if not isinstance(value, dict):
            raise ValueError('Send a goal object.')
        fields(value, {'schema', 'id', 'createdAt', 'status', 'source', 'game', 'save', 'steps', 'then', 'progress', 'idempotencyKey'},
               {'steps', 'idempotencyKey'}, 'Goal')
        if value.get('schema', SCHEMA) != SCHEMA:
            raise ValueError(f'Goals use the {SCHEMA} format.')
        key = value['idempotencyKey']
        if not isinstance(key, str) or not KEY.fullmatch(key):
            raise ValueError('A goal identifier (idempotencyKey) of 8 to 100 letters, digits, - or _ is required.')
        game = value.get('game', 'firered')
        if game != 'firered' or not self.sessions.configured(game):
            raise ValueError('Goals are currently available for a configured FireRed game.')
        source = value.get('source') or {}
        fields(source, {'text', 'via', 'interpreter', 'draftId'}, set(), 'Request source')
        if source.get('text') is not None and (not isinstance(source['text'], str) or len(source['text']) > 2000):
            raise ValueError('The request text is too long or invalid.')
        if source.get('via', 'ui') not in ('typed', 'voice', 'ui'):
            raise ValueError('Choose how the request arrived: typed, voice or ui.')
        if source.get('draftId') is not None and (not isinstance(source['draftId'], str) or not DRAFT_ID.fullmatch(source['draftId'])):
            raise ValueError('The request draft identifier is invalid.')
        interpreter = source.get('interpreter')
        if interpreter is not None:
            fields(interpreter, {'parser', 'confidence', 'model'}, set(), 'Interpreter')
            confidence = interpreter.get('confidence')
            if interpreter.get('parser') not in (None, 'deterministic', 'laya') or confidence is not None and (
                    type(confidence) not in (int, float) or not 0 <= confidence <= 1):
                raise ValueError('The interpreter details are invalid.')
        steps = value['steps']
        if not isinstance(steps, list) or not 1 <= len(steps) <= 10:
            raise ValueError('Add 1 to 10 steps to the goal.')
        normalized = []
        for index, raw in enumerate(steps):
            normalized.append(self._referencing_step(raw, index, game, normalized))
        steps = normalized
        save = self._save_choice(value.get('save'), steps)
        then = value.get('then', 'standing-goals')
        if then not in THEN:
            raise ValueError('Choose what happens after the goal: standing-goals or await-command.')
        source = {'text': source.get('text'), 'via': source.get('via', 'ui'), 'interpreter': interpreter,
                  **({'draftId': source['draftId']} if source.get('draftId') else {})}
        digest = hashlib.sha256(json.dumps({'game': game, 'save': save, 'steps': steps, 'then': then, 'text': source['text']},
                                           sort_keys=True).encode()).hexdigest()
        stamp = now_iso()
        goal = {'schema': SCHEMA, 'id': str(uuid.uuid4()), 'createdAt': stamp, 'updatedAt': stamp, 'status': 'queued', 'source': source,
                'game': game, 'save': save, 'steps': steps, 'then': then, 'idempotencyKey': key, 'digest': digest,
                'progress': {'step': 0, 'steps': len(steps), 'kind': steps[0]['kind'], 'phase': 'queued', 'detail': 'Waiting to start.', 'updatedAt': stamp},
                'question': None, 'result': None,
                'execution': {'save': None, 'plan': None, 'steps': [], 'before': None, 'standing': None, 'attempts': 0, 'retryAt': 0, 'lastError': None}}
        return goal

    def _save_choice(self, value, steps):
        value = {} if value is None else value
        fields(value, {'mode', 'trainerName', 'starter', 'label'}, set(), 'Save choice')
        mode = value.get('mode', 'current-if-able')
        if mode not in SAVE_MODES:
            raise ValueError('Choose a save mode: current-if-able, current or new.')
        from .pokemon_campaigns import TRAINER_NAME, STARTERS
        name, starter, label = value.get('trainerName'), value.get('starter'), value.get('label')
        if name is not None and (not isinstance(name, str) or not TRAINER_NAME.fullmatch(name)):
            raise ValueError('Choose a trainer name of 1 to 7 letters (A–Z, a–z).')
        if starter is not None and starter not in STARTERS:
            raise ValueError('Choose a native FireRed starter: Bulbasaur, Charmander, Squirtle or random.')
        if label is not None and (not isinstance(label, str) or not label.strip() or len(label) > 50):
            raise ValueError('Name the new save using 1 to 50 characters.')
        if steps[0]['kind'] == 'campaign' and not steps[0].get('continue') and mode == 'current':
            raise ValueError('A campaign starts a new save; choose save mode new or current-if-able.')
        return {'mode': mode, 'trainerName': name, 'starter': starter, 'label': label.strip() if label else None}

    def _referencing_step(self, raw, index, game, earlier):
        """Validate a step's {"$ref"} fields against earlier steps, then the step itself."""
        found = list(references(raw))
        if not found:
            return self._step(raw, index, game)
        substituted = raw
        for path, ref in found:
            if not path or path == ('kind',):
                raise ValueError(f'Step {index + 1}: a reference can only replace a step setting.')
            if set(ref) != {'$ref'} or not isinstance(ref['$ref'], str):
                raise ValueError(f'Step {index + 1}: a reference must be written as {{"$ref": "steps[N].result.<field>"}} only.')
            match = REF.fullmatch(ref['$ref'])
            if not match:
                raise ValueError(f'Step {index + 1}: invalid reference {ref["$ref"]!r}; use "steps[N].result.<field>".')
            source, field_path = int(match[1]), match[2]
            if source >= index:
                raise ValueError(f'Step {index + 1}: a reference must point to an earlier step (steps[0] to steps[{index - 1}]).' if index else
                                 'Step 1: a reference must point to an earlier step; the first step has none.')
            kind = earlier[source]['kind']
            first = field_path.split('.')[0]
            known = RESULT_FIELDS.get(kind, ())
            if kind == 'postgame' and not earlier[source].get('priorityTarget'):
                known = ()
            if first not in known or '.' in field_path and first not in CONTAINERS:
                raise ValueError(f'Step {index + 1}: step {source + 1} ({kind}) has no result field {field_path!r}.' +
                                 (f" Known fields: {', '.join(known)}." if known else ' It records no result fields.'))
            try:
                sample = lookup(sample_result(earlier[source]), field_path)
            except KeyError as error:
                raise ValueError(f'Step {index + 1}: step {source + 1} has no result field {field_path!r}.') from error
            substituted = replace_at(substituted, path, sample)
        try:
            self._step(substituted, index, game)
        except ValueError as error:
            raise ValueError(f'Step {index + 1} (with its references filled from earlier results): {error}') from error
        # Stored as written; the references are resolved when the step starts.
        return copy.deepcopy(raw)

    def _step(self, raw, index, game):
        kind = raw.get('kind') if isinstance(raw, dict) else None
        if kind not in STEP_KINDS:
            raise ValueError(f'Unknown goal step: {kind or raw!r}.')
        if kind == 'farming':
            fields(raw, {'kind', 'request'}, {'request'}, 'Hunt step')
            if not isinstance(raw['request'], dict) or raw['request'].get('game') != game:
                raise ValueError('The hunt request must be for this game.')
            return {'kind': kind, 'request': self.farming.preview(raw['request'])['request']}
        if kind == 'postgame':
            fields(raw, {'kind', 'priorityTarget'}, set(), 'Postgame step')
            target = raw.get('priorityTarget')
            if target is None:
                return {'kind': kind, 'priorityTarget': None}
            from .pokemon_sessions import priority_target
            priority_target(target)
            if not static_target(target['speciesId']):
                raise ValueError('The postgame priority target must be a supported static Pokémon (Mewtwo, Articuno, Zapdos, Moltres or Snorlax).')
            result = {'speciesId': target['speciesId'], 'shiny': target.get('shiny', 'required')}
            if target.get('request') is not None:
                request = self.farming.preview(target['request'])['request']
                if request['speciesId'] != result['speciesId'] or request['shiny'] != result['shiny']:
                    raise ValueError('The priority request must be for the same Pokémon and shiny setting.')
                result['request'] = request
            return {'kind': kind, 'priorityTarget': result}
        if kind == 'player-task':
            fields(raw, {'kind', 'action', 'task'}, {'action'}, 'Player task step')
            action, task = raw['action'], raw.get('task')
            if action not in PLAYER_ACTIONS:
                raise ValueError('Choose a supported player task action: ' + ', '.join(PLAYER_ACTIONS) + '.')
            if action == 'start':
                from .pokemon_player_tasks import validate
                validate(self.sessions, game, task)
            elif action == 'new-save':
                fields(task, {'label'}, {'label'}, 'New save')
                if not isinstance(task['label'], str) or not task['label'].strip() or len(task['label']) > 50:
                    raise ValueError('Name the save using 1 to 50 characters.')
            elif action == 'restore-save':
                fields(task, {'profileId'}, {'profileId'}, 'Restore save')
                if not isinstance(task['profileId'], str) or not task['profileId']:
                    raise ValueError('Choose a saved profile to restore.')
            elif task not in (None, {}):
                raise ValueError('This player task action takes no settings.')
            return {'kind': kind, 'action': action, **({'task': task} if action in ('start', 'new-save', 'restore-save') else {})}
        if kind == 'collection':
            fields(raw, {'kind', 'goal', 'collectionStages'}, {'goal'}, 'Collection step')
            if raw['goal'] not in ('supported', 'national-dex'):
                raise ValueError('Choose a supported collection goal: supported or national-dex.')
            if raw.get('collectionStages') not in (None, 'base-forms', 'each-stage'):
                raise ValueError('Choose collection stages: base-forms or each-stage.')
            return {'kind': kind, 'goal': raw['goal'], **({'collectionStages': raw['collectionStages']} if raw.get('collectionStages') else {})}
        if kind == 'trade':
            fields(raw, {'kind', 'via', 'payload'}, {'via', 'payload'}, 'Trade step')
            payload = raw['payload']
            if raw['via'] == 'trade-shiny':
                fields(payload, {'shinyId'}, {'shinyId'}, 'Shiny trade')
                if not isinstance(payload['shinyId'], str) or not HEX64.fullmatch(payload['shinyId']):
                    raise ValueError('Choose a saved shiny Pokémon to trade.')
            elif raw['via'] == 'trade-pokemon':
                fields(payload, {'pokemonId', 'sourceId'}, {'pokemonId'}, 'Pokémon trade')
                if not isinstance(payload['pokemonId'], str) or not HEX64.fullmatch(payload['pokemonId']) or payload.get('sourceId', 'current') != 'current':
                    raise ValueError('Choose a Pokémon from the current PC inventory to trade.')
            else:
                raise ValueError('Choose a trade: trade-shiny or trade-pokemon.')
            return {'kind': kind, 'via': raw['via'], 'payload': dict(payload)}
        if kind == 'campaign':
            if index != 0:
                raise ValueError("A campaign step must be the goal's first step.")
            fields(raw, {'kind', 'settings', 'continue'}, {'settings'}, 'Campaign step')
            if 'continue' in raw and raw['continue'] is not True:
                raise ValueError('A campaign step’s continue setting is true (continue this save’s story campaign) or absent (a new run).')
            from .pokemon_campaigns import check_settings
            return {'kind': kind, 'settings': check_settings(raw['settings']), **({'continue': True} if raw.get('continue') else {})}
        fields(raw, {'kind', 'question'}, {'question'}, 'Status step')
        if raw['question'] not in STATUS_QUESTIONS:
            raise ValueError('Choose a supported status question: ' + ', '.join(STATUS_QUESTIONS) + '.')
        return {'kind': kind, 'question': raw['question']}

    # Supervision.
    def tick(self):
        with self._tick_lock:
            for goal in self.store.list():
                if goal['status'] == 'cancelled' and (goal['execution'].get('withdraw') or {}).get('status') == 'pending':
                    self._withdraw(goal)
            goal = self.store.active()
            if goal is None:
                return None
            if self.clock() < goal['execution'].get('retryAt', 0):
                return goal
            try:
                self._advance(goal)
            except Cancelled:
                pass
            except (ValueError, OSError, sqlite3.Error, subprocess.SubprocessError) as error:
                self._retry(goal['id'], str(error) or type(error).__name__)
            except (KeyError, TypeError) as error:  # An unexpected owner status shape: retry, visibly.
                self._retry(goal['id'], f'{type(error).__name__}: {error}')
            return self.store.get(goal['id'])

    def _commit(self, goal):
        def apply(stored):
            if stored['status'] == 'cancelled':
                raise Cancelled()
            stored.clear()
            stored.update(copy.deepcopy(goal))
        try:
            self.store.update(goal['id'], apply)
        except ValueError as error:
            raise Cancelled() from error

    def _progress(self, goal, phase, detail, step=None):
        progress = goal.setdefault('progress', {})
        plan = goal['execution'].get('plan') or goal['steps']
        if step is not None:
            progress['step'] = step
        index = min(progress.get('step', 0), len(plan) - 1)
        progress.update(phase=phase, detail=detail, updatedAt=now_iso(), steps=len(plan), kind=plan[index]['kind'])

    def _retry(self, goal_id, message):
        def apply(goal):
            if goal['status'] not in OPEN:
                return
            ex = goal['execution']
            ex['attempts'] = ex.get('attempts', 0) + 1
            delay = min(300, 15*2**min(ex['attempts'] - 1, 5))
            ex['retryAt'] = self.clock() + delay
            ex['lastError'] = message
            goal['status'] = 'waiting'
            self._progress(goal, 'retrying', f'{message.rstrip(".")}. Retrying in {delay} s.')
        try:
            self.store.update(goal_id, apply)
        except ValueError:
            pass

    def _advance(self, goal):
        ex, game = goal['execution'], goal['game']
        live = self.sessions._live(game)
        if goal['status'] == 'queued':
            goal['status'] = 'running'
            goal['startedAt'] = now_iso()
        if ex['plan'] is None:
            # The owner asked for this goal: open its game to inspect the save.
            live = live or self.sessions.ensure(game)
            return self._resolve_save(goal, live)
        index = next((i for i, s in enumerate(ex['steps']) if s['status'] not in ('done', 'skipped')), None)
        if index is None:
            return self._finish(goal)
        step, state = ex['plan'][index], ex['steps'][index]
        # The game was open when the goal resolved its save. If it is closed now,
        # the owner closed it (or it stopped): wait instead of relaunching it.
        if live is None:
            goal['status'] = 'waiting'
            self._progress(goal, 'game-offline', 'FireRed is not running. Start the game to continue this goal.', step=index)
            return self._commit(goal)
        pinned, current = (ex.get('save') or {}).get('trainerId'), (live.get('gameProgress') or {}).get('trainerId')
        if step['kind'] != 'campaign' and isinstance(pinned, int) and isinstance(current, int) and pinned != current:
            goal['status'] = 'waiting'
            self._progress(goal, 'other-save', 'The active save is not this goal’s save. Restore it from Save profiles to continue, or cancel the goal.', step=index)
            return self._commit(goal)
        if not state.get('resolved') and next(references(step), None):
            resolved = self._resolve(goal, index, step, live)
            if isinstance(resolved, str):
                goal['status'] = 'waiting'
                self._progress(goal, 'needs-result', resolved, step=index)
                return self._commit(goal)
            ex['plan'][index] = step = resolved
            state['resolved'] = True
        campaign = live.get('campaign') or {}
        if campaign and campaign.get('status') != 'complete' and not state.get('started') and (
                step['kind'] in HOLD_DURING_CAMPAIGN or step['kind'] == 'player-task' and step['action'] == 'start'):
            # The engine refuses tasks, trades and the checklist while a story
            # campaign is unfinished (and Start bot resumes the campaign): hold.
            goal['status'] = 'waiting'
            self._progress(goal, 'after-campaign', 'This step starts after the story campaign enters the Hall of Fame.', step=index)
            return self._commit(goal)
        handler = getattr(self, '_run_' + step['kind'].replace('-', '_'))
        status, phase, detail = handler(goal, index, step, state, live)
        state['detail'] = detail
        if status == 'done':
            state.update(status='done', finishedAt=now_iso())
        elif status == 'failed':
            state['status'] = 'failed'
        else:
            state['status'] = 'running' if state.get('started') else 'pending'
        if status in ('running', 'done'):
            ex['attempts'] = 0
            ex['lastError'] = None
        goal['status'] = {'failed': 'failed', 'waiting': 'waiting'}.get(status, 'running')
        if status == 'failed':
            goal['finishedAt'] = now_iso()
            goal['result'] = {'summary': detail, 'step': index}
        self._progress(goal, phase, detail, step=index)
        self._commit(goal)

    # Step results and references.
    def _resolve(self, goal, index, step, live):
        """Fill {"$ref"} fields from completed steps' recorded results; a reason if one is missing."""
        ex = goal['execution']
        offset = len(ex['plan']) - len(goal['steps'])
        for path, ref in list(references(step)):
            match = REF.fullmatch(ref['$ref'])
            source, field_path = int(match[1]), match[2]
            source_state, source_step = ex['steps'][source + offset], ex['plan'][source + offset]
            if source_state.get('status') != 'done':
                return f'Step {index - offset + 1} waits for the result of step {source + 1}.'
            try:
                value = lookup(source_state.get('result') or {}, field_path)
            except KeyError:
                # A receipt can be written after completion was observed: read it again.
                if source_step['kind'] in ('farming', 'postgame') and source_state.get('requestId'):
                    source_state['result'] = self._hunt_record(goal['game'], source_state['requestId'], hunt_request(source_step), live)
                try:
                    value = lookup(source_state.get('result') or {}, field_path)
                except KeyError:
                    return (f'Step {index - offset + 1} needs {field_path} from step {source + 1}, but no verified receipt records it '
                            f'(for a hunt: the saved capture that identifies the individual). Nothing is guessed; the goal waits. '
                            f'Cancel it to choose the Pokémon yourself.')
            step = replace_at(step, path, copy.deepcopy(value))
        return step

    def _hunt_record(self, game, rid, request, live, name=None):
        """The caught individuals of a hunt, read from its native-save receipts only."""
        directory = self.sessions.directory/game
        try:
            record = self.farming.get(rid)
        except ValueError:
            record = None
        found, source = [], None
        if record and record.get('sourceTask'):
            receipt = read_json(directory/f'acquisition-{rid}.json') or {}
            pokemon = receipt.get('pokemon') or {}
            fingerprint = receipt.get('fingerprint') or identity_of(pokemon)
            if receipt.get('requestId') == rid and receipt.get('nativeSaveVerified') is True and fingerprint:
                found, source = [{'fingerprint': fingerprint, 'pokemon': pokemon, 'savedSramSha256': receipt.get('savedSramSha256')}], 'acquisition'
        if not found:
            sessions = [((read_json(directory/'hunts'/rid/sub/'current.json') or {}).get('metadata') or {}).get('session')
                        for sub in (Path('native-radio/saves'), Path('saves'))]
            archived = read_json(directory/f'archived-{rid}.json') or {}
            sessions.append({'id': rid, 'mission': archived['mission']} if isinstance(archived.get('mission'), dict) else None)
            for session in sessions:
                if not isinstance(session, dict) or session.get('id') != rid:
                    continue
                mission = session.get('mission') or {}
                if isinstance(mission.get('captures'), list):
                    found = [c for c in mission['captures'] if isinstance(c, dict) and c.get('target') is True
                             and c.get('savedSramSha256') and isinstance(c.get('fingerprint'), str)]
                else:
                    evidence = session.get('captureEvidence') or {}
                    if evidence.get('nativeSaveVerified') is True and isinstance(evidence.get('fingerprint'), str):
                        found = [evidence]
                if found:
                    source = 'hunt-save'
                    break
        if not found:
            found = [r for r in live.get('collection') or [] if r.get('requestId') == rid and r.get('nativeSaveVerified') is True and isinstance(r.get('fingerprint'), str)]
            source = 'collection' if found else None
        owned = {r.get('fingerprint'): r for r in live.get('collection') or [] if r.get('owned')}

        def describe(capture):
            pokemon = capture.get('pokemon') or {}
            try:
                identity = json.loads(capture['fingerprint'])
            except ValueError:
                return None
            if not isinstance(identity, list) or len(identity) != 9 or any(type(n) is not int for n in identity):
                return None
            nature = pokemon.get('nature')
            values = {'fingerprint': capture['fingerprint'], 'identity': identity, 'species': pokemon.get('species', identity[0]),
                      'personality': pokemon.get('personality', identity[1]), 'otId': pokemon.get('otId', identity[2]),
                      'shiny': pokemon.get('shiny'), 'nature': nature.get('name') if isinstance(nature, dict) else nature,
                      'ivs': pokemon.get('ivs') or dict(zip(IV_STATS, identity[3:])), 'location': (owned.get(capture['fingerprint']) or {}).get('location'),
                      'shinyId': (owned.get(capture['fingerprint']) or {}).get('id'), 'pokemonId': inventory_id(game, capture['fingerprint']),
                      'savedSramSha256': capture.get('savedSramSha256'), 'source': source}
            return {k: v for k, v in values.items() if v is not None}
        captures = [d for d in map(describe, found) if d]
        mission = live.get('mission') or {}
        caught = len(captures) or (mission.get('caught') if mission.get('id') == rid else None)
        result = {'requestId': rid, 'speciesId': request['speciesId'], 'name': name or species_name(request['speciesId']), 'caught': caught,
                  **(captures[0] if captures else {}), 'captures': captures}
        return {k: v for k, v in result.items() if v is not None}

    # Save resolution.
    def _resolve_save(self, goal, live):
        ex = goal['execution']
        decision = self._decide_save(goal, live)
        if decision['decision'] == 'unknown':
            self._progress(goal, 'checking-save', decision['reason'])
            return self._commit(goal)
        if decision['decision'] == 'failed':
            goal.update(status='failed', finishedAt=now_iso(), result={'summary': decision['reason'], 'step': None})
            self._progress(goal, 'failed', decision['reason'])
            return self._commit(goal)
        if decision['decision'] == 'waiting':
            goal['status'] = 'waiting'
            goal['question'] = {'kind': 'save-choice', 'text': decision['reason'],
                                'choices': [{'id': 'new-save', 'label': 'Start a new save from New Game (the current save is backed up first)'},
                                            {'id': 'cancel', 'label': 'Cancel this goal'}]}
            self._progress(goal, 'needs-decision', decision['reason'])
            return self._commit(goal)
        plan = copy.deepcopy(goal['steps'])
        if decision['decision'] == 'new' and plan[0]['kind'] != 'campaign':
            plan.insert(0, {'kind': 'campaign', 'settings': self._campaign_settings(goal), 'implicit': True})
        trainer = (live.get('gameProgress') or {}).get('trainerId')
        pin = {'trainerId': trainer} if decision['decision'] == 'current' and isinstance(trainer, int) else {}
        ex.update(save={**decision, **pin, 'resolvedAt': now_iso()}, plan=plan, steps=[{'status': 'pending'} for _ in plan], before=self._before(live))
        self._progress(goal, 'starting', ('A new save from New Game: ' if decision['decision'] == 'new' else 'The current save: ') + decision['reason'], step=0)
        return self._commit(goal)

    def _decide_save(self, goal, live):
        mode, steps = goal['save']['mode'], goal['steps']
        if mode != 'new' and steps[0]['kind'] == 'campaign' and steps[0].get('continue'):
            return self._decide_story(live)
        if mode == 'new' or steps[0]['kind'] == 'campaign':
            return {'decision': 'new', 'reason': 'A new save was requested.'}
        needs_save = any(s['kind'] in NEEDS_SAVE for s in steps)
        if needs_save and live.get('newProfile') is True:
            # A blank profile at New Game: only a new campaign can reach the goal.
            if mode == 'current-if-able':
                return {'decision': 'new', 'blank': True, 'reason': 'No save exists yet.'}
            return {'decision': 'waiting', 'reason': 'No save exists yet on the current profile. Say “on a new save” to start a new game.'}
        checks = [self._feasible(step, live) for step in steps]
        unknown = next((c for c in checks if c['ok'] is None), None)
        if unknown:
            return {'decision': 'unknown', 'reason': unknown['reason']}
        blocked = [c for c in checks if c['ok'] is False]
        if not blocked:
            return {'decision': 'current', 'reason': 'The current save can reach this goal.'}
        reason = ' '.join(c['reason'] for c in blocked)
        if all(c.get('newSave') for c in blocked):
            return {'decision': 'waiting', 'reason': reason + ' Say “on a new save” to start a new game from New Game; the current save is backed up first.'}
        return {'decision': 'failed', 'reason': reason}

    def _decide_story(self, live):
        """"play the story": continue the save's unfinished story campaign; with no save yet, start one from New Game."""
        campaign = live.get('campaign') or {}
        if campaign.get('id') and campaign.get('status') != 'complete':
            return {'decision': 'current', 'reason': 'Continues this save’s story campaign.', 'campaignId': campaign['id']}
        league = (live.get('gameProgress') or {}).get('leagueComplete')
        if league is True or campaign.get('status') == 'complete':
            return {'decision': 'waiting', 'reason': 'This save has already entered the Hall of Fame, so its story is finished. The stronger League '
                    'rematch is part of the postgame checklist (say “do the postgame”); say “start a new game” to play the story again on a new '
                    'save (this save is backed up first). Cancel this goal to keep the save as it is.'}
        if live.get('newProfile') is True:
            return {'decision': 'new', 'blank': True, 'reason': 'No save exists yet, so the story starts from New Game.'}
        if league is None:
            return {'decision': 'unknown', 'reason': 'Waiting for the game to report its story progress.'}
        return {'decision': 'waiting', 'reason': 'The bot didn’t start this save’s story, so it can’t continue it. Say “start a new game” to play '
                'the story from New Game on a new save (this save is backed up first), or cancel this goal.'}

    def _feasible(self, step, live):
        if next(references(step), None):
            return {'ok': True}  # decided when its referenced results exist
        progress = live.get('gameProgress') or {}
        campaign = live.get('campaign') or {}
        story = bool(campaign) and campaign.get('status') != 'complete'
        if step['kind'] == 'farming':
            return self._feasible_hunt(step['request'], live, story)
        if step['kind'] == 'postgame':
            target = step.get('priorityTarget')
            if target:
                return self._feasible_hunt(target.get('request') or static_request(target['speciesId'], target['shiny']), live, story)
            if progress.get('leagueComplete') is True or story:
                return {'ok': True}
            if progress.get('leagueComplete') is None:
                return {'ok': None, 'reason': 'Waiting for the game to report its story progress.'}
            return {'ok': False, 'newSave': True, 'reason': 'The postgame needs the Hall of Fame, and this save has no automated story campaign.'}
        return {'ok': True}

    def _feasible_hunt(self, request, live, story):
        species = request['speciesId']
        target = static_target(species)
        if target:
            from .pokemon_sessions import static_availability
            availability = static_availability(live, species)
            name = target['name']
            if availability is None or availability.get('used') is None:
                return {'ok': None, 'reason': f'Waiting for the game to report {name}’s encounter.'}
            if availability['used'] is True:
                return {'ok': False, 'newSave': True, 'reason': f'{name}’s one-time encounter is already used in this save.'}
            if story:
                return {'ok': True}
            league = league_requirement(availability)
            if league is None:
                return {'ok': None, 'reason': 'Waiting for the game to report its story progress.'}
            if league is False:
                return {'ok': False, 'newSave': True, 'reason': f'{name} needs the Hall of Fame, and this save has no automated story campaign.'}
            return {'ok': True}
        if story:
            return {'ok': True}
        plan = self.farming.preview(request)
        if plan.get('canStart') or plan.get('canStartSource'):
            return {'ok': True}
        gift = species == 133 and (live.get('gameProgress') or {}).get('eeveeGiftAvailable') is False
        return {'ok': False, 'newSave': gift, 'reason': (plan.get('limitations') or ['No executable acquisition route is available.'])[0]}

    def _campaign_settings(self, goal):
        save, text = goal['save'], ((goal.get('source') or {}).get('text') or '').strip()
        label = save.get('label') or ('Goal: ' + text if text else 'Goal run')
        if len(label) > 50:
            label = label[:49].rsplit(' ', 1)[0].rstrip(',;:') + '…'  # a run label holds 50 characters
        settings = {'label': label, 'afterCampaign': 'postgame'}
        if save.get('starter'):
            settings['starter'] = save['starter']
        if save.get('trainerName'):
            settings['trainerName'] = save['trainerName']
        return settings

    def _before(self, live):
        from .pokemon_shiny_sweep import ShinySweep
        try:
            sweep = ShinySweep(self.sessions.directory/'firered', None, self.sessions).read()
        except (OSError, ValueError):
            sweep = None
        bot = live.get('bot') or {}
        # The collection is a standing goal only if it was what the bot was running.
        collecting = sweep and sweep.get('enabled') and bot.get('enabled') and bot.get('runScope') == 'collection'
        return {'collection': sweep.get('goal', 'supported') if collecting else None,
                'runScope': bot.get('runScope'), 'awaitingCommand': bot.get('awaitingCommand')}

    # Steps.
    def _run_campaign(self, goal, index, step, state, live):
        game = goal['game']
        decision = goal['execution'].get('save') or {}
        continued = step.get('continue') and decision.get('decision') == 'current'
        if not state.get('campaignId') and continued:
            campaign, bot = live.get('campaign') or {}, live.get('bot') or {}
            if campaign.get('id') != decision.get('campaignId') or campaign.get('status') == 'complete':
                return 'waiting', 'yielded', 'The story campaign this goal continues is not the active save. Restore it from Save profiles to continue.'
            if not (bot.get('enabled') and campaign.get('status') == 'running'):
                self.sessions.command(game, {'type': 'resume-campaign'}, session_id=live.get('sessionId'))  # as Start game does
            state.update(campaignId=campaign['id'], started=True, startedAt=now_iso())
            self._commit(goal)
            return 'running', 'campaign', 'Continuing this save’s story campaign.'
        if not state.get('campaignId'):
            if not state.get('previewId'):
                state['previewId'] = self.sessions.preview_campaign(game, step['settings'])['preview']['id']
                self._commit(goal)
            try:
                self.sessions.start_campaign(game, state['previewId'])
            except ValueError as error:
                if re.search('Review the new run again|no longer available|Review a new run', str(error)):
                    state.pop('previewId', None)
                    self._commit(goal)
                raise
            state.update(campaignId=state['previewId'], started=True, startedAt=now_iso())
            self._commit(goal)
            if decision.get('blank'):
                return 'running', 'campaign', 'Started the story from New Game.'
            return 'running', 'campaign', 'Started a new save from New Game and its story campaign. The previous save was backed up.'
        campaign, bot = live.get('campaign') or {}, live.get('bot') or {}
        if campaign.get('id') != state['campaignId']:
            return 'waiting', 'yielded', 'The goal’s campaign save is not the active save. Restore it from Save profiles to continue.'
        status = campaign.get('status')
        if status == 'complete':
            trainer = (live.get('gameProgress') or {}).get('trainerId')
            if isinstance(trainer, int):
                goal['execution']['save']['trainerId'] = trainer  # later steps run on this save only
            state['result'] = {'campaignId': state['campaignId'], **({'trainerId': trainer} if isinstance(trainer, int) else {})}
            return 'done', 'hall-of-fame', 'This save entered the Hall of Fame.' if continued else 'The new save entered the Hall of Fame.'
        if status == 'blocked':
            return 'waiting', 'attention', f"The story campaign needs attention: {campaign.get('reason') or 'see the game view'}. Start the bot to retry."
        if not bot.get('enabled'):
            return 'waiting', 'paused', 'Stopped by you. Start the bot to continue the story campaign.'
        badges = ((campaign.get('storyProgress') or {}).get('badges') or {}).get('earned')
        label = objective_label(campaign)
        return 'running', 'campaign', 'Playing the story campaign' + (f' ({badges}/8 badges)' if isinstance(badges, int) else '') + (f': {label}' if label else '') + '.'

    def _run_farming(self, goal, index, step, state, live):
        return self._hunt(goal, index, step['request'], state, live)

    def _run_postgame(self, goal, index, step, state, live):
        target = step.get('priorityTarget')
        if target:
            return self._hunt(goal, index, target.get('request') or static_request(target['speciesId'], target['shiny']), state, live)
        campaign = live.get('campaign') or {}
        if campaign and campaign.get('status') != 'complete':
            return 'waiting', 'after-campaign', 'The postgame checklist starts after the story campaign enters the Hall of Fame.'
        league = (live.get('gameProgress') or {}).get('leagueComplete')
        if league is None:
            return 'running', 'checking-save', 'Waiting for the game to report its story progress.'
        if league is False:
            return 'failed', 'failed', 'The postgame needs the Hall of Fame first.'
        self.sessions.player_task(goal['game'], 'postgame', None)
        state.update(started=True, startedAt=now_iso())
        return 'done', 'postgame', 'The postgame checklist is running.'

    def _hunt(self, goal, index, request, state, live):
        """One hunt: a saved farming request, started directly or as the postgame priority."""
        species = request['speciesId']
        target = static_target(species)
        name = species_name(species)
        if not state.get('requestId'):
            record = self.farming.save(request, f"goal-{goal['id']}-{index}")
            state['requestId'] = record['id']
            self._commit(goal)
        rid = state['requestId']
        result = self._hunt_result(goal, state, rid, request, live, name)
        if result:
            if result[0] == 'done':
                state['result'] = self._hunt_record(goal['game'], rid, request, live, name)
            return result
        campaign = live.get('campaign') or {}
        if campaign and campaign.get('status') != 'complete':
            return 'waiting', 'after-campaign', f'The {name} hunt starts after the story campaign enters the Hall of Fame.'
        bot = live.get('bot') or {}
        if state.get('started') and not bot.get('enabled'):
            # A user stop is authoritative; the goal waits for Start bot.
            return 'waiting', 'paused', 'Stopped by you. Start the bot to continue this goal.'
        progress = self._hunt_progress(goal, state, rid, live, name)
        if progress:
            state['started'] = True
            return progress
        if state.get('started'):
            if not bot.get('awaitingCommand'):
                return 'waiting', 'yielded', 'Another task has control of FireRed. This goal continues when it finishes.'
            if state.get('starts', 0) >= 5:
                return 'waiting', 'attention', f'The {name} hunt keeps stopping before it finishes. Start it from Pokémon requests, or cancel this goal.'
        mode = self._hunt_mode(species, target, live)
        if mode[0] == 'unknown':
            return 'running', 'checking-save', mode[1]
        if mode[0] == 'failed':
            return 'failed', 'failed', mode[1]
        # Persist the attempt first: a crash never multiplies starts.
        state.update(starts=state.get('starts', 0) + 1, lastStartAt=now_iso())
        self._commit(goal)
        if mode[0] == 'priority':
            saved = self.farming.get(rid)['request']
            self.sessions.player_task(goal['game'], 'postgame', {'priorityTarget': {'speciesId': species, 'shiny': saved['shiny'], 'requestId': rid, 'request': saved}})
            state.update(started=True, mode='priority')
            missing = mode[1]
            return 'running', 'postgame-priority', (f"{name} is the postgame priority target. The checklist completes {', '.join(missing)} first."
                                                    if missing else f'{name} is the postgame priority target; its hunt starts next.')
        started = self.farming.start(rid)
        state.update(started=True, mode='priority' if started.get('stage') == 'postgame-priority' else 'direct')
        return 'running', 'hunting', f'Started the {name} hunt.'

    def _hunt_mode(self, species, target, live):
        if not target:
            return ('direct',)
        from .pokemon_sessions import static_availability, postgame_running
        availability = static_availability(live, species)
        name = target['name']
        if availability is None or availability.get('used') is None:
            return ('unknown', f'Waiting for the game to report {name}’s encounter.')
        if availability['used'] is True:
            return ('failed', f'{name}’s one-time encounter is already used in this save.')
        if target['method'] == 'static' and availability.get('available') is True and not postgame_running(live):
            return ('direct',)
        league = league_requirement(availability)
        if league is None:
            return ('unknown', 'Waiting for the game to report its story progress.')
        if league is False:
            return ('failed', f'{name} needs the Hall of Fame first.')
        return ('priority', list(availability.get('missing') or []))

    def _hunt_progress(self, goal, state, rid, live, name):
        ids = {rid, rid + '-source'}
        mission, pending, bot = live.get('mission') or {}, live.get('pendingHunt') or {}, live.get('bot') or {}
        if mission.get('id') in ids:
            status = mission.get('state')
            if status == 'running':
                count = mission.get('resets') if mission.get('resets') else mission.get('encounters', 0)
                unit = 'resets' if mission.get('resets') else 'encounters'
                return 'running', 'hunting', f"Hunting {name}: {mission.get('phase') or 'searching'}, {count or 0} {unit}."
            if status == 'paused':
                return 'waiting', 'paused', 'Stopped by you. Start the bot to continue this goal.' if not bot.get('enabled') else f'The {name} hunt is paused.'
            if status == 'blocked':
                return self._blocked(goal, state, rid, mission, live, name)
        if pending.get('id') in ids:
            if pending.get('state') == 'blocked':
                return 'waiting', 'attention', pending.get('reason') or f'The {name} hunt could not start.'
            return 'running', 'queued', f'The {name} hunt starts when the current game task reaches a safe point.'
        target = (live.get('postgame') or {}).get('priorityTarget') or {}
        if target.get('requestId') == rid:
            objective = bot.get('objective') or {}
            current = objective.get('id') if isinstance(objective, dict) else objective
            if bot.get('status') == 'blocked' or ((objective.get('target') or {}) if isinstance(objective, dict) else {}).get('kind') == 'stop-for-review':
                # The checklist's own safety stop: reported, never overridden.
                reason = (bot.get('reason') or 'The postgame stopped for review.').rstrip('.')
                return 'waiting', 'attention', f'The postgame stopped before the {name} hunt: {reason}. Resolve it (Start bot retries), or cancel this goal.'
            return 'running', 'postgame-priority', f'{name} is the postgame priority target' + (f'; now: {current}.' if current else '.')
        return None

    def _blocked(self, goal, state, rid, mission, live, name):
        reason = (mission.get('reason') or 'The hunt stopped.').rstrip('.')
        if state.get('mode') == 'priority':
            return 'running', 'postgame-priority', f'The postgame deferred the {name} hunt ({reason}); it retries the priority target later.'
        if mission.get('protected') or live.get('mode') != 'overworld':
            return 'waiting', 'attention', f'{reason}. The found Pokémon must be resolved first.'
        retry = state.setdefault('retry', {'attempts': 0, 'nextAt': 0})
        if retry['attempts'] >= 3:
            return 'waiting', 'attention', f'The {name} hunt stopped: {reason}. Start it again from Pokémon requests, or cancel this goal.'
        now = self.clock()
        if now < retry['nextAt']:
            return 'waiting', 'retrying', f"Retrying the {name} hunt in {max(1, int(retry['nextAt'] - now))} s: {reason}."
        retry.update(attempts=retry['attempts'] + 1, nextAt=now + min(120, 15*2**retry['attempts']))
        self._commit(goal)
        self.farming.start(rid)
        return 'running', 'hunting', f"Retrying the {name} hunt ({retry['attempts']}/3) after: {reason}."

    def _hunt_result(self, goal, state, rid, request, live, name):
        ids, shiny = {rid, rid + '-source'}, request['shiny'] == 'required'
        what = ('a shiny ' if shiny else '') + name
        for record in live.get('collection') or []:
            if record.get('requestId') in ids and record.get('nativeSaveVerified') is True and captured_species(record) == request['speciesId'] and (
                    not shiny or (record.get('pokemon') or {}).get('shiny') is True):
                return 'done', 'caught', f'Caught and saved {what}.'
        mission = live.get('mission') or {}
        if mission.get('id') == rid and mission.get('state') == 'complete':
            return 'done', 'caught', f'Caught and saved {what}.'
        try:
            record = self.farming.get(rid)
        except ValueError:
            return 'failed', 'failed', 'The goal’s hunt request was removed.'
        if record.get('sourceTask') and self.sessions.completed_acquisition(record) or not record.get('sourceTask') and self.sessions.completed_hunt(record):
            return 'done', 'caught', f'Caught and saved {what}.'
        history = next((h for h in reversed((live.get('postgame') or {}).get('priorityHistory') or []) if h.get('requestId') == rid), None)
        if history:
            if history.get('outcome') != 'used':
                return 'failed', 'failed', f"Another command {history.get('outcome') or 'replaced'} this goal’s priority target."
            from .pokemon_sessions import static_availability
            if not shiny and (static_availability(live, request['speciesId']) or {}).get('owned') is True:
                return 'done', 'caught', f'Caught and saved {what}.'
            first = state.setdefault('usedSeenAt', self.clock())
            if self.clock() - first < USED_GRACE_SECONDS:
                return 'running', 'saving', f'Confirming the saved {name} capture.'
            return 'failed', 'failed', f'{name}’s encounter was used, but no verified {what} was saved for this goal.'
        return None

    def _run_player_task(self, goal, index, step, state, live):
        game, action = goal['game'], step['action']
        if action != 'start':
            self.sessions.player_task(game, action, step.get('task'))
            state.update(started=True, startedAt=now_iso())
            return 'done', action, {'ready': 'The bot is ready for commands.', 'resume': 'Resumed the bot.', 'stop': 'Stopped the bot.',
                                    'stop-game': 'Closed the game.', 'new-save': 'Started a new save; the previous save was backed up.',
                                    'restore-save': 'Restored the saved profile.'}[action]
        kind = step['task']['kind']
        if not state.get('taskId'):
            session = self.sessions.player_task(game, 'start', step['task'])
            task_id = ((session.get('bot') or {}).get('preparation') or {}).get('requestId')
            if not isinstance(task_id, str) or not TASK_ID.fullmatch(task_id):
                raise ValueError('The game did not confirm the player task.')
            state.update(started=True, taskId=task_id, startedAt=now_iso())
            return 'running', 'task', f'Started the {kind} task.'
        if (self.sessions.directory/game/f"player-task-{state['taskId']}.json").is_file():
            state['result'] = {'taskId': state['taskId'], 'kind': kind}
            return 'done', 'task', f'The {kind} task finished.'
        bot = live.get('bot') or {}
        preparation = bot.get('preparation') or {}
        if not bot.get('enabled'):
            return 'waiting', 'paused', 'Stopped by you. Start the bot to continue this goal.'
        if preparation.get('requestId') == state['taskId']:
            return 'running', 'task', f"The {kind} task: {preparation.get('phase') or 'working'}."
        if bot.get('awaitingCommand'):
            first = state.setdefault('idleSeenAt', self.clock())
            if self.clock() - first >= USED_GRACE_SECONDS:
                return 'failed', 'failed', f'The {kind} task ended without its completion receipt.'
            return 'running', 'task', f'Confirming the {kind} task.'
        return 'waiting', 'yielded', 'Another task has control of FireRed. This goal continues when it finishes.'

    def _run_collection(self, goal, index, step, state, live):
        stages = step.get('collectionStages')
        if not stages:
            try:
                stages = self.sessions.bot_settings(goal['game'])['preferences'].get('collectionStages', 'base-forms')
            except (OSError, ValueError, KeyError):
                stages = 'base-forms'
        self.sessions.player_task(goal['game'], 'collection', {'collectionStages': stages, 'goal': step['goal']})
        state.update(started=True, startedAt=now_iso())
        return 'done', 'collection', 'The shiny collection is running' + (' toward the full National Pokédex.' if step['goal'] == 'national-dex' else '.')

    def _run_trade(self, goal, index, step, state, live):
        game, payload = goal['game'], step['payload']
        if not state.get('started'):
            if step['via'] == 'trade-shiny':
                session = self.sessions.trade_shiny(game, payload['shinyId'])
            else:
                if self.trading is None:
                    raise ValueError('Trading is not available in this Suite session.')
                session = self.trading.trade(game, payload['pokemonId'], live.get('sessionId'), payload.get('sourceId', 'current'))
            state.update(started=True, startedAt=now_iso(), fingerprint=(session.get('nativeTrade') or {}).get('fingerprint'))
            return 'running', 'trade', 'Waiting for the trade partner to connect.'
        trade = live.get('nativeTrade') or {}
        if state.get('fingerprint') and trade.get('fingerprint') not in (None, state['fingerprint']):
            return 'waiting', 'yielded', 'Another trade has control of FireRed.'
        phase = trade.get('phase')
        if phase == 'complete' and (trade.get('completion') or {}).get('nativeSaveVerified') is True:
            state['result'] = {'fingerprint': trade['fingerprint']} if isinstance(trade.get('fingerprint'), str) else {}
            return 'done', 'traded', 'Traded, and both games saved.'
        if phase == 'cancelled':
            return 'failed', 'failed', 'The trade was cancelled.'
        if not trade:
            return 'failed', 'failed', 'The trade ended without a verified exchange.'
        return 'running', 'trade', trade.get('reason') or f"Trading: {phase or 'waiting for the partner'}."

    def _run_status(self, goal, index, step, state, live):
        state.update(started=True, answer=self._answer(step['question'], live))
        state['result'] = {'answer': state['answer']}
        return 'done', 'answered', state['answer']

    def _answer(self, question, live):
        progress, mission = live.get('gameProgress') or {}, live.get('mission') or {}
        if question == 'team':
            party = ((live.get('observation') or {}).get('party')) or []
            return ('Team: ' + ', '.join(f"{species_name(p['species'])} Lv {p['level']}" for p in party if p.get('species'))) if party else 'The team is not visible right now.'
        if question == 'hunt':
            if not mission:
                return 'No hunt is active.'
            return f"{species_name(mission.get('speciesId'))} hunt: {mission.get('state')}, {mission.get('encounters', 0)} encounters, {mission.get('caught', 0)} caught."
        if question == 'location':
            where = live.get('map') or ((live.get('observation') or {}).get('map') or {}).get('id')
            return f"FireRed is at {str(where).removeprefix('MAP_').replace('_', ' ').title()}." if where else 'The location is not visible right now.'
        if question == 'progress':
            badges = (((live.get('campaign') or {}).get('storyProgress') or {}).get('badges') or {}).get('earned')
            parts = [f'{badges}/8 badges' if isinstance(badges, int) else None,
                     'Hall of Fame entered' if progress.get('leagueComplete') else None,
                     f"{progress['ownedSpecies']} species owned" if isinstance(progress.get('ownedSpecies'), int) else None]
            return ', '.join(p for p in parts if p) + '.' if any(parts) else 'Story progress is not visible right now.'
        if question == 'shinies':
            owned = [r for r in live.get('collection') or [] if r.get('owned') and r.get('nativeSaveVerified')]
            return f'{len(owned)} saved shiny Pokémon in this game.'
        open_goals = [g for g in self.store.list() if g['status'] in OPEN]
        return f'{len(open_goals)} open goal' + ('s.' if len(open_goals) != 1 else '.')

    # Completion and cancellation.
    def _finish(self, goal):
        ex = goal['execution']
        details = [s.get('detail') for s in ex['steps'] if s.get('detail')]
        summary = details[-1] if details else 'Goal complete.'
        goal.update(status='done', finishedAt=now_iso(), result={'summary': summary, 'step': len(ex['plan']) - 1})
        self._progress(goal, 'done', summary)
        self._commit(goal)
        standing = self._standing(goal)
        self.store.update(goal['id'], lambda stored: stored['execution'].__setitem__('standing', standing))

    def _standing(self, goal):
        """After a goal: resume the owner's standing goals, or wait for commands."""
        ex, game = goal['execution'], goal['game']
        last = ex['plan'][-1]
        result = {'action': None, 'at': now_iso()}
        if active_goal([g for g in self.store.list() if g['id'] != goal['id']]):
            return {**result, 'detail': 'The next goal takes control.'}
        if last['kind'] in ('collection', 'status') or last['kind'] == 'postgame' and not last.get('priorityTarget') or \
                last['kind'] == 'player-task' and last['action'] != 'start':
            return {**result, 'detail': 'The last step chose what the bot does next.'}
        live = self.sessions._live(game)
        if not live:
            return {**result, 'detail': 'FireRed is not running.'}
        bot = live.get('bot') or {}
        try:
            if goal['then'] == 'await-command':
                if bot.get('enabled') and not bot.get('awaitingCommand'):
                    self.sessions.player_task(game, 'stop')
                    self.sessions.player_task(game, 'ready')
                    return {**result, 'action': 'await-command', 'detail': 'Stopped the automatic continuation; the bot waits for commands.'}
                return {**result, 'detail': 'The bot waits for commands.'}
            if not bot.get('enabled'):
                return {**result, 'detail': 'Stopped by you; standing goals resume when you start the bot.'}
            if not bot.get('awaitingCommand'):
                return {**result, 'detail': 'The bot already continues its standing goals.'}
            collection = (ex.get('before') or {}).get('collection')
            if collection:
                try:
                    stages = self.sessions.bot_settings(game)['preferences'].get('collectionStages', 'base-forms')
                except (OSError, ValueError, KeyError):
                    stages = 'base-forms'
                self.sessions.player_task(game, 'collection', {'collectionStages': stages, 'goal': collection})
                return {**result, 'action': 'collection', 'detail': 'Resumed the shiny collection.'}
            if (live.get('gameProgress') or {}).get('leagueComplete') is True:
                self.sessions.player_task(game, 'postgame', None)
                return {**result, 'action': 'postgame', 'detail': 'Resumed the postgame checklist.'}
            return {**result, 'detail': 'No standing goal applies before the Hall of Fame; the bot waits for commands.'}
        except (ValueError, OSError) as error:
            return {**result, 'error': str(error), 'detail': f'Standing goals did not resume: {error}'}

    def _withdraw(self, goal):
        """A cancelled goal withdraws only what it started and still owns."""
        ex, game, effects, status = goal['execution'], goal['game'], [], 'done'
        live = self.sessions._live(game)
        try:
            for step, state in zip(ex.get('plan') or [], ex.get('steps') or []):
                rid = state.get('requestId')
                if not live or not rid or state.get('status') == 'done':
                    continue
                if ((live.get('postgame') or {}).get('priorityTarget') or {}).get('requestId') == rid:
                    self.sessions.player_task(game, 'postgame', {'priorityTarget': None})
                    effects.append('Cleared the postgame priority target; the checklist continues.')
                    live = self.sessions._live(game) or live
                ids, mission, pending = {rid, rid + '-source'}, live.get('mission') or {}, live.get('pendingHunt') or {}
                if mission.get('id') in ids and mission.get('state') == 'running' or pending.get('id') in ids:
                    self.farming.stop(rid)
                    effects.append('Stopped the goal’s hunt; the save and hunt anchor are preserved.')
        except (ValueError, OSError) as error:
            status = 'failed'
            effects.append(str(error))

        def apply(stored):
            stored['execution']['withdraw'] = {'status': status, 'effects': effects, 'at': now_iso()}
        self.store.update(goal['id'], apply)
