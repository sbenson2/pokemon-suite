"""Owner-launched Suite sessions, independent of the selected video channel."""
from __future__ import annotations
import http.client
import copy
import json
import os
from .processes import assert_process_alive
from .trade_state import native_trade_finished
import re
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid

def hunt_capability(r):
    reason=None
    if r['game']=='firered':
        from .pokemon_hunt_routes import static_encounter,static_capability
        encounter=static_encounter(r['speciesId'])
        if encounter:return static_capability(r,encounter)
    if r['game']=='firered' and r['speciesId']==245:
        if r['quantity']!=1:reason='Each FireRed save releases one Suicune.'
        elif r['shiny']!='required':reason='The roaming executor currently prepares shiny Suicune.'
        elif r['locationId']!='any':reason='Suicune moves between Kanto routes. Choose any location.'
        elif not r['encounterLevel']['min']<=50<=r['encounterLevel']['max']:reason='The roaming Suicune is level 50.'
        elif r['moves'] or r['heldItemId'] is not None or r['finalLevel'] is not None:reason='Final moves, leveling and held items need a separate preparation task.'
        elif r['ball']['requirement']=='required' and r['ball']['id']!='any':reason='Roamer capture selects the best available ball for a verified first throw.'
        elif r.get('hiddenPower'):reason='FireRed’s roaming Suicune keeps only its HP IV and part of its Attack IV, so its Hidden Power can’t be chosen.'
        return {'supported':reason is None,'reason':reason,'setup':'current-game','method':'roamer','route':{'method':'roamer','speciesId':245,'nativeSpecies':245,'name':'Suicune','level':50,'map':'MAP_ONE_ISLAND_POKEMON_CENTER_1F'}}
    if r['game']=='firered' and r['speciesId']==133:
        if r['quantity']!=1:reason='The remaining Celadon Eevee gift provides one Pokémon. Additional Eevee require breeding or trading.'
        elif r['locationId'] not in {'any','10:763:18:'}:reason='Choose the Celadon Eevee gift.'
        elif r['moves'] or r['heldItemId'] is not None or r['finalLevel'] is not None:reason='Final evolution, moves, leveling and held items need a separate preparation task.'
        elif r['ball']['requirement']=='required' and r['ball']['id'] not in {'any','poke-ball'}:reason='The Eevee gift comes in a Poké Ball.'
        elif not r['encounterLevel']['min']<=25<=r['encounterLevel']['max']:reason='The FireRed Eevee gift is level 25.'
        return {'supported':reason is None,'reason':reason,'setup':'current-game','method':'gift','route':{'method':'gift','speciesId':133,'nativeSpecies':133,'name':'Eevee','map':'MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM','index':1,'flag':611,'level':25,'locationId':'10:763:18:','location':'Celadon City'}}
    if r['game']!='firered' or r['speciesId']!=143:
        from .pokemon_hunt_routes import wild_capability
        return wild_capability(r)
    elif r['quantity']!=1:reason='Set quantity to 1 for a remaining Snorlax encounter.'
    elif r['locationId'] not in {'any','10:276:21:','10:309:21:'}:reason='Choose Route 12 or Route 16.'
    elif r['moves'] or r['heldItemId'] is not None or r['finalLevel'] not in (None,30):reason='This executor saves Snorlax as caught at level 30. Final moves, leveling and held items need a separate preparation task.'
    elif r['ball']['id'] not in {'any','poke-ball','great-ball','ultra-ball'}:reason='This encounter supports Poké Balls, Great Balls and Ultra Balls.'
    elif not r['encounterLevel']['min']<=30<=r['encounterLevel']['max']:reason='FireRed Snorlax encounters are level 30.'
    return {'supported':reason is None,'reason':reason}

def static_availability(live,species_id):
    """The owner's gameProgress entry for this static species, or None if unknown."""
    statics=(live.get('gameProgress') or {}).get('statics')
    if not isinstance(statics,list):return None
    return next((s for s in statics if isinstance(s,dict) and s.get('speciesId')==species_id),None)

