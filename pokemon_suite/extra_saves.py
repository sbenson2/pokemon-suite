"""Extra saves: other owned FireRed saves supply the main save's one-per-save families.

The engine plans (extra-saves.js) and trades (extra-save-exchange.js). The host
only publishes what each owned FireRed save holds, seeds a partner owner from an
archived save when the owner asks, and reports progress. It never loads a save
into a live game and never changes an archived profile."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from .suite_save_store import atomic_file

SOURCES_SCHEMA = 'pokemon-suite/extra-save-sources/v1'
PROFILE = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z')
OWNER = re.compile(r'[a-z0-9][a-z0-9-]{0,39}\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class ExtraSaves:
    def __init__(self, sessions, profile_runner=None):
        self.sessions = sessions
        self.profile_runner = profile_runner or self._run_profile_cli

    @property
    def directory(self):
        return Path(self.sessions.directory)

    # ---- archived profiles -------------------------------------------------
    def _profile_records(self):
        folder = self.directory/'firered'/'save-profiles'
        records = {}
        for path in sorted(folder.glob('*.json')) if folder.is_dir() else []:
            if not PROFILE.fullmatch(path.stem):
                continue
            try:
                record = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            source = record.get('source') or {}
            if record.get('id') == path.stem and SHA.fullmatch(source.get('sramSha256') or ''):
                records[path.stem] = record
        return records

    def _run_profile_cli(self, requests):
        config_path = self.sessions.execution_config_path('firered')
        config = json.loads(Path(config_path).read_text())
        script = Path(config['worker']).parent/'extra-save-inventory-cli.js'
        result = subprocess.run([config['node'], str(script), str(config_path)], input=json.dumps({'profiles': requests}),
                                capture_output=True, text=True, timeout=600)
        if result.returncode:
            raise ValueError(result.stderr.strip()[-1200:] or 'The archived FireRed saves could not be read.')
        return json.loads(result.stdout)['profiles']

    def profile_inventories(self):
        """Inventories of archived FireRed profiles, decoded once per native save."""
        path = self.directory/'firered'/'extra-save-profiles.json'
        try:
            cache = json.loads(path.read_text())
        except (OSError, ValueError):
            cache = {}
        records = self._profile_records()
        missing = [{'profileId': pid, 'label': r.get('label')} for pid, r in records.items()
                   if (cache.get(pid) or {}).get('sramSha256') != r['source']['sramSha256']]
        # A failed decode (for example an engine package without the CLI) waits ten minutes before retrying.
        if missing and time.time() >= getattr(self, '_retry_profiles_at', 0):
            try:
                decoded = self.profile_runner(missing)
            except (OSError, ValueError, subprocess.SubprocessError):
                self._retry_profiles_at = time.time() + 600
                raise
            for entry in decoded:
                pid = entry.get('profileId')
                if pid in records:
                    cache[pid] = {'sramSha256': records[pid]['source']['sramSha256'], 'inventory': entry.get('inventory'), 'reason': entry.get('reason')}
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic_file(path, json.dumps(cache).encode())
        return {pid: entry for pid, entry in cache.items() if pid in records}

    # ---- sources ------------------------------------------------------------
    def _seeded(self):
        return {pid: owner for owner, cfg in self.sessions.config().get('games', {}).items()
                if (pid := ((cfg or {}).get('extraSaveSource') or {}).get('profileId'))}

    def sources(self):
        """Every other owned FireRed save the main save could trade with."""
        live, lineages = [], set()
        for owner, title in self.sessions.partner_owners():
            if title != 'firered':
                continue
            status = self.sessions._live(owner) or {}
            inventory = status.get('extraSaveInventory')
            if isinstance(inventory, dict) and inventory.get('schema') == 'pokemon-suite/extra-save-inventory/v1':
                live.append({**inventory, 'source': {**inventory.get('source', {}), 'kind': 'partner-owner', 'owner': owner}})
                lineages.add(inventory.get('lineage'))
        seeded = self._seeded()
        # build 126: an archive its helper is still preparing stays in the plan once, naming that helper;
        # a partner seeded from it replaces it.
        games = self.sessions.config().get('games', {})
        preparing = {pid: owner for pid, owner in seeded.items() if (games.get(owner) or {}).get('role') == 'helper'}
        profiles = [{**entry['inventory'], 'source': {**entry['inventory'].get('source', {}), 'helperOwner': preparing[pid]}} if pid in preparing else entry['inventory']
                    for pid, entry in sorted(self.profile_inventories().items())
                    if entry.get('inventory') and (pid not in seeded or pid in preparing) and entry['inventory'].get('lineage') not in lineages]
        return {'schema': SOURCES_SCHEMA, 'sources': live+profiles, 'helpers': [],
                'unreadable': sorted(pid for pid, entry in self.profile_inventories().items() if not entry.get('inventory'))}

    def publish(self):
        """Write firered/extra-save-sources.json only when its content changes."""
        doc = self.sources()
        path = self.directory/'firered'/'extra-save-sources.json'
        try:
            previous = json.loads(path.read_text())
        except (OSError, ValueError):
            previous = None
        if previous and {k: v for k, v in previous.items() if k != 'checkedAt'} == doc:
            return previous
        doc = {**doc, 'checkedAt': int(time.time()*1000)}
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_file(path, json.dumps(doc).encode())
        return doc

    # ---- a partner owner seeded from an archived save ------------------------
    def seed_partner(self, profile_id, lineage=None, owner=None, grants=()):
        """Configure a FireRed partner owner whose first start imports a read-only
        copy of an archived profile's native save. The archive is never written,
        and one save lineage never gets a second working copy."""
        if not isinstance(profile_id, str) or not PROFILE.fullmatch(profile_id):
            raise ValueError('Choose an archived FireRed save profile.')
        record = self._profile_records().get(profile_id)
        if not record:
            raise ValueError('Choose an archived FireRed save profile.')
        return self._seed(record, {'profileId': profile_id, 'lineage': lineage}, lineage, owner, grants)

    def _seed(self, record, origin, lineage, owner, grants, role='partner', extra=None, prefix='firered-partner'):
        with self.sessions.lock:
            config = json.loads((self.directory/'config.json').read_text())
            games = config.get('games', {})
            for key, cfg in games.items():
                source = (cfg or {}).get('extraSaveSource') or {}
                if origin.get('helperOwner') == key:
                    continue  # the helper this partner is seeded from
                if any(origin.get(k) and source.get(k) == origin[k] for k in ('profileId', 'helperOwner')) or lineage and source.get('lineage') == lineage:
                    raise ValueError(f'This save already serves as the partner owner {key}.')
            for key, _ in self.sessions.partner_owners():
                if lineage and ((self.sessions._live(key) or {}).get('extraSaveInventory') or {}).get('lineage') == lineage:
                    raise ValueError(f'This save lineage is already served by {key}.')
            base = games.get('firered') or {}
            if not base.get('nativeRadio'):
                raise ValueError('FireRed needs its native link cartridge and core before another save can trade with it.')
            if owner is None:
                n = 2 if prefix == 'firered-partner' else 1
                while f'{prefix}-{n}' in games:
                    n += 1
                owner = f'{prefix}-{n}'
            if not OWNER.fullmatch(owner) or owner in games or owner == 'firered':
                raise ValueError('Choose a new partner owner name.')
            source = record['source']
            seed = self.directory/'extra-saves'/'seeds'/source['sramSha256']
            seed.mkdir(parents=True, exist_ok=True, mode=0o700)
            copied = {}
            for name, digest in ((source['statePath'], source['stateSha256']), (source['sramPath'], source['sramSha256'])):
                src, dst = Path(record['directory'])/name, seed/name
                if _sha(src) != digest:
                    raise ValueError('The archived save failed verification.')
                if not dst.exists():
                    shutil.copyfile(src, dst)
                    os.chmod(dst, 0o444)
                if _sha(dst) != digest:
                    raise ValueError('The partner seed copy failed verification.')
                copied[name] = str(dst)
            ports = {g.get('port') for g in games.values() if isinstance(g, dict)}
            port = max(p for p in ports if isinstance(p, int)) + 1 if any(isinstance(p, int) for p in ports) else 17350
            while port in ports:
                port += 1
            games[owner] = {'title': 'firered', 'role': role, 'label': record.get('label') or 'Archived FireRed save', 'port': port, **(extra or {}),
                            **self._owner_copy(base),
                            'seed': {'stateFilePath': copied[source['statePath']], 'sramFilePath': copied[source['sramPath']],
                                     'stateSha256': source['stateSha256'], 'sramSha256': source['sramSha256'], 'frame': (source.get('metadata') or {}).get('frame', 0)},
                            'extraSaveSource': origin,
                            **({'extraSaveGrants': [g for g in grants if isinstance(g, str) and g.startswith('[')]} if grants else {})}
            backup = self.directory/'extra-saves'/f'config.before-{owner}.json'
            if not backup.exists():
                atomic_file(backup, (self.directory/'config.json').read_bytes())
            atomic_file(self.directory/'config.json', json.dumps(config, indent=1).encode())
        return owner

    # ---- helper saves: a new FireRed save played only to its goal -------------
    @staticmethod
    def _owner_copy(base):
        """The main owner's game inputs for another owner. The native link pair is
        copied without the main owner's hunt selection (huntId)."""
        entry = {k: json.loads(json.dumps(base[k])) for k in ('release', 'cartridge', 'core', 'inputs', 'nativeRadio') if k in base}
        if isinstance(entry.get('nativeRadio'), dict):
            entry['nativeRadio'].pop('huntId', None)
        return entry

    @staticmethod
    def _booted_identity(cfg):
        """The cartridge and core a helper or partner worker boots: its native link pair when configured
        (session-worker.js ownerNativePair), else the stock cartridge."""
        native = cfg.get('nativeRadio') or {}
        pair = native if (native.get('cartridge') or {}).get('sha1') and native.get('core') else {'cartridge': cfg.get('cartridge') or {}, 'core': cfg.get('core')}
        try:
            core = json.loads((Path(pair['core'])/'build-manifest.json').read_text()).get('mgba_wasm_sha256')
        except (OSError, ValueError, TypeError):
            core = None
        return pair['cartridge'].get('sha1'), core

    def _retire_foreign_blank_save(self, owner, cfg):
        """A helper started before build 126 booted the stock cartridge. Its never-played blank
        save is set aside (kept on disk) so the helper boots a new one on its link pair; a save
        with any progress on another cartridge or core stays for review."""
        folder = self.directory/owner/'saves'
        try:
            record = json.loads((folder/'current.json').read_text())
        except (OSError, ValueError):
            return None
        rom, core = self._booted_identity(cfg)
        identity = record.get('identity') or {}
        if identity.get('romSha1') == rom and (core is None or identity.get('coreSha256') == core):
            return None
        metadata = record.get('metadata') or {}
        pristine = metadata.get('newProfile') is True and not metadata.get('campaign') and not metadata.get('session') and not (self.directory/owner/'active-hunt.json').exists()
        if not pristine or self.sessions._live(owner):
            raise ValueError('This helper save holds progress made on another cartridge or core. It is preserved for review.')
        retired = self.directory/owner/f"saves.retired-{str(identity.get('romSha1') or 'unknown')[:8]}-{int(time.time())}"
        folder.rename(retired)
        return retired

    def helper_saves(self):
        """The helper saves the main save's plan asks for, from its status rows."""
        helpers = {}
        for row in (self.sessions._live('firered') or {}).get('extraSaves') or []:
            helper = row.get('helper') or {}
            if helper.get('saveId'):
                entry = helpers.setdefault(helper['saveId'], {'saveId': helper['saveId'], 'label': row.get('save'), 'settings': helper.get('settings') or {}, 'goals': []})
                entry['goals'].append({'needId': row.get('needId'), 'goal': helper.get('goal'), 'runtime': row.get('runtime')})
        return list(helpers.values())

    def _helper_owner(self, save_id):
        for key, cfg in self.sessions.config().get('games', {}).items():
            if (cfg or {}).get('role') == 'helper' and ((cfg or {}).get('extraSaveHelper') or {}).get('saveId') == save_id:
                return key
        return None

    def _run_campaign_cli(self, owner, settings):
        config_path = self.sessions.execution_config_path(owner)
        config = json.loads(Path(config_path).read_text())
        script = Path(config['worker']).parent/'campaign-config-cli.js'
        # The preview binds the cartridge this owner's worker boots (build 126: a helper's native link pair).
        result = subprocess.run([config['node'], str(script), str(config_path)], input=json.dumps({'game': 'firered', 'action': 'preview', 'settings': settings, 'owner': owner}),
                                capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise ValueError(result.stderr.strip()[-1200:] or 'The helper campaign could not be verified.')
        return json.loads(result.stdout)

    def start_helper(self, save_id=None, campaign_runner=None, need_id=None):
        """Start a new FireRed save that plays the story only until its goal (a
        starter, or a revived Mt. Moon fossil) is saved in a linked Pokémon Center.
        need_id (build 126): a row's helper task on an archived save instead."""
        if need_id is not None:
            row = next((r for r in (self.sessions._live('firered') or {}).get('extraSaves') or [] if isinstance(r, dict) and r.get('needId') == need_id), None)
            if not row or (row.get('start') or {}).get('action') != 'start-helper' or not (row.get('task') or {}).get('profileId'):
                raise ValueError('Choose a helper task from the extra-save plan.')
            return self.seed_or_park(row['task']['profileId'], lineage=row['task'].get('lineage'))
        helper = next((h for h in self.helper_saves() if h['saveId'] == save_id), None)
        if not helper:
            raise ValueError('Choose a helper save from the extra-save plan.')
        goal = next((g['goal'] for g in helper['goals'] if (g.get('goal') or {}).get('kind') in ('starter', 'fossil')), None)
        if not goal:
            raise ValueError('This helper save only has long postgame stages; they are planned, not started automatically.')
        with self.sessions.lock:
            config = json.loads((self.directory/'config.json').read_text())
            games = config['games']
            owner = self._helper_owner(save_id)
            if owner is None:
                n = 1
                while f'firered-helper-{n}' in games:
                    n += 1
                owner = f'firered-helper-{n}'
                base = games.get('firered') or {}
                ports = {g.get('port') for g in games.values() if isinstance(g, dict)}
                port = max(p for p in ports if isinstance(p, int)) + 1 if any(isinstance(p, int) for p in ports) else 17360
                games[owner] = {'title': 'firered', 'role': 'helper', 'label': helper['label'] or save_id, 'port': port,
                                **self._owner_copy(base),
                                'extraSaveHelper': {'saveId': save_id, 'goal': goal}}
                backup = self.directory/'extra-saves'/f'config.before-{owner}.json'
                backup.parent.mkdir(parents=True, exist_ok=True)
                if not backup.exists():
                    atomic_file(backup, (self.directory/'config.json').read_bytes())
                atomic_file(self.directory/'config.json', json.dumps(config, indent=1).encode())
            elif 'huntId' in (games[owner].get('nativeRadio') or {}):
                games[owner]['nativeRadio'].pop('huntId')  # a 125 helper copied the main owner's hunt id
                atomic_file(self.directory/'config.json', json.dumps(config, indent=1).encode())
            self._retire_foreign_blank_save(owner, games[owner])
        settings = {'label': (helper['label'] or 'Helper FireRed save')[:50], 'starter': helper['settings'].get('starter', 'random'), 'afterCampaign': 'wait', 'helperGoal': goal,
                    **({'fossil': helper['settings']['fossil']} if helper['settings'].get('fossil') else {})}
        live = self.sessions.ensure(owner)
        preview = (campaign_runner or self._run_campaign_cli)(owner, settings)
        run_id = preview['record']['id']
        folder = self.directory/owner/'run-previews'
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        atomic_file(folder/f'{run_id}.json', json.dumps({**preview, 'sessionId': live.get('sessionId')}).encode())
        self.sessions.command(owner, {'type': 'start-campaign', 'previewId': run_id}, session_id=live.get('sessionId'))
        return {'owner': owner, 'previewId': run_id, 'goal': goal}

    # ---- an archived save's helper run (build 126) ---------------------------
    # One helper per archived lineage: it runs the tasks the main save's plan gives
    # that save (the Fighting Dojo prize, then its roaming dog), parks in a Pokémon
    # Center with a Direct Corner, and finish_helpers seeds the lineage's one
    # partner from that save, granted exactly the individuals the tasks obtained.
    TASK_CENTER = 'MAP_CELADON_CITY_POKEMON_CENTER_1F'

    def _lineage_rows(self, profile_id):
        return [r for r in (self.sessions._live('firered') or {}).get('extraSaves') or []
                if isinstance(r, dict) and (r.get('source') or {}).get('profileId') == profile_id]

    def _archive_tasks(self, profile_id):
        """The helper tasks the plan gives this archived save: the short Dojo prize before the long roamer."""
        tasks = []
        for row in self._lineage_rows(profile_id):
            task = row.get('task') or {}
            hunt = task.get('hunt') or {}
            if task.get('profileId') == profile_id and task.get('kind') in ('dojo-prize', 'roamer-capture') and isinstance(hunt.get('id'), str) and isinstance(task.get('speciesId'), int):
                tasks.append({'needId': row.get('needId'), 'kind': task['kind'], 'speciesId': task['speciesId'], 'hunt': hunt})
        return sorted(tasks, key=lambda t: t['kind'] != 'dojo-prize')

    def _profile_helper(self, profile_id):
        for key, cfg in self.sessions.config().get('games', {}).items():
            if (cfg or {}).get('role') == 'helper' and ((cfg or {}).get('extraSaveHelper') or {}).get('profileId') == profile_id:
                return key
        return None

    def seed_or_park(self, profile_id, lineage=None):
        """The owner's action for an archived save. A save already parked in a linked
        Center with no planned task becomes a partner directly; otherwise a helper first
        runs its tasks and parks, and finish_helpers then seeds the partner."""
        if not isinstance(profile_id, str) or not PROFILE.fullmatch(profile_id):
            raise ValueError('Choose an archived FireRed save profile.')
        record = self._profile_records().get(profile_id)
        if not record:
            raise ValueError('Choose an archived FireRed save profile.')
        games = self.sessions.config().get('games', {})
        partner = next((k for k, c in games.items() if (c or {}).get('role') == 'partner' and ((c or {}).get('extraSaveSource') or {}).get('profileId') == profile_id), None)
        if partner:
            raise ValueError(f'This save already serves as the partner owner {partner}.')
        if self._profile_helper(profile_id):
            return self._resume_archive_helper(self._profile_helper(profile_id))
        try:
            entry = (self.profile_inventories().get(profile_id) or {}).get('inventory')
        except (OSError, ValueError, AttributeError, subprocess.SubprocessError):
            entry = None
        tasks = self._archive_tasks(profile_id)
        # An unknown inventory keeps the earlier direct seeding.
        if not tasks and (entry is None or entry.get('parked') is True):
            return {'owner': self.seed_partner(profile_id, lineage=lineage), 'role': 'partner'}
        center = self.TASK_CENTER if tasks else self.park_center((entry or {}).get('map'))
        helper = {'saveId': f'park-{profile_id}', 'park': True, 'center': center, 'profileId': profile_id, **({'tasks': tasks} if tasks else {})}
        owner = self._seed(record, {'profileId': profile_id, 'lineage': lineage}, lineage, None, (), role='helper', extra={'extraSaveHelper': helper}, prefix='firered-helper')
        return self._resume_archive_helper(owner)

    def _resume_archive_helper(self, owner):
        cfg = self.sessions.config()['games'][owner]
        helper = cfg.get('extraSaveHelper') or {}
        live = self.sessions.ensure(owner)
        self._advance(owner, cfg, live, retry=True)  # the owner's explicit start
        return {'owner': owner, 'role': 'helper', 'center': helper.get('center'), 'tasks': [t['hunt']['id'] for t in helper.get('tasks') or []]}

    def _task_done(self, owner, hunt_id, mission):
        if mission.get('id') == hunt_id and mission.get('state') == 'complete':
            return True
        try:
            archived = json.loads((self.directory/owner/f'archived-{hunt_id}.json').read_text())
        except (OSError, ValueError):
            return False
        return (archived.get('mission') or {}).get('status') == 'complete'

    def _advance(self, owner, cfg, live, retry=False):
        """Start a parking helper's next step: its next task's hunt, then its park task.
        A task that stopped for review is left for the owner (retry: the owner's own
        start is a reviewed retry); the coordinator never restarts it."""
        helper = cfg.get('extraSaveHelper') or {}
        if not helper.get('park') or not live or not helper.get('profileId'):
            return None
        park_id = f"park-{helper['profileId'][:8]}"
        if (self.directory/owner/f'player-task-{park_id}.json').exists():
            return None
        mission = live.get('mission') or {}
        for task in helper.get('tasks') or []:
            if self._task_done(owner, task['hunt']['id'], mission):
                continue
            if mission.get('id') == task['hunt']['id']:
                if retry and mission.get('state') in ('blocked', 'paused'):
                    return self.sessions.command(owner, {'type': 'start', 'record': task['hunt'], 'runScope': 'task', 'retryBlockedPolicy': True}, session_id=live.get('sessionId'))
                return None  # running, or stopped for the owner's review
            return self.sessions.command(owner, {'type': 'start', 'record': task['hunt'], 'runScope': 'task'}, session_id=live.get('sessionId'))
        if ((live.get('bot') or {}).get('preparation') or {}).get('requestId') == park_id:
            return None  # the park task is running
        tasks = helper.get('tasks') or []
        if tasks:
            keep = [fp for row in self._lineage_rows(helper['profileId']) if not row.get('task')
                    for fp in [(row.get('subject') or {}).get('fingerprint')] if isinstance(fp, str) and fp.startswith('[')]
            request = {'id': park_id, 'kind': 'park', 'map': helper['center'], 'goals': [{'speciesId': t['speciesId']} for t in tasks], **({'keep': keep[:4]} if keep else {})}
        else:
            request = {'id': park_id, 'kind': 'travel', 'map': helper['center']}
        return self.sessions.command(owner, {'type': 'player-task', 'request': request}, session_id=live.get('sessionId'))

    def advance_helpers(self):
        """Coordinator tick: each parking helper's next step (errors wait for the next tick)."""
        for owner, cfg in self.sessions.config().get('games', {}).items():
            if (cfg or {}).get('role') != 'helper' or not ((cfg or {}).get('extraSaveHelper') or {}).get('park'):
                continue
            try:
                self._advance(owner, cfg, self.sessions._live(owner))
            except ValueError:
                continue

    # ---- parking an archived save in a linked Pokémon Center ------------------
    PARK_CENTERS = (('MAP_PALLET_TOWN', 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F'), ('MAP_ROUTE1', 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F'),
                    ('MAP_VIRIDIAN', 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F'), ('MAP_ROUTE22', 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F'))

    @classmethod
    def park_center(cls, map_id):
        """The nearby Pokémon Center (with a Direct Corner upstairs) an archived save walks to."""
        for prefix, center in cls.PARK_CENTERS:
            if (map_id or '').startswith(prefix):
                return center
        return 'MAP_CELADON_CITY_POKEMON_CENTER_1F'

    def park_profile(self, profile_id, lineage=None):
        """An archived save not saved in a linked Pokémon Center first walks to one
        and saves there, in a helper owner seeded from a read-only copy. The
        helper then becomes the lineage's one partner owner (finish_helpers)."""
        if not isinstance(profile_id, str) or not PROFILE.fullmatch(profile_id):
            raise ValueError('Choose an archived FireRed save profile.')
        record = self._profile_records().get(profile_id)
        entry = self.profile_inventories().get(profile_id) or {}
        if not record or not entry.get('inventory'):
            raise ValueError('Choose an archived FireRed save with a continuable native save.')
        center = self.park_center(entry['inventory'].get('map'))
        owner = self._helper_owner(f'park-{profile_id}')
        if owner is None:
            owner = self._seed(record, {'profileId': profile_id, 'lineage': lineage}, lineage, None, (), role='helper',
                               extra={'extraSaveHelper': {'saveId': f'park-{profile_id}', 'park': True, 'center': center, 'profileId': profile_id}}, prefix='firered-helper')
        live = self.sessions.ensure(owner)
        request = {'id': f'park-{profile_id[:8]}', 'kind': 'travel', 'map': center}
        self.sessions.command(owner, {'type': 'player-task', 'request': request}, session_id=live.get('sessionId'))
        return {'owner': owner, 'center': center}

    def finish_helpers(self):
        """A helper whose goal receipt matches its native save becomes a partner
        owner seeded from that save, granted to give away only its goal individual."""
        seeded = []
        for owner, cfg in self.sessions.config().get('games', {}).items():
            if (cfg or {}).get('role') != 'helper':
                continue
            live = self.sessions._live(owner) or {}
            helper = cfg.get('extraSaveHelper') or {}
            if helper.get('park'):
                # A parked archived save: its travel task (or, after helper tasks, its park
                # task with the obtained individuals) saved it in the Center.
                try:
                    receipt = json.loads((self.directory/owner/f"player-task-park-{helper['profileId'][:8]}.json").read_text())
                except (OSError, ValueError, KeyError):
                    continue
                if receipt.get('nativeSaveVerified') is not True or (receipt.get('request') or {}).get('map') != helper.get('center'):
                    continue
                grants = [g for g in receipt.get('grants') or [] if isinstance(g, str) and g.startswith('[')] if helper.get('tasks') else []
                receipt = {'savedSramSha256': receipt.get('savedSramSha256'), 'lineage': (cfg.get('extraSaveSource') or {}).get('lineage'), 'grants': grants}
            else:
                receipt = ((live.get('campaign') or {}).get('completion') or {}).get('helperGoal')
            if not receipt or not SHA.fullmatch(receipt.get('savedSramSha256') or ''):
                continue
            if any(((c or {}).get('extraSaveSource') or {}).get('helperOwner') == owner for c in self.sessions.config()['games'].values()):
                continue
            active_path = self.directory/owner/'active-hunt.json'
            if helper.get('park') and not active_path.exists():
                folder = self.directory/owner/'saves'
            else:
                # A helper's hunts (and its story campaign) continue the save in its active hunt folder.
                active = json.loads(active_path.read_text())
                folder = self.directory/owner/'hunts'/active['id']/('native-radio' if active.get('nativeRadio') else '')/'saves'
            record = json.loads((folder/'current.json').read_text())
            if record.get('sramSha256') != receipt['savedSramSha256']:
                continue  # the goal save is not the helper's current native save yet
            seeded.append(self._seed({'label': cfg.get('label'), 'directory': str(folder), 'source': record},
                                     {'helperOwner': owner, 'saveId': helper.get('saveId'), 'lineage': receipt.get('lineage'), **({'profileId': helper['profileId']} if helper.get('profileId') else {})},
                                     receipt.get('lineage'), None, receipt.get('grants') or ()))
        return seeded

    # ---- progress --------------------------------------------------------------
    def progress(self):
        main = self.sessions._live('firered') or {}
        partners = []
        for owner, title in self.sessions.partner_owners():
            if title != 'firered':
                continue
            ledger = (self.sessions._live(owner) or {}).get('extraSaveLedger') or {}
            partners.append({'owner': owner, 'lending': (ledger.get('open') or {}).get('exchangeId'), 'grants': ledger.get('grants', 0)})
        rows = [dict(row, eta='unknown') for row in main.get('extraSaves') or [] if isinstance(row, dict)]
        return {'schema': 'pokemon-suite/extra-save-progress/v1', 'rows': rows, 'partners': partners}


def annotate_bank(trading, result):
    """Name the extra-save route in the Bank's route text for families that need another FireRed save."""
    try:
        rows = ((trading.sessions._live('firered') or {}).get('extraSaves')) or []
    except (OSError, ValueError, AttributeError):
        return result
    by_species = {}
    for row in rows:
        for species in row.get('species') or []:
            by_species.setdefault(species, row)
    def annotate(species_id, route):
        row = by_species.get(species_id)
        if not row or not isinstance(route, dict):
            return
        route['detail'] = f"{row.get('route')} {row.get('doing')} ETA unknown."
        route['extraSave'] = {'needId': row.get('needId'), 'save': row.get('save'), 'status': row.get('status'), 'doing': row.get('doing'), 'eta': 'unknown'}
    for entry in result.get('species') or []:
        annotate(entry.get('id'), entry.get('route'))
    if 'speciesId' in result:
        annotate(result['speciesId'], result.get('route'))
    return result