def priority_target(value):
    """Shape check for a postgame priority target; the engine validates support."""
    if value is None:return None
    if not isinstance(value,dict) or 'speciesId' not in value or not set(value)<={'speciesId','shiny','requestId','request'}:raise ValueError('Choose a static Pokémon as the postgame priority target.')
    if type(value['speciesId']) is not int:raise ValueError('The priority target needs a Pokédex number.')
    if 'shiny' in value and value['shiny'] not in ('any','required'):raise ValueError('Choose whether the priority target must be shiny.')
    if value.get('requestId') is not None and (not isinstance(value['requestId'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',value['requestId'])):raise ValueError('Invalid priority request identifier.')
    if value.get('request') is not None and (not isinstance(value['request'],dict) or value['request'].get('speciesId')!=value['speciesId']):raise ValueError('The priority request must be for the same Pokémon.')
    return value

def postgame_running(live):
    bot=live.get('bot') or {}
    return bool(bot.get('enabled')) and not bot.get('awaitingCommand') and bot.get('runScope')=='postgame'

class SuiteSessions:
    def __init__(self,directory:Path):
        self.directory=directory
        self.config_path=directory/'config.json'
        self.lock=threading.RLock()
        self._snapshot_lock=threading.Lock()
        self._last_snapshots={}
        self.runtime_overrides={}
        if os.environ.get('POKEMON_SUITE_DESKTOP_NODE'):
            from .desktop import runtime_overrides
            self.runtime_overrides=runtime_overrides(os.environ['POKEMON_SUITE_DESKTOP_NODE'])
            from .paths import ROOT
            from .packages import PackageStore
            capsule=ROOT/'bundled-engine.pksuite';receipt=ROOT/'bundled-engine.json'
            if capsule.is_file() and receipt.is_file():
                # Trust comes from the sealed, signed application resources.
                store=PackageStore(directory);installed=store.install(capsule,verified_sha256=json.loads(receipt.read_text())['sha256'],source='signed-app-bundle')
                for game in installed['games']:
                    if store.resolve(game) is None:store.activate(game,installed['digest'])

    def config(self):
        try:return {**json.loads(self.config_path.read_text()),**self.runtime_overrides}
        except FileNotFoundError:return {'games':{}}

    def execution_config_path(self,game=None):
        from .suite_save_store import atomic_file
        from .packages import PackageStore
        with self.lock:
            config=self.config()
            if game is not None:
                if game not in config['games']:raise ValueError('Choose a configured game.')
                selection=self.directory/game/'runtime-selection.json'
                selected=json.loads(selection.read_text()) if selection.exists() else None
                # A partner owner runs the same packages as its cartridge title.
                title=config['games'][game].get('title',game)
                package=PackageStore(self.directory).resolve(title,lock=selected.get('lock') if selected else None) if not selected or selected.get('lock') else None
                if package:
                    config.update({k:package[k] for k in ('worker','researchBots','campaignPlanner') if k in package})
                    config['runtimeLock']=package['lock']
                planner=PackageStore(self.directory).resolve(title,kind='planner',lock=(selected or {}).get('plannerLock')) if selected is None or selected.get('plannerLock') else None
                if planner:config.update(campaignPlanner=planner['campaignPlanner'],plannerLock=planner['lock'])
                from .runtime_components import apply_component
                component_locks=dict((selected or {}).get('componentLocks',{}))
                for kind in ('game','emulator'):
                    component=PackageStore(self.directory).resolve(title,kind=kind,lock=component_locks.get(kind)) if selected is None or component_locks.get(kind) else None
                    if component:apply_component(config,game,component);component_locks[kind]=component['lock']
                config['runtimeComponents']=component_locks
                if selected is None:
                    selection.parent.mkdir(parents=True,exist_ok=True)
                    atomic_file(selection,json.dumps({'lock':package['lock'] if package else None,'bundledWorker':config.get('worker'),'componentLocks':component_locks,'plannerLock':planner['lock'] if planner else None}).encode())
            if not self.runtime_overrides and game is None:return self.config_path
            folder=self.directory/'.app-runtime';folder.mkdir(exist_ok=True,mode=0o700)
            path=folder/((game or 'config')+'.json')
            atomic_file(path,json.dumps(config).encode())
            return path

    def configured(self,game):return game in self.config()['games']

    # The owner key names a save's directory, lock, port and status; the title
    # is its cartridge. A second FireRed save is a declared partner owner.
    def title(self,game):return (self.config()['games'].get(game) or {}).get('title',game)

    def is_partner(self,game):
        cfg=self.config()['games'].get(game) or {}
        return game!='firered' and cfg.get('role')=='partner' and cfg.get('title')=='firered'

    def partner_owners(self):
        """Configured trade-evolution partner owners, Emerald first: [(owner,title)]."""
        games=self.config().get('games',{})
        return ([('emerald','emerald')] if 'emerald' in games else [])+[(k,'firered') for k,c in games.items() if k!='firered' and c.get('role')=='partner' and c.get('title')=='firered']

    @staticmethod
    def _owner(live):return live.get('owner',live.get('game'))

    def capability(self,request):
        result=hunt_capability(request)
        if result['supported']:
            from .capabilities import require_feature
            method=result.get('method','static');feature={'wild-land':'capture.land','safari-land':'capture.safari','gift':'capture.gift'}.get(method,'capture.static')
            try:require_feature(request['game'],self.config()['games'].get(request['game']),feature,self._live(request['game']))
            except ValueError as error:return {'supported':False,'reason':str(error)}
        if result['supported'] and not self.configured(request['game']):return {'supported':False,'reason':'Install and configure this game’s ROM, emulator and current save first.'}
        if result['supported'] and result.get('method')=='gift':
            live=self._live(request['game']) or {}
            if live.get('gameProgress',{}).get('eeveeGiftAvailable') is False:return {'supported':False,'reason':'The Eevee gift has already been received in this game. Another Eevee requires a breeding or trade route.'}
        if request['game']=='firered' and result.get('method')=='static':
            # The owner's engine reports each one-time encounter and its story gates.
            availability=static_availability(self._live(request['game']) or {},request['speciesId'])
            if availability is not None:
                result={**result,'availability':availability}
                name=availability.get('name') or 'This Pokémon'
                if result['supported'] and availability.get('used') is True:
                    return {**result,'supported':False,'reason':f"{name} was already caught or defeated in this game; its one-time encounter is used. Another {name} needs a new save or a trade."}
                if result['supported'] and availability.get('missing'):
                    return {**result,'supported':False,'reason':f"{name} needs: {', '.join(availability['missing'])}. This save can play the story first."}
        if result['supported'] and result.get('setup')!='current-game':
            routes=['map_route16'] if request['locationId']=='10:309:21:' else ['map_route12'] if request['locationId']=='10:276:21:' else ['map_route12','map_route16']
            if not any((self.directory/'prepared'/request['game']/route/'current.json').is_file() for route in routes):return {'supported':False,'reason':'This Pokémon needs a prepared encounter setup. Preparation is done once before a hunt can be launched.'}
        return result

    def acquisition_readiness(self,route):
        live={};result=[]
        for requirement in route['prerequisites']:
            game=requirement['game']
            if game not in live:live[game]=self._live(game) or {}
            progress=live[game].get('gameProgress') or {};value=progress.get(requirement['key'])
            state='ready' if value is True else 'pending' if value is False else 'unknown'
            message=requirement['label']+(' — complete.' if state=='ready' else ' — not completed in the current game.' if state=='pending' else ' — current game progress needs verification.')
            if game=='emerald' and requirement['key']=='leagueComplete' and isinstance(progress.get('badges'),int):message+=f" Emerald currently has {progress['badges']}/8 badges."
            result.append({**requirement,'state':state,'message':message,'frame':progress.get('frame')})
        return result

    def _live(self,game):
        cfg=self.config()['games'].get(game)
        if not cfg:return None
        connection=http.client.HTTPConnection('127.0.0.1',cfg['port'],timeout=.5)
        try:
            connection.request('GET','/status');response=connection.getresponse()
            # Campaign checkpoints, team details and battle evidence routinely
            # exceed 256 KiB. Reject oversized documents explicitly, never parse
            # a silently truncated JSON prefix as if the owner had stopped.
            limit=4*1024*1024
            raw=response.read(limit+1)
            if len(raw)>limit:return None
            value=json.loads(raw)
            return value if response.status==200 and isinstance(value,dict) else None
        except (OSError,ValueError,http.client.HTTPException):return None
        finally:connection.close()

    def _owner_pid(self,game):
        try:
            owner=json.loads((self.directory/game/'owner.lock').read_text())
            if owner.get('game',game)!=game:return None
            pid=owner['pid'];assert_process_alive(pid)
            return pid
        except (OSError,ValueError,KeyError,TypeError):return None

    def _display_snapshot(self,game):
        # Presentation only. Commands and update handoffs always use _live()
        # and must never accept this cached telemetry as authorization.
        with self._snapshot_lock:
            before=self._owner_pid(game)
            live=self._live(game)
            owner=self._owner_pid(game)
            if live and live.get('schema')=='pokemon-suite/session/v1' and self._owner(live)==game:
                observed=time.time()
                if before==owner and owner is not None and live.get('pid',owner)==owner:
                    self._last_snapshots[game]=(owner,copy.deepcopy(live),observed)
                else:self._last_snapshots.pop(game,None)
                return {**live,'connection':{'state':'connected','lastSeenAt':observed}}
            previous=self._last_snapshots.get(game)
            if owner is None:
                self._last_snapshots.pop(game,None)
                return None
            if previous and previous[0]==owner:
                _,cached,observed=previous
                if cached.get('state') in {'closed','offline'}:return copy.deepcopy(cached)
                return {**copy.deepcopy(cached),'state':'reconnecting',
                    'connection':{'state':'reconnecting','lastSeenAt':observed,'lastState':cached.get('state')}}
            self._last_snapshots.pop(game,None)
            return {'game':game,'state':'reconnecting','connection':{'state':'reconnecting'}}

    def ensure(self,game,*,manual=False,update_hold=False):
        with self.lock:
            config=self.config();cfg=config['games'].get(game)
            if not cfg:raise ValueError('This game has no configured ROM and current save.')
            if cfg.get('backend')=='desktop' and sys.platform!='darwin':raise ValueError('This desktop emulator requires a qualified capture and input adapter for this operating system. The current adapter supports macOS.')
            live=self._live(game)
            if cfg.get('backend')=='desktop' and live and live.get('state')=='closed':
                # The closed receipt is served briefly before the owner releases
                # its port and save lock. Wait for that handoff before relaunching.
                deadline=time.monotonic()+3
                while live and live.get('state')=='closed' and time.monotonic()<deadline:
                    time.sleep(.1);live=self._live(game)
                if live and live.get('state')=='closed':raise ValueError('The previous game session is still closing. Try Start game again in a moment.')
            if live:
                if live.get('schema')!='pokemon-suite/session/v1' or self._owner(live)!=game:raise ValueError('This game’s viewer port belongs to another emulator. Its save has not been replaced.')
                return live
            directory=self.directory/game;directory.mkdir(parents=True,exist_ok=True,mode=0o700)
            maintenance=directory/'maintenance.json'
            if maintenance.exists():
                from datetime import datetime,timezone
                marker=json.loads(maintenance.read_text())
                if datetime.fromisoformat(marker['expiresAt'].replace('Z','+00:00'))>datetime.now(timezone.utc):raise ValueError('This game is applying a verified native save migration. Its viewer will resume when that finishes.')
            with (directory/'worker.log').open('ab') as log:
                native=cfg.get('backend') in {'libretro','desktop'}
                module='pokemon_suite.suite_desktop_worker' if cfg.get('backend')=='desktop' else 'pokemon_suite.suite_playback_worker'
                execution_config=self.execution_config_path(game)
                config=json.loads(execution_config.read_text())
                command=[sys.executable,'-m',module,str(execution_config),game] if native else [config['node'],config['worker'],str(execution_config),game]
                cwd=Path(__file__).resolve().parent.parent if native else Path(config['worker']).parent
                launch={}
                if manual and not native:launch['env']={**os.environ,'POKEMON_SUITE_MANUAL_LAUNCH':'1'}
                if update_hold:launch['env']={**launch.get('env',os.environ),'POKEMON_SUITE_UPDATE_HOLD':'1'}
                adapter_data=config['games'][game].get('adapterData')
                if adapter_data is not None and not native:
                    if not isinstance(adapter_data,str) or not Path(adapter_data).expanduser().is_dir():
                        raise ValueError('The configured private adapter data is missing. Restore the selected local inputs before starting this game.')
                    launch['env']={**launch.get('env',os.environ),'POKEMON_SUITE_ADAPTER_DATA':str(Path(adapter_data).expanduser().resolve())}
                tape=self.battle_tape_path(game)
                if tape is not None and not native:launch['env']={**launch.get('env',os.environ),'POKEMON_SUITE_BATTLE_TAPE':str(tape)}
                process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True,cwd=str(cwd),**launch)
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                live=self._live(game)
                if live and live.get('schema')=='pokemon-suite/session/v1' and self._owner(live)==game:return live
                if process.poll() is not None:raise ValueError('The game could not resume its verified save. The session log contains the startup error.')
                time.sleep(.1)
            raise ValueError('The game is still loading. Open its viewer again to reconnect.')

    def battle_tape_path(self,game):
        """Laya L2 data collection: <directory>/battle-tape.json {"enabled": true} records the FireRed
        owner's battle choices to <directory>/firered/battle-tape.ndjson. Off by default; never partners."""
        if game!='firered':return None
        try:settings=json.loads((self.directory/'battle-tape.json').read_text())
        except (OSError,ValueError):return None
        return self.directory/game/'battle-tape.ndjson' if isinstance(settings,dict) and settings.get('enabled') is True else None

    def open_game(self,game,*,manual=False):
        """An explicit game switch retires other Suite desktop emulators.

        Background hunts and paired games continue to use ensure(), so merely
        doing bot work never shuts down the game the player is using.
        """
        with self.lock:
            games=self.config()['games']
            if game not in games:raise ValueError('This game has no configured ROM and current save.')
            for other,cfg in games.items():
                if other==game or cfg.get('backend')!='desktop':continue
                try:
                    live=self._live(other)
                    if not live:
                        from .suite_desktop import check_engine_owner
                        check_engine_owner(self.directory/other/'engine.json')
                        continue
                    if live.get('state')=='closed':continue
                    closed=self.close_game(other,live.get('sessionId'))
                    if closed.get('state')!='closed':raise ValueError('The game has not finished closing. Wait and try again.')
                except ValueError as error:
                    raise ValueError(f'Could not close {other.replace("-"," ").title()}: {error}') from error
                except (OSError,subprocess.SubprocessError) as error:
                    raise ValueError(f'{other.replace("-"," ").title()} did not confirm a normal close. Finish any dialog in its emulator and try again.') from error
            return self.ensure(game,manual=True) if manual else self.ensure(game)

    def start_partner(self,owner):
        """Start the invisible FireRed partner headless and idle for commands."""
        if not self.is_partner(owner):raise ValueError('Choose a configured FireRed trade partner.')
        from .suite_save_store import atomic_file
        folder=self.directory/owner;folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        policy=folder/'bot-policy.json'
        if not policy.exists():atomic_file(policy,json.dumps({'enabled':True,'awaitingCommand':True,'consolePowered':True,'mode':'evolution-partner','runScope':'task'}).encode())
        live=self.ensure(owner)
        if not (live.get('bot') or {}).get('enabled'):live=self.command(owner,{'type':'set-bot','enabled':True},session_id=live.get('sessionId'))
        return live

    def start_game(self,game,*,wait_for_presentation=False):
        if self.is_partner(game):return self.start_partner(game)
        if wait_for_presentation:
            from .pokemon_main_series import MAIN_GAMES
            if MAIN_GAMES.get(game,{}).get('platform')!='gba':raise ValueError('This console has no verified startup recording yet.')
        live=self.open_game(game,manual=True)
        if game=='firered' and live.get('campaign') and live['campaign'].get('status')!='complete':
            if (live.get('bot') or {}).get('enabled') and live['campaign'].get('status')=='running':return live
            return self.command(game,{'type':'resume-campaign'},session_id=live.get('sessionId'))
        native_backend=self.config()['games'].get(game,{}).get('backend') in {'libretro','desktop'}
        if game in {'firered','emerald'} and not native_backend:
            # Starting is idempotent; it never replaces a running user task.
            if (live.get('bot') or {}).get('enabled'):return live
            self.pause_collection(game,'Ready for commands. Choose a goal to resume collection.')
        if game in {'firered','emerald','crystal'} or self.config()['games'].get(game,{}).get('backend')=='libretro':
            command={'type':'start-bot'} if game in {'firered','emerald'} and not native_backend else {'type':'manual-game','boot':True}
            if wait_for_presentation:command['presentationId']=uuid.uuid4().hex
            live=self.command(game,command,session_id=live.get('sessionId'))
            if wait_for_presentation and (live.get('consolePresentation') or {}).get('id')!=command['presentationId']:
                raise ValueError('The game owner needs the console startup update. Restart its saved session, then retry.')
        return live

    def pause_collection(self,game,reason):
        if game!='firered':return
        from .pokemon_shiny_sweep import ShinySweep
        ShinySweep(self.directory/game,None,self).pause(reason)

    def finish_presentation(self,game,session_id,presentation_id):
        live=self._live(game)
        if not live or live.get('sessionId')!=session_id or (live.get('consolePresentation') or {}).get('id')!=presentation_id:
            raise ValueError('The console startup changed. Refresh its viewer.')
        return self.command(game,{'type':'console-presented','presentationId':presentation_id},session_id=session_id)

    def bot_settings(self,game):
        if not self.configured(game):raise ValueError('Choose a configured game.')
        from .pokemon_bot_settings import read
        return read(self.directory,game)

    def campaign_runs(self,game):
        from .pokemon_campaigns import options
        return options(self,game)

    def preview_campaign(self,game,settings):
        from .capabilities import require_feature
        require_feature(game,self.config()['games'].get(game),'campaign')
        from .pokemon_campaigns import preview
        return preview(self,game,settings)

    def start_campaign(self,game,preview_id):
        from .pokemon_campaigns import start
        return start(self,game,preview_id)

    def player_task_options(self,game):
        from .pokemon_player_tasks import options
        return options(self,game)

    def player_task(self,game,action,task=None):
        if self.is_partner(game) and action not in {'ready','resume','stop','stop-game'}:
            raise ValueError('The FireRed trade partner is never assigned tasks. It only serves paired trade evolutions.')
        if action in {'collection','postgame','new-save','restore-save','start'}:
            from .capabilities import require_feature
            require_feature(game,self.config()['games'].get(game),'campaign')
        if not self.configured(game):raise ValueError('Choose a configured game.')
        from .pokemon_shiny_sweep import ShinySweep
        from .pokemon_farming import suite_requests
        farming=suite_requests(self.directory,self)
        sweep=ShinySweep(self.directory/'firered',farming,self)
        previous=sweep.read() if game=='firered' else None
        if action in {'new-save','restore-save'}:
            from .pokemon_farming import fields
            fields(task,{'label'} if action=='new-save' else {'profileId'},'Save profile')
            if game!='firered':raise ValueError('Separate save profiles are currently supported for FireRed.')
            live=self.ensure(game,manual=True)
            result=self.command(game,{'type':action,**task},session_id=live['sessionId'])
            if previous:sweep.pause('A manual save profile has control.')
            return result
        if action=='collection':
            from .pokemon_farming import fields,choice
            if isinstance(task,dict):task={'goal':'supported',**task}
            fields(task,{'collectionStages','goal'},'Collection');choice(task['collectionStages'],['base-forms','each-stage'],'Collection stages')
            choice(task['goal'],['supported','national-dex'],'Collection goal')
            if task['goal']=='national-dex':task['collectionStages']='each-stage'
            if game!='firered':raise ValueError('Automatic shiny collection is available for FireRed.')
            live=self.ensure(game)
            if (live.get('localEvolution') or {}).get('phase') not in (None,'complete'):raise ValueError('Finish the linked evolution before changing collection goals.')
            active=(previous or {}).get('active') or {};preparation=(live.get('bot') or {}).get('preparation') or {}
            if task['collectionStages']=='base-forms' and active and preparation.get('requestId')==active.get('requestId') and preparation.get('kind')=='evolution':
                self.command(game,{'type':'set-bot','enabled':False},session_id=live['sessionId'])
                self.command(game,{'type':'preserve-source','requestId':active['requestId']},session_id=live['sessionId'])
                sweep.pause('Preserved the unevolved source.')
            preferences=self.bot_settings(game)['preferences'];preferences['collectionStages']=task['collectionStages'];self.save_bot_settings(game,preferences)
            sweep.start(goal=task['goal']);live=self.command(game,{'type':'set-bot','enabled':True,'runScope':'collection'})
            with (self.directory/game/'shiny-sweep.log').open('ab') as log:
                subprocess.Popen([sys.executable,'-m','pokemon_suite.pokemon_shiny_sweep','--suite-root',str(self.directory)],cwd=str(Path(__file__).resolve().parent.parent),stdout=log,stderr=log,stdin=subprocess.DEVNULL,start_new_session=True)
            return {**live,'collectionRun':sweep.summary()}
        if action=='postgame':
            if game!='firered':raise ValueError('The postgame checklist is currently implemented for FireRed.')
            body={'type':'postgame-goal'}
            if task not in (None,{}):
                from .pokemon_farming import fields
                fields(task,{'priorityTarget'},'Postgame goal')
                body['priorityTarget']=priority_target(task['priorityTarget'])
            live=self.ensure(game)
            with sweep.transaction():
                result=self.command(game,body,session_id=live['sessionId'])
                previous=sweep.read()
                if previous:
                    previous.update(enabled=False,status='paused',reason='The postgame checklist has control.');sweep.write(previous)
            return result
        if action=='start':
            from .pokemon_player_tasks import validate
            request=validate(self,game,task)
            live=self.ensure(game)
            if previous:sweep.pause('Your selected task has control.')
            return self.command(game,{'type':'player-task','request':request},session_id=live['sessionId'])
        if action=='open-trade':return self.ensure(game,manual=True)
        if action=='ready':return self.start_game(game)
        if action=='resume':return self.set_bot(game,True)
        if action=='stop-game':
            live=self._live(game)
            if not live:raise ValueError('This game is not running.')
            return self.stop_game(game,live['sessionId'])
        if action=='stop':
            if previous:sweep.pause('Stopped by you.')
            live=self.set_bot(game,False)
            if (live.get('localEvolution') or {}).get('phase') not in (None,'complete'):return live
            if not native_trade_finished(live.get('nativeTrade')):return live
            return self.command(game,{'type':'manual-game','boot':False},session_id=live['sessionId'])
        raise ValueError('Choose Start, Resume or Stop bot.')

    def save_bot_settings(self,game,value):
        if not self.configured(game):raise ValueError('Choose a configured game.')
        from .pokemon_bot_settings import write,league_training
        with self.lock:before=league_training(self.directory,game);result=write(self.directory,game,value);after=league_training(self.directory,game)
        if game!='firered' or after==before:return result
        # A running FireRed owner re-reads a changed League training setting (and a
        # resume), but only through an idle command slot: a pending command (a Stop)
        # is never replaced. Otherwise its next postgame owner reads the file.
        live=self._live(game);sent=False
        if live and live.get('schema')=='pokemon-suite/session/v1' and self._owner(live)==game and live.get('sessionId'):
            try:sent=self.command(game,{'type':'bot-settings-changed'},session_id=live['sessionId'],idle_only=True) is not None
            except ValueError:pass
        what='League training is off.' if not after[0] else 'League training will resume at the next free moment outside the League.'
        return {**result,'notice':what+(' The running game has the change.' if sent else ' The game reads the change when postgame work next starts.')}

    def stop_game(self,game,session_id):
        with self.lock:
            live=self._live(game);cfg=self.config()['games'].get(game)
            if cfg is None or not live:raise ValueError('This game is not running.')
            if live.get('schema')!='pokemon-suite/session/v1' or self._owner(live)!=game or live.get('sessionId')!=session_id:raise ValueError('The game session changed. Refresh before stopping it.')
            self.pause_collection(game,'Stopped by you. Start game waits for your next command.')
            if cfg.get('backend')=='desktop':return self.close_game(game,session_id)
            if self.title(game) in {'firered','emerald'}:
                paired=[];local=live.get('localEvolution') or {}
                # The source FireRed and whichever partner owner shares its exchange.
                for peer in [o for o in self.config()['games'] if o!=game and self.title(o) in {'firered','emerald'}]:
                    other=self._live(peer) if local.get('requestId') and local.get('phase')!='complete' else None
                    if other and (other.get('localEvolution') or {}).get('requestId')==local['requestId'] and (other.get('localEvolution') or {}).get('phase')!='complete':
                        paired.append((peer,other))
                targets=[(game,live),*paired]
                targets.sort(key=lambda pair:pair[0]!='firered')
                close_manual=False
                for name,status in targets:
                    result=self.command(name,{'type':'set-bot','enabled':False},session_id=status['sessionId'])
                    if not result.get('bot',{}).get('enabled') and result.get('control',{}).get('mode')=='manual' and not result.get('control',{}).get('paused') and not paired and local.get('phase') in (None,'complete') and native_trade_finished(result.get('nativeTrade')):
                        close_manual=True;break
                    if result.get('bot',{}).get('enabled') or not result.get('control',{}).get('paused'):
                        raise ValueError('The bot stopped but the game has not confirmed a pause. Keep this viewer open and retry.')
                    if not paired and local.get('phase') in (None,'complete') and native_trade_finished(result.get('nativeTrade')):
                        close_manual=True
                if not close_manual:return self._live(game)
            # Ask the owner to save and close through its mailbox. Windows
            # process termination does not run a SIGTERM save handler.
            path=self.directory/game/'owner.lock'
            owner=json.loads(path.read_text());pid=owner.get('pid')
            if type(pid) is not int or pid<=1 or owner.get('game',game)!=game:raise ValueError('The game owner could not be verified.')
            self.command(game,{'type':'save'},session_id=session_id)
            current=self._live(game)
            if not current or current.get('sessionId')!=session_id or json.loads(path.read_text()).get('pid')!=pid:raise ValueError('The game session changed before closing. Refresh its status.')
            from .suite_save_store import atomic_file
            atomic_file(self.directory/game/'command.json',json.dumps({'type':'shutdown','commandId':uuid.uuid4().hex,'sessionId':session_id}).encode())
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                if not self._live(game) and not path.exists():return {**live,'state':'closed','message':'Game stopped and checkpoint saved.'}
                time.sleep(.1)
            raise ValueError('The game is still saving or closing. It was not force-stopped.')

    def close_game(self,game,session_id):
        cfg=self.config()['games'].get(game)
        if not cfg or cfg.get('backend')!='desktop':raise ValueError('Choose a configured 3DS or Switch game.')
        live=self._live(game)
        if not live:
            from .suite_desktop import check_engine_owner
            check_engine_owner(self.directory/game/'engine.json')
            return {'game':game,'state':'closed','sessionId':session_id}
        if live.get('sessionId')!=session_id:raise ValueError('The game session changed. Refresh before closing it.')
        if live.get('schema')!='pokemon-suite/session/v1' or self._owner(live)!=game:raise ValueError('This port belongs to another game.')
        if not live.get('capabilities',{}).get('closeGame'):
            # Upgrade compatibility: ask the original native app to quit normally.
            # Only remove its old Python owner once the native engine is gone.
            pid=live.get('enginePid')
            if type(pid) is not int or pid<=1:raise ValueError('This older session is still starting. Wait and try closing again.')
            subprocess.run([cfg['capture'],'--pid',str(pid),'--quit'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
            deadline=time.monotonic()+25
            while time.monotonic()<deadline:
                try:assert_process_alive(pid)
                except ProcessLookupError:break
                time.sleep(.1)
            else:raise ValueError('The game did not accept a normal close. It is still running; finish any dialog in its native window and retry.')
            import signal
            owner=live.get('ownerPid')
            if type(owner) is int and owner>1:
                try:os.kill(owner,signal.SIGTERM)
                except ProcessLookupError:pass
            result={**live,'state':'closed','message':'Game closed.','sourceFps':0}
            from .suite_save_store import atomic_file
            atomic_file(self.directory/game/'closed.json',json.dumps(result).encode())
            return result
        return self.lifecycle(game,session_id,'close')

    def lifecycle(self,game,session_id,action):
        cfg=self.config()['games'].get(game);live=self._live(game) if cfg else None
        if not cfg or cfg.get('backend')!='desktop' or not live:raise ValueError('This game is not running.')
        if live.get('schema')!='pokemon-suite/session/v1' or self._owner(live)!=game or live.get('sessionId')!=session_id:raise ValueError('The game session changed. Refresh before controlling it.')
        if not live.get('capabilities',{}).get('closeGame'):raise ValueError('Close and reopen this older game session to enable video recovery controls.')
        connection=http.client.HTTPConnection('127.0.0.1',cfg['port'],timeout=35)
        try:
            connection.request('POST','/control/lifecycle',json.dumps({'sessionId':session_id,'action':action}),{'Content-Type':'application/json'})
            response=connection.getresponse();result=json.loads(response.read(65536))
            if response.status!=200:raise ValueError(result.get('error','The game did not accept this action.'))
            return result
        except (OSError,http.client.HTTPException) as error:
            if action=='close':
                try:receipt=json.loads((self.directory/game/'closed.json').read_text())
                except (OSError,ValueError):receipt={}
                if receipt.get('sessionId')==session_id and receipt.get('state')=='closed':return receipt
            raise ValueError('The game has not confirmed this action. Refresh its status before retrying.') from error
        finally:connection.close()

    def release_for(self,game):return self.config()['games'][game]['release']

    def library(self, live_sessions=()):
        from .pokemon_main_series import describe_library
        return describe_library(self.config(),live_sessions)

    def scan_library(self, folder=None):
        from .pokemon_main_series import scan_library
        from .suite_save_store import atomic_file
        with self.lock:
            config=json.loads(self.config_path.read_text());root=folder if folder is not None else config.get('libraryRoot')
            if root is not None and (not isinstance(root,str) or not Path(root).is_absolute()):raise ValueError('Choose an absolute ROM folder path.')
            if not root:raise ValueError('Configure this Suite’s game library folder first.')
            config['library']=scan_library(Path(root))
            config['libraryRoot']=str(Path(root).resolve())
            atomic_file(self.config_path,json.dumps(config,indent=2).encode())
            return self.library()

    def input(self,game,value):
        cfg=self.config()['games'].get(game)
        if not cfg or not (cfg.get('backend') in {'libretro','desktop'} or self.title(game) in {'firered','emerald','crystal'}):raise ValueError('Choose a configured Suite playback game.')
        if cfg.get('backend') not in {'libretro','desktop'}:
            if set(value)!={'buttons'} or not isinstance(value['buttons'],list):raise ValueError('This handheld accepts button input only.')
            value={'buttons':[str(button).lower() for button in value['buttons']]}
        live=self._live(game)
        if not live or self._owner(live)!=game or live.get('schema')!='pokemon-suite/session/v1':raise ValueError('Open this game’s viewer before controlling it.')
        connection=http.client.HTTPConnection('127.0.0.1',cfg['port'],timeout=2)
        try:
            connection.request('POST','/control/input',json.dumps(value),{'Content-Type':'application/json'})
            response=connection.getresponse();result=json.loads(response.read(8192))
            if response.status!=200:raise ValueError(result.get('error','The game did not accept this input.'))
            return result
        except (OSError,http.client.HTTPException) as error:raise ValueError('The game input connection is unavailable.') from error
        finally:connection.close()

    def command(self,game,body,session_id=None,idle_only=False):
        with self.lock:
            if session_id is None:session_id=self.ensure(game)['sessionId']
            else:
                live=self._live(game)
                if not live or live.get('sessionId')!=session_id or self._owner(live)!=game or live.get('schema')!='pokemon-suite/session/v1':raise ValueError('The game session changed. Refresh before controlling it.')
            command_id=uuid.uuid4().hex
            target=self.directory/game/'command.json';temporary=target.with_suffix('.tmp')
            # The worker reads only the newest command: an optional one (idle_only)
            # never replaces a command the session has not acknowledged. None: not sent.
            if idle_only:
                try:pending=json.loads(target.read_text()).get('commandId')
                except (OSError,ValueError,AttributeError):pending=None
                if pending and pending!=(self._live(game) or {}).get('lastCommand'):return None
            fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
            with os.fdopen(fd,'w') as out:
                json.dump({**body,'sessionId':session_id,'commandId':command_id},out);out.flush();os.fsync(out.fileno())
            os.replace(temporary,target)
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                live=self._live(game)
                # A synchronous save/load can exceed the short status timeout.
                # Keep waiting for this command's receipt; never resend it.
                if session_id is not None and live and live.get('sessionId')!=session_id:raise ValueError('The game session changed before confirming the action.')
                if live and live.get('lastCommand')==command_id:
                    if live.get('commandError'):raise ValueError(live['commandError'])
                    return live
                time.sleep(.1)
            raise ValueError('The game has not acknowledged this command yet. Refresh its status before retrying.')

    def completed_hunt(self,record):
        game=record['request']['game'];identifier=record['id']
        if game not in self.config()['games'] or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',identifier):return None
        try:mission=json.loads((self.directory/game/f'archived-{identifier}.json').read_text())['mission']
        except (OSError,ValueError,KeyError):return None
        if mission.get('id')!=identifier or mission.get('status')!='complete':return None
        return {**{k:mission.get(k) for k in ('id','phase','encounters','elapsedMs','protected','reason')},'state':'complete','caught':mission.get('caught',record['request'].get('quantity',1))}

    def start(self,record):
        if self.completed_hunt(record):raise ValueError('This hunt is complete. Save a new request to find more Pokémon.')
        scope='task'
        if record['request']['game']=='firered':
            from .pokemon_shiny_sweep import ShinySweep
            sweep=ShinySweep(self.directory/'firered',None,self);state=sweep.read();active=(state or {}).get('active') or {}
            if active.get('requestId') in {record['id'],record['id'].removesuffix('-source')} and state.get('enabled'):scope='collection'
            elif state and state.get('enabled'):state.update(enabled=False,status='paused',reason='Your Pokémon request has control.');sweep.write(state)
        live=self._live(record['request']['game']) or {}
        if (live.get('mission') or {}).get('id')==record['id']:
            # A gift is consumed as soon as it is received; its own paused
            # mission must still be able to finish saving that protected gift.
            live=self.command(record['request']['game'],{'type':'start','runScope':scope,'retryBlockedPolicy':record.get('retryBlockedPolicy') is True,'record':{'id':record['id'],'request':record['request']}})
            return {'session':live,'cartridge':'pokemon-'+record['request']['game']}
        capability=self.capability(record['request'])
        if not capability['supported']:raise ValueError(capability['reason'])
        if capability.get('method')=='static' and postgame_running(self._live(record['request']['game']) or {}):
            # The running postgame checklist owns this save: the static becomes its
            # priority target and the checklist continues after it.
            target={'speciesId':record['request']['speciesId'],'shiny':record['request']['shiny'],'requestId':record['id'],'request':record['request']}
            live=self.command(record['request']['game'],{'type':'postgame-goal','priorityTarget':target})
            return {'session':live,'cartridge':'pokemon-'+record['request']['game'],'stage':'postgame-priority'}
        live=self.command(record['request']['game'],{'type':'start','runScope':scope,'retryBlockedPolicy':record.get('retryBlockedPolicy') is True,'record':{'id':record['id'],'request':record['request'],'route':capability.get('route'),**({'continuation':record['continuation']} if record.get('continuation') else {})}})
        return {'session':live,'cartridge':'pokemon-'+record['request']['game']}

    def continue_acquisition(self,record,route):
        source=record.get('sourceTask') or {}
        if source.get('request',{}).get('game')!='firered' or record['request']['quantity']!=1:raise ValueError('Choose a FireRed evolution request for one saved source.')
        route=source.get('continuation',{}).get('route',route)
        live=self.command('firered',{'type':'prepare-acquisition','requestId':record['id'],'sourceId':source['id'],'request':record['request'],'route':route})
        preparation=(live.get('bot') or {}).get('preparation') or {}
        if preparation.get('requestId')==record['id'] and preparation.get('phase')=='waiting-for-transfer' and any(p['game']=='emerald' for p in route.get('prerequisites',[])):
            companion=self.command('emerald',{'type':'prepare-partner','requestId':record['id']})
            return {'session':live,'companionSession':companion,'stage':'companion-preparation','destination':route['destination'],'cartridge':'pokemon-firered'}
        return {'session':live,'stage':'evolution-preparation','destination':route['destination'],'cartridge':'pokemon-firered'}

    def completed_acquisition(self,record):
        game=record['request']['game'];identifier=record['id']
        if game!='firered' or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',identifier):return None
        try:receipt=json.loads((self.directory/game/f'acquisition-{identifier}.json').read_text())
        except (OSError,ValueError):return None
        from .pokemon_farming import catalog
        native=receipt.get('pokemon',{}).get('species')
        dex=catalog(game);target=next((p for p in dex['species'] if p['id']==record['request']['speciesId']),{})
        # Generation III's internal IDs differ from National IDs above 251.
        actual=receipt.get('nationalSpeciesId',native if isinstance(native,int) and native<=251 else None)
        if receipt.get('requestId')!=identifier or not receipt.get('nativeSaveVerified') or not receipt.get('savedSramSha256') or actual!=target.get('id'):return None
        if record['request']['shiny']=='required' and receipt.get('pokemon',{}).get('shiny') is not True:return None
        return {'id':identifier,'state':'complete','phase':'complete','speciesId':actual,'caught':1,'quantity':1,'reason':'Evolved, saved in game, and original identity verified.','receipt':receipt}

    def stop(self,record):return {'session':self.command(record['request']['game'],{'type':'stop','id':record['id']})}

    def set_bot(self,game,enabled):
        if enabled:
            from .capabilities import require_feature
            require_feature(self.title(game),self.config()['games'].get(game),'campaign' if game=='firered' else 'companion')
        if (game not in {'firered','emerald'} and not self.is_partner(game)) or not self.configured(game) or type(enabled) is not bool:raise ValueError('Choose whether to run the configured Pokémon bot.')
        live=self.command(game,{'type':'set-bot','enabled':enabled})
        local=live.get('localEvolution') or {}
        if game=='firered' and (not enabled or local.get('phase') not in (None,'complete')):
            request=((live.get('bot') or {}).get('preparation') or {}).get('requestId')
            for partner,_ in self.partner_owners():
                companion=(self._live(partner) or {}).get('bot') or {}
                if request and companion.get('mode')=='evolution-partner' and (companion.get('preparation') or {}).get('requestId')==request:self.command(partner,{'type':'set-bot','enabled':enabled})
        return live

    def shinies(self):
        from .pokemon_farming import catalog
        result=[]
        for game in self.config()['games']:
            if self.is_partner(game):continue
            try:records=json.loads((self.directory/game/'shiny-collection.json').read_text()).get('records',[])
            except (OSError,ValueError):continue
            live=self._live(game);current={r['id']:r for r in (live or {}).get('collection',[])}
            dex=catalog(game);species={p['id']:p for p in dex['species']}
            for record in records:
                r={**record,**current.get(record['id'],{})};p=r['pokemon'];mon=species.get(r.get('nationalSpeciesId') or p['species'])
                if not mon:continue
                ability=mon['abilities'][min(p.get('abilityNum',0),len(mon['abilities'])-1)]['name'] if mon['abilities'] else None
                preparing=(live or {}).get('tradePreparation') or {}
                result.append({**r,'name':mon['name'],'gameLabel':dex['label'],'sprite':mon.get('shinySprite') or mon['sprite'],'ability':ability,
                    'canTrade':bool(live and current.get(record['id'],{}).get('canTrade')),
                    'trade':(live or {}).get('nativeTrade') if (live or {}).get('nativeTrade',{} ) and (live or {}).get('nativeTrade',{}).get('fingerprint')==r.get('fingerprint') else None,
                    'taskState':(live or {}).get('state','offline'),'taskReason':(live or {}).get('mission',{}).get('reason')})
                if preparing.get('fingerprint')==r.get('fingerprint'):result[-1]['preparation']=preparing
        return sorted(result,key=lambda r:(not bool(r.get('owned')),r.get('caughtAt','')),reverse=False)

    def trade_shiny(self,game,identifier):
        if not isinstance(game,str) or not isinstance(identifier,str) or not re.fullmatch(r'[a-f0-9]{64}',identifier):raise ValueError('Choose a saved shiny Pokémon.')
        record=next((r for r in self.shinies() if r['game']==game and r['id']==identifier),None)
        if not record or not record.get('canTrade'):raise ValueError('This shiny is unavailable for trading. Open its game and finish or stop the current task first.')
        return self.command(game,{'type':'trade-shiny','shinyId':identifier})

    def stop_trade(self,game):
        if game not in self.config()['games']:raise ValueError('Choose a configured game.')
        live=self._live(game)
        if not live:raise ValueError('This game is offline.')
        trade=live.get('nativeTrade') or {}
        if trade.get('exchangeStarted') and trade.get('phase')!='complete':raise ValueError('The exchange has started. Finish its save and exit handshake before stopping the lobby.')
        return self.command(game,{'type':'stop','id':live.get('runId')},session_id=live.get('sessionId'))

    def partner_snapshots(self):
        """The invisible partner owners, kept out of the game list."""
        result=[]
        for game in self.config()['games']:
            if not self.is_partner(game):continue
            live=self._display_snapshot(game)
            result.append({**live,'owner':game} if live else {'game':self.title(game),'owner':game,'state':'offline'})
        return result

    def snapshots(self):
        result=[]
        for game in self.config()['games']:
            if self.is_partner(game):continue
            live=self._display_snapshot(game)
            if live:
                if game=='firered':
                    from .pokemon_shiny_sweep import ShinySweep
                    from .pokemon_goals import GoalStore
                    live={**live,'collectionRun':ShinySweep(self.directory/game,None,self).summary(),'goals':GoalStore(self.directory).summary()}
                # A stopped or recovering owner carries its read-only stop triage (L1.1).
                from .pokemon_stop_triage import attach
                triage=attach(self.directory,game,live)
                if triage:live={**live,'triage':triage}
                result.append(live);continue
            directory=self.directory/game
            save_file='native-backups/current.json' if self.config()['games'][game].get('backend')=='desktop' else 'saves/current.json'
            try:saved=json.loads((directory/save_file).read_text())
            except (OSError,ValueError):saved=None
            try:
                active=json.loads((directory/'active-hunt.json').read_text())
                identifier=active['id']
                if not isinstance(identifier,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',identifier):raise ValueError('invalid hunt identifier')
                hunt=json.loads((directory/'hunts'/identifier/'saves/current.json').read_text())
                mission=hunt.get('metadata',{}).get('session')
            except (OSError,ValueError,KeyError):mission=None
            result.append({'game':game,'state':'offline','save':{'schema':saved.get('schema'),'updatedAt':saved['updatedAt'],'frame':saved.get('metadata',{}).get('frame')} if saved else None,
                'nativeTrade':{**mission['nativeTrade'],'advertising':False,'sessionOffline':True} if mission and mission.get('nativeTrade') else None,
                'mission':{**{k:v for k,v in mission['mission'].items() if k in {'id','phase','encounters','elapsedMs','reason','protected'}},'state':mission['mission'].get('status','paused')} if mission else None})
        return result
