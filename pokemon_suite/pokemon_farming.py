"""Validated pre-start farming requirements. Never starts a game while planning."""
from __future__ import annotations
from .data_provider import read_data, with_game_data, CURRENT
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time
import threading
import uuid
from .pokemon_competitive import plan as competitive_plan
from .pokemon_acquisition import acquisition_routes

GAMES = {'firered', 'leafgreen', 'emerald', 'crystal'}
# The FireRed engine's names (engine/firered/src/rng/target-traits.js); Gen III has no Normal Hidden Power.
HIDDEN_POWER_TYPES = ['fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel', 'fire', 'water', 'grass', 'electric',
                      'psychic', 'ice', 'dragon', 'dark']
STATS = {'hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'}
FIELDS = {'schema','game','speciesId','quantity','locationId','shiny','natures','gender','abilityId','ball','minIvs','minDvs','encounterLevel','finalLevel','moves','heldItemId','limits','afterCompletion'}

def catalog(game):
    if game not in GAMES:raise ValueError('Choose an available game.')
    return read_data('pokedex/'+game+'.json',game)

def integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:raise ValueError(f'{label} must be between {low} and {high}.')
    return value

def fields(value, allowed, label):
    if not isinstance(value,dict) or set(value)!=allowed:raise ValueError(f'{label} has missing or unsupported settings.')

def choice(value, allowed, label):
    if not any(value == item for item in allowed):raise ValueError(f'{label} is not available for this request.')

LEGACY_MIGRATION='legacy-pokemon-farming'
# The shiny collection's automatic requests (pokemon_shiny_sweep keys them
# "sweep-<run>-<species>"). They share the one database but keep their own list
# and 500-row limit, as when they lived in the separate legacy database.
COLLECTION_KEY='sweep-'

def migrate_legacy_requests(suite_root):
    """Merge the collection's old request database into the Suite's one database.

    Before goals, the shiny collection saved requests in
    <runtime>/pokemon-farming/requests.sqlite3 while the Suite server used
    <runtime>/pokemon-suite/farming/requests.sqlite3. Missing rows are copied
    into the server database; existing rows always win. Each distinct legacy
    file is merged once: both databases are backed up first and the merge is
    recorded, so repeated opens are no-ops. The legacy file is never changed.
    """
    import shutil
    suite_root=Path(suite_root);legacy=suite_root.parent/'pokemon-farming'/'requests.sqlite3'
    target_dir=suite_root/'farming';target=target_dir/'requests.sqlite3'
    result={'migrated':0,'skipped':[],'source':str(legacy)}
    if not legacy.is_file():return result
    from . import file_lock
    target_dir.mkdir(parents=True,exist_ok=True)
    with (target_dir/'migration.lock').open('a') as lock:
        file_lock.flock(lock,file_lock.LOCK_EX)
        try:
            digest=hashlib.sha256(legacy.read_bytes()).hexdigest()
            db=sqlite3.connect(target,timeout=10)
            try:
                with db:
                    db.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, idempotency TEXT UNIQUE NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, created REAL NOT NULL)')
                    db.execute('CREATE TABLE IF NOT EXISTS migrations (id TEXT NOT NULL, source TEXT NOT NULL, sourceSha256 TEXT NOT NULL, rows INTEGER NOT NULL, skipped TEXT NOT NULL, at REAL NOT NULL, PRIMARY KEY (id, sourceSha256))')
                    if db.execute('SELECT 1 FROM migrations WHERE id=? AND sourceSha256=?',(LEGACY_MIGRATION,digest)).fetchone():return result
                # Consistent copies of both databases before anything is merged.
                stamp=time.strftime('%Y%m%dT%H%M%S')+f'-{digest[:12]}';backups=target_dir/'backups';backups.mkdir(exist_ok=True,mode=0o700)
                source=sqlite3.connect(legacy.as_uri()+'?mode=ro',uri=True,timeout=10)
                try:
                    copy=sqlite3.connect(backups/f'pokemon-farming-legacy-{stamp}.sqlite3')
                    try:source.backup(copy)
                    finally:copy.close()
                    rows=source.execute('SELECT id,idempotency,digest,body,created FROM requests ORDER BY created').fetchall() if source.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='requests'").fetchone() else []
                finally:source.close()
                copy=sqlite3.connect(backups/f'requests-before-merge-{stamp}.sqlite3')
                try:db.backup(copy)
                finally:copy.close()
                with db:
                    db.execute('BEGIN IMMEDIATE')
                    for row in rows:
                        if db.execute('SELECT 1 FROM requests WHERE id=?',(row[0],)).fetchone():
                            result['skipped'].append({'id':row[0],'reason':'already-present'});continue
                        if db.execute('SELECT 1 FROM requests WHERE idempotency=?',(row[1],)).fetchone():
                            result['skipped'].append({'id':row[0],'reason':'idempotency-key-in-use'});continue
                        db.execute('INSERT INTO requests VALUES (?,?,?,?,?)',row);result['migrated']+=1
                    db.execute('INSERT INTO migrations VALUES (?,?,?,?,?,?)',(LEGACY_MIGRATION,str(legacy),digest,result['migrated'],json.dumps(result['skipped']),time.time()))
            finally:db.close()
        finally:file_lock.flock(lock,file_lock.LOCK_UN)
    return result

def suite_requests(suite_root, executor=None):
    """The Suite's single farming request database (server, goals and collection)."""
    try:migrate_legacy_requests(suite_root)
    except (OSError,sqlite3.Error) as error:
        # Never block the Suite on the merge; report it next to the database.
        from .suite_save_store import atomic_file
        folder=Path(suite_root)/'farming';folder.mkdir(parents=True,exist_ok=True)
        atomic_file(folder/'legacy-migration-error.json',json.dumps({'error':str(error),'at':time.time()}).encode())
    return FarmingRequests(Path(suite_root)/'farming', executor)

class FarmingRequests:
    def __init__(self, directory: Path, executor=None):
        self.directory=directory
        self.path=directory/'requests.sqlite3'
        self.executor=executor
        self.lock=threading.RLock()

    @contextmanager
    def connection(self):
        self.directory.mkdir(parents=True,exist_ok=True)
        db=sqlite3.connect(self.path,timeout=10)
        try:
            with db:
                db.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, idempotency TEXT UNIQUE NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, created REAL NOT NULL)')
                yield db
        finally:
            db.close()

    @with_game_data
    def preview(self, value):
        extended=isinstance(value,dict) and value.get('schema')=='pokemon-suite/farming-request/v2'
        fields(value,(FIELDS|{'competitive'} if extended else FIELDS)|({k for k in ('nickname','maxIvs','hiddenPower') if k in value} if isinstance(value,dict) else set()),'Request')
        if value.get('nickname') is not None and (not isinstance(value['nickname'],str) or not re.fullmatch('[A-Za-z]{1,10}',value['nickname'])):raise ValueError('Use up to 10 letters for a nickname, or leave it blank to keep the species name.')
        choice(value['schema'],{'pokemon-suite/farming-request/v1','pokemon-suite/farming-request/v2'},'Request format')
        if not isinstance(value['game'],str):raise ValueError('Choose a game.')
        dex=catalog(value['game']);pid=integer(value['speciesId'],1,dex['nationalCount'],'Pokédex number')
        mon=next(p for p in dex['species'] if p['id']==pid)
        competitive=competitive_plan(value.get('competitive'),pid)
        integer(value['quantity'],1,99,'Quantity');choice(value['shiny'],['any','required'],'Shiny setting')
        if not isinstance(value['natures'],list) or len(value['natures'])>25:raise ValueError('Choose valid natures.')
        for nature in value['natures']:choice(nature,[n['id'] for n in dex['natures']],'Nature')
        choice(value['gender'],['any','male','female','genderless'],'Gender')
        gender=mon['genderRate']
        if value['gender']!='any' and ((gender==-1 and value['gender']!='genderless') or (gender!=-1 and value['gender']=='genderless') or (gender==0 and value['gender']=='female') or (gender==8 and value['gender']=='male')):raise ValueError('That gender is not possible for this Pokémon.')
        if value['abilityId'] is not None:
            integer(value['abilityId'],1,10000,'Ability')
            choice(value['abilityId'],[a['id'] for a in mon['abilities']],'Ability')
        for key,maximum,allowed in [('minIvs',31,STATS),('minDvs',15,{'attack','defense','special','speed'})]:
            if not isinstance(value[key],dict) or not set(value[key])<=allowed:raise ValueError('Choose valid stat requirements.')
            for stat,n in value[key].items():integer(n,0,maximum,stat)
        if 'maxIvs' in value:
            if not isinstance(value['maxIvs'],dict) or not set(value['maxIvs'])<=STATS:raise ValueError('Choose valid maximum IV requirements.')
            for stat,n in value['maxIvs'].items():
                integer(n,0,31,stat)
                if n<value['minIvs'].get(stat,0):raise ValueError('Each maximum IV must be at least its minimum.')
            if dex['generation']<3 and value['maxIvs']:raise ValueError('Crystal uses DVs, not IV ranges.')
        if 'hiddenPower' in value:
            wanted=value['hiddenPower']
            if not isinstance(wanted,dict) or 'type' not in wanted or not set(wanted)<={'type','minPower'}:raise ValueError('Choose a Hidden Power type, with an optional minimum power.')
            choice(wanted['type'],HIDDEN_POWER_TYPES,'Hidden Power type')
            if wanted.get('minPower') is not None:integer(wanted['minPower'],30,70,'Minimum Hidden Power')
            if value['game']!='firered':raise ValueError('Hidden Power targeting runs in FireRed hunts.')
        if dex['generation']==2 and (value['minIvs'] or value['natures'] or value['abilityId'] is not None):raise ValueError('Crystal uses DVs and has no natures or abilities.')
        if dex['generation']>=3 and value['minDvs']:raise ValueError('This game uses IVs, not DVs.')
        fields(value['ball'],{'id','requirement'},'Poké Ball')
        choice(value['ball']['id'],['any']+[b['id'] for b in dex['balls']],'Poké Ball')
        choice(value['ball']['requirement'],['required','preferred'],'Ball requirement')
        fields(value['encounterLevel'],{'min','max'},'Encounter level')
        lo=integer(value['encounterLevel']['min'],1,100,'Minimum encounter level');hi=integer(value['encounterLevel']['max'],lo,100,'Maximum encounter level')
        if value['finalLevel'] is not None:integer(value['finalLevel'],lo,100,'Final level')
        if not isinstance(value['moves'],list) or len(value['moves'])>4 or any(type(m) is not int for m in value['moves']) or len(set(value['moves']))!=len(value['moves']):raise ValueError('Choose up to four different moves.')
        for move in value['moves']:
            integer(move,1,10000,'Move');choice(move,[m['moveId'] for m in mon['learnset']],'Move')
        if value['heldItemId'] is not None:choice(value['heldItemId'],[i['id'] for i in dex.get('heldItems',[])],'Held item')
        fields(value['limits'],{'maxEncounters','maxMinutes','minBalls','maxSpend'},'Search limits')
        for k,maximum in [('maxEncounters',1000000),('maxMinutes',10080),('minBalls',999),('maxSpend',999999)]:integer(value['limits'][k],0 if k in {'minBalls','maxSpend'} else 1,maximum,k)
        choice(value['afterCompletion'],['stop-save','prepare-trade'],'After completion')
        if not isinstance(value['locationId'],str):raise ValueError('Choose a location.')
        location=next((e for e in mon['encounters'] if e['id']==value['locationId']),None)
        if value['locationId']!='any' and location is None:raise ValueError('That location does not belong to this Pokémon and game.')
        candidates=[location] if location else mon['encounters']
        candidates=[e for e in candidates if e['minLevel']<=hi and e['maxLevel']>=lo]
        if mon['encounters'] and not candidates:raise ValueError('The encounter levels do not occur at the selected location.')
        if value['finalLevel'] is not None and candidates and all(e['minLevel']>value['finalLevel'] for e in candidates):raise ValueError('The requested final level is below the available encounter level.')
        def ball_matches(e):
            if value['ball']['id']=='any' or value['ball']['requirement']=='preferred':return True
            if e['safari']:return value['ball']['id']=='safari-ball'
            if e['method'] in {'gift','gift-egg','only-one','pokeflute','trade'} and e['method'] in {'gift','gift-egg','trade'}:return value['ball']['id']=='poke-ball'
            return value['ball']['id']!='safari-ball'
        if candidates and not any(ball_matches(e) for e in candidates):raise ValueError('The required Poké Ball is incompatible with this acquisition method. Safari encounters require a Safari Ball.')
        eligible=[e for e in candidates if ball_matches(e)]
        capability=self.executor.capability(value) if self.executor else {'supported':False,'reason':'A farming executor has not been configured.'}
        available=set(self.executor.config()['games']) if self.executor and hasattr(self.executor,'config') else None
        from .pokemon_hunt_routes import static_encounters
        statics={e['speciesId']:e for e in static_encounters()}
        acquisitions=acquisition_routes(value,{game:catalog(game) for game in GAMES},available,statics=statics) if not capability['supported'] else []
        # A used one-time encounter is not an acquisition source for this save.
        if (capability.get('availability') or {}).get('used') is True:
            acquisitions=[r for r in acquisitions if not (r['source']['game']==value['game'] and r['source']['method']=='static' and r['source']['speciesId']==pid)]
        # Prefer an executable native source over event distributions which may
        # have a nominal 100% encounter rate in the offline catalog.
        if acquisitions:
            from .pokemon_sessions import hunt_capability
            def source_supported(route):
                src=route['source']
                candidate={**value,'game':src['game'],'speciesId':src['speciesId'],'locationId':src['id'],'moves':[],'finalLevel':None,'heldItemId':None,'abilityId':None,'gender':'any'}
                return src['game']==value['game'] and hunt_capability(candidate)['supported']
            acquisitions.sort(key=lambda route:not source_supported(route))
        acquisition=acquisitions[0] if acquisitions else None
        limitations=(['Continue the current game and prepare the selected encounter route. Each new catch is saved before the next search.'] if capability.get('setup')=='current-game' else ['Start from a stocked, prepared encounter checkpoint. Your normal game save stays separate.']) if capability['supported'] else [capability['reason']]
        if acquisition:
            # An executor's own reason (a used static, a story gate, a roamer or gift
            # refusal) stays first; the generic note is for species without one.
            limitations=[capability['reason']] if capability.get('method') and capability.get('reason') else ['A game-valid acquisition route is available. Its gift, evolution or trade steps must be connected before the complete hunt can run.']
            if not self.executor or not hasattr(self.executor,'acquisition_readiness'):limitations += [p['label'] for p in acquisition['prerequisites']]
            if any(s['kind']=='trade' for s in acquisition['steps']):limitations.append('The selected game remains the destination. Other games are used only for the required acquisition or evolution, with native trades and verified saves.')
        elif not mon['encounters']:limitations.append('No compatible acquisition route matches these requirements in the selected game and generation.')
        if value['moves']:limitations.append('Final move compatibility and any TM, tutor, breeding, or evolution resources need a combined move plan.')
        if value['shiny']=='required':
            capture_help='Safari captures use timed Safari Ball throws verified from a protected encounter checkpoint.' if eligible and all(e['safari'] for e in eligible) else 'Use a Master Ball if available; otherwise use the best available ball and safe capture preparation.'
            limitations.append('Shiny capture takes priority over nature, gender, ability, IVs, ball choice and the ball reserve. '+capture_help+' Search limits stop new attempts, not capture of a shiny already found.')
            limitations.append('RNG selection targets your nature, IV, gender and ability settings when a matching outcome is found within the search budget. Any shiny encountered is still caught; unmet preferences are reported.')
            if competitive:limitations.append('A compatible nature or ability from the competitive build guides RNG when that catch setting is unspecified. Champions stat points and final moves remain separate preparation tasks.')
        elif value['natures'] or value['minIvs'] or value['minDvs']:limitations.append('Attribute requirements filter natural encounters; they do not edit Pokémon. Their combined odds are not assumed independent.')
        if value['afterCompletion']=='prepare-trade':limitations.append('Trading requires a verified capture, native save, ownership reservation, and a selected partner.')
        request=json.loads(json.dumps(value));digest=hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        result = {'schema':'pokemon-suite/farming-plan/v1','request':request,'revision':digest,'game':dex['label'],'pokemon':{'id':pid,'name':mon['name'],'sprite':mon.get('shinySprite',mon['sprite']) if value['shiny']=='required' else mon['sprite']},'location':location,'locations':eligible,'canStart':False,'state':'needs-verification','limitations':limitations,'steps':['Verify the selected save and route prerequisites','Travel to the selected acquisition location' if location else 'Resolve a suitable acquisition route','Search for a new individual matching every required setting','Capture using the required or preferred ball','Prepare the requested final level, moves, and held item','Save in game and verify the captured identity','Prepare a trade receipt' if value['afterCompletion']=='prepare-trade' else 'Stop after saving'],'catalogRevision':dex['revision']}
        if acquisition:
            result['acquisition']=acquisition
            result['acquisitionAlternatives']=len(acquisitions)
            result['steps']=acquisition['summary']
            # Acquisition and final evolution are separate, durable stages. A
            # saved ancestor must never count as the requested finished species.
            source=acquisition['source']
            if self.executor and source['game']==value['game'] and source['speciesId']!=pid:
                constraints={}
                if request['abilityId'] is not None:constraints['abilitySlots']=[i for i,a in enumerate(mon['abilities']) if a['id']==request['abilityId']]
                if request['gender']!='any':constraints.update(gender=request['gender'],genderRate=mon['genderRate'])
                branches=[{'shift':s['personalityShift'],'modulus':s['personalityModulus'],'remainders':s['personalityRemainders']} for s in acquisition['steps'] if s.get('personalityRemainders')]
                if branches:constraints['personalityBranches']=branches
                source_request={**request,'speciesId':source['speciesId'],'locationId':source['id'],'moves':[],'finalLevel':None,'heldItemId':None,'abilityId':None,'gender':'any','afterCompletion':'stop-save'}
                if constraints:source_request['evolutionConstraints']=constraints
                if extended:source_request['competitive']=None
                source_capability=self.executor.capability(source_request)
                result['sourceStage']={'request':source_request,'name':source['name'],'game':source['game']}
                result['canStartSource']=source_capability['supported']
                if source_capability['supported']:
                    result['limitations'][0]=f"The {source['name']} acquisition step can run now. Evolution and any required trades remain pending; this step does not finish the {mon['name']} request."
                else:result['limitations'].insert(0,source_capability['reason'])
            if self.executor and hasattr(self.executor,'acquisition_readiness'):
                result['readiness']=self.executor.acquisition_readiness(acquisition)
                result['limitations'] += [r['message'] for r in result['readiness'] if r['state']!='ready']
        if capability.get('method')=='static':
            # The engine's story gates for this encounter, with the live save's state.
            met={r.get('key'):r.get('met') for r in (capability.get('availability') or {}).get('requirements',[])}
            result['prerequisites']=[{**r,'game':value['game'],'state':'ready' if met.get(r['key']) is True else 'pending' if met.get(r['key']) is False else 'unknown'} for r in capability.get('requires',[])]
            if capability.get('availability'):result['availability']=capability['availability']
        if competitive:
            result['competitive']=competitive
            result['limitations']+=competitive['notes']
        result['canStart']=capability['supported']
        result['state']='ready-to-verify' if capability['supported'] else 'unsupported'
        if capability['supported']:
            result['steps']=['Load the prepared Snorlax encounter setup','Reset natural encounters until all required attributes match','Preserve the matching encounter before capture','Catch with the required or preferred ball, keeping the reserve','Save in game and verify the captured identity','Prepare a trade receipt' if value['afterCompletion']=='prepare-trade' else 'Stop after saving']
            if value['shiny']=='required':
                result['steps'][1]='Calibrate encounter timing and target a predicted shiny RNG outcome'
                result['steps'][2]='Save a checkpoint immediately when a shiny is found'
                result['steps'][3]='Catch the shiny even if its other traits or ball differ from the request'
            if capability.get('method') in {'safari-land','wild-land'}:
                result['route']=capability['route']
                result['steps']=['Continue the current game, prepare supplies and a Sweet Scent user',f"Travel to {capability['route']['location']}",'Measure and compare current-state RNG, Teachy TV, title timing and new-seed search','Preserve the chosen encounter and catch it using the appropriate capture strategy',f"Save each new identity in game; repeat until {value['quantity']} matching Pokémon are saved",'Prepare a trade receipt' if value['afterCompletion']=='prepare-trade' else 'Stop after saving']
            elif capability.get('method')=='roamer':
                result['route']=capability['route']
                result['steps']=['Verify a Charmander save with Suicune still unreleased','Complete the National Dex and Celio quest preparation','Save before delivering the Sapphire and calibrate Suicune’s initial generation','Save the shiny roaming identity and track its native route changes','Verify a successful first-ball capture, catch it in the owning game, and save its identity']
            elif capability.get('method')=='static':
                route=result['route']=capability['route']
                result['steps']=[f"Verify the remaining {route['name']} encounter and its story prerequisites in the current FireRed game",f"Stock capture supplies and travel to {route['location']}",f"Save in game before interacting with {route['name']}",
                    'Calibrate encounter timing and target a predicted shiny RNG outcome' if value['shiny']=='required' else f"Reset the encounter until {route['name']} matches the requested attributes",
                    'Protect the matching encounter and catch it with the required or preferred ball','Save in game and verify the captured identity','Prepare a trade receipt' if value['afterCompletion']=='prepare-trade' else 'Stop after saving']
            elif capability.get('method')=='gift':
                result['route']=capability['route']
                result['steps']=['Verify the remaining Eevee gift in the current FireRed game','Travel to Celadon and save in game before receiving Eevee','Calibrate gift timing and target a natural shiny outcome' if value['shiny']=='required' else 'Receive a new Eevee matching the requested attributes','Protect the received Pokémon, decline its nickname prompt, and save in game','Verify its exact identity in party or PC storage','Prepare a trade receipt' if value['afterCompletion']=='prepare-trade' else 'Finish the hunt after saving; follow the bot’s independent run setting']
        if value['shiny']=='required':
            methods=(['current-state','teachy-tv','title-seed','seed-search','random-encounters'] if capability.get('method') in {'safari-land','wild-land'} else ['calibrated-static','natural-reset']) if capability['supported'] else []
            result['rng']={'selection':'automatic','objective':'expected-time-to-saved-capture','methods':methods,'traits':{'natures':value['natures'],'minIvs':value['minIvs'],**({'maxIvs':value['maxIvs']} if 'maxIvs' in value else {}),**({'hiddenPower':value['hiddenPower']} if 'hiddenPower' in value else {}),'gender':value['gender'],'abilityId':value['abilityId']},'preserveEveryShiny':True,'qualification':'Read the owning game’s current state, measure timing and verify the selected method before execution.'}
        if CURRENT.get():result['dataLock']=CURRENT.get().lock()
        return result

    @with_game_data
    def list_requests(self):
        with self.connection() as db:records=[json.loads(r[0]) for r in db.execute('SELECT body FROM requests WHERE substr(idempotency,1,?)!=? ORDER BY created DESC LIMIT 500',(len(COLLECTION_KEY),COLLECTION_KEY))]
        if self.executor:
            sessions={s['game']:s for s in self.executor.snapshots()}
            for r in records:
                from .data_provider import DataProvider
                try:
                    with DataProvider(getattr(self.executor,'directory',self.directory)).snapshot(r.get('plan',{}).get('dataLock')):
                        r['plan']=self.preview(r['request'])
                except ValueError as error:
                    r['plan']={**r.get('plan',{}),'canStart':False,'canStartSource':False,'limitations':[str(error)]}
                    r['state']='blocked'
                session=sessions.get(r['request']['game'],{});mission=session.get('mission')
                if mission and mission['id']==r['id']:
                    r['execution']=mission
                    r['state']=mission['state'] if session['state']!='offline' or mission['state']=='complete' else 'paused'
                elif hasattr(self.executor,'completed_hunt') and (completed:=self.executor.completed_hunt(r)):
                    r['execution']=completed;r['state']='complete'
                source=r.get('sourceTask')
                if source:
                    source_session=sessions.get(source['request']['game'],{})
                    progress=source_session.get('mission')
                    if (source_session.get('pendingHunt') or {}).get('id')==source['id']:progress=source_session['pendingHunt']
                    if not progress or progress.get('id')!=source['id']:
                        progress=self.executor.completed_hunt(source) if hasattr(self.executor,'completed_hunt') else None
                    if progress:
                        done=progress['state']=='complete'
                        r['execution']={**progress,'id':r['id'],'stage':'source','sourceSpeciesId':source['request']['speciesId'],'sourceName':source['name'],'sourceCaught':progress.get('caught',source['request']['quantity'] if done else 0),'caught':0}
                        r['state']='waiting-for-evolution' if done else 'paused' if source_session.get('state')=='offline' else progress['state']
                        r['execution'].update(state=r['state'],speciesId=r['request']['speciesId'])
                        r['plan']['canStartSource']=not done
                        if done:
                            r['plan']['canStartSource']=False
                            r['execution']['reason']=f"{source['name']} is saved in {r['plan']['game']}. The {r['plan']['pokemon']['name']} evolution and any required trades remain pending."
                            r['plan']['canContinue']=bool(source['request']['game']=='firered' and r['request']['quantity']==1 and hasattr(self.executor,'continue_acquisition'))
                            bot=source_session.get('bot') or {}
                            if (bot.get('preparation') or {}).get('requestId')==r['id']:
                                preparation=bot.get('preparation') or {}
                                ready=preparation.get('phase')=='complete'
                                r['plan']['canContinue']=not ready
                                if bot.get('enabled') and not ready and bot.get('status')!='waiting':
                                    r['state']='preparing-evolution'
                                    r['execution'].update(state=r['state'],stage='evolution-preparation',phase='game-prerequisites')
                                progress=source_session.get('gameProgress') or {}
                                count=progress.get('ownedSpecies')
                                phase=preparation.get('phase')
                                detail={'friendship':'Building friendship through game steps.','preparing-stats':'Preparing the evolution’s Attack and Defense requirements.','evolving':'Preparing and performing the evolution.','saving':'Verifying the evolved Pokémon in a native save.','sevii-link-quest':'Completing Celio’s Ruby and Sapphire quest to unlock transfers.','link-unlocked':'FireRed’s link requirements are complete.','preparing-transfer':'Withdrawing the saved Pokémon, healing the party, and saving before transfer.','waiting-for-transfer':'Waiting for the required compatible game and complete native trade.'}.get(phase)
                                if not detail:detail='Preparing FireRed’s National Pokédex'+(f" ({count}/60 species owned)." if isinstance(count,int) and count<60 else '.') if phase in (None,'national-dex') or preparation.get('kind')=='national-dex' else 'Preparing the next evolution step.'
                                r['execution']['reason']=f"{source['name']} is saved. "+detail
                                r['execution']['phase']=phase or 'game-prerequisites'
                                if bot.get('status')=='waiting' and bot.get('reason'):r['execution']['reason']=bot['reason']+' '+r['execution']['reason']
                            for game,partner in sessions.items():
                                partner_bot=partner.get('bot') or {}
                                partner_preparation=partner_bot.get('preparation') or {}
                                if game==source['request']['game'] or partner_bot.get('mode')!='evolution-partner' or partner_preparation.get('requestId')!=r['id']:continue
                                if (bot.get('preparation') or {}).get('requestId')!=r['id'] or (bot.get('preparation') or {}).get('phase')!='waiting-for-transfer':continue
                                r['execution']['companion']={'game':game,'phase':partner_preparation.get('phase'),'objective':partner_preparation.get('objective'),'gameProgress':partner.get('gameProgress') or {}}
                                if partner_bot.get('enabled') and partner_preparation.get('phase')=='preparing' and partner.get('state')!='offline':
                                    r['state']='preparing-evolution'
                                    r['execution'].update(state=r['state'],stage='evolution-preparation',phase='companion-preparation',reason=f"{source['name']} is saved in FireRed. Preparing {game.title()} for the required evolution and return trade.")
                                elif partner_preparation.get('reason'):
                                    r['execution']['reason']=partner_preparation['reason']+' '+r['execution']['reason']
                            local=source_session.get('localEvolution') or {}
                            if local.get('requestId')==r['id'] and local.get('phase')!='complete':
                                phase=local.get('phase');leg=local.get('leg');receiving=(sessions.get('emerald',{}).get('localEvolution') or {})
                                receiving=receiving if receiving.get('requestId')==r['id'] else {}
                                training=(local.get('pausedPhase') if phase in ('waiting-for-peer','paused') else phase)=='waiting-for-evolution'
                                stopped=phase in ('waiting','paused','waiting-for-peer') or not bot.get('enabled') or source_session.get('state')=='offline'
                                r['state']='paused' if stopped else 'preparing-evolution'
                                detail=local.get('reason')
                                if not detail:
                                    if training:
                                        progress=receiving.get('progress') or {};friendship=progress.get('friendship');required=progress.get('required',220)
                                        detail=f"Preparing the saved Pokémon for evolution in Emerald"+(f" — friendship {friendship}/{required}." if isinstance(friendship,int) else '.')
                                        if isinstance(progress.get('beauty'),int):
                                            stage=str(progress.get('stage','preparing')).replace('-',' ')
                                            detail=f"Feebas: {stage} — Beauty {progress['beauty']}/170, Sheen {progress.get('sheen',0)}/255; {progress.get('blocksBlended',0)} blocks blended, {progress.get('blocksFed',0)} fed."
                                        if receiving.get('reason'):detail=receiving['reason']
                                    elif leg=='return':detail='Returning the evolved Pokémon to FireRed; verifying both native saves and the complete link exit.'
                                    else:detail='Trading the saved source from FireRed to Emerald; verifying both native saves and the complete link exit.'
                                r['execution'].update(state=r['state'],stage='evolution-preparation',phase='native-evolution' if training else 'native-return-trade' if leg=='return' else 'native-outbound-trade',currentGame='emerald' if training or leg=='return' else 'firered',reason=detail,caught=0)
                                r['plan']['canContinue']=False
                            r['plan']['limitations'][0]=r['execution']['reason']
                if hasattr(self.executor,'completed_acquisition') and (completed:=self.executor.completed_acquisition(r)):
                    r['state']='complete';r['execution']={**completed,'stage':'evolution','sourceCaught':r.get('execution',{}).get('sourceCaught',1)}
                    r['plan']['canContinue']=False;r['plan']['canStartSource']=False
        return records

    @with_game_data
    def save(self, request, idempotency):
        if not isinstance(idempotency,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}',idempotency):raise ValueError('A valid request identifier is required.')
        plan=self.preview(request);record={'id':str(uuid.uuid4()),'state':'prepared','createdAt':time.time(),'request':plan['request'],'plan':plan}
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            prior=db.execute('SELECT digest,body FROM requests WHERE idempotency=?',(idempotency,)).fetchone()
            if prior:
                if prior[0]!=plan['revision']:raise ValueError('This request identifier was already used with different settings.')
                return json.loads(prior[1])
            collection=idempotency.startswith(COLLECTION_KEY)
            if db.execute('SELECT COUNT(*) FROM requests WHERE (substr(idempotency,1,?)=?)=?',(len(COLLECTION_KEY),COLLECTION_KEY,int(collection))).fetchone()[0]>=500:raise ValueError('Remove a saved request before adding another.')
            db.execute('INSERT INTO requests VALUES (?,?,?,?,?)',(record['id'],idempotency,plan['revision'],json.dumps(record),record['createdAt']))
        return record

    def remove(self, identifier):
        with self.lock:
            record=self.get(identifier)
            task=record.get('sourceTask',record)
            if self.executor:
                for session in self.executor.snapshots():
                    if (session.get('pendingHunt') or {}).get('id')==task['id']:raise ValueError('Stop the queued hunt before removing its request.')
                    mission=session.get('mission')
                    if mission and mission['id']==task['id']:
                        if mission['state']=='running' and session['state']!='offline':raise ValueError('Stop the hunt before removing its request.')
                        if mission.get('protected') and mission['state']!='complete':raise ValueError('This request protects a found Pokémon. Resolve that encounter before removing it.')
                        self.executor.command(task['request']['game'],{'type':'archive','id':task['id']})
            with self.connection() as db:
                if db.execute('DELETE FROM requests WHERE id=?',(identifier,)).rowcount!=1:raise ValueError('Saved request not found.')

    def get(self, identifier):
        with self.connection() as db:row=db.execute('SELECT body FROM requests WHERE id=?',(identifier,)).fetchone()
        if not row:raise ValueError('Saved request not found.')
        return json.loads(row[0])

    @with_game_data
    def start(self, identifier, *, retry_blocked_policy=False):
        with self.lock:
            record=self.get(identifier)
            if not self.executor:raise ValueError('Automatic farming is not enabled without a configured game session.')
            # The HTTP Start action is an explicit retry. Background collection
            # starts keep their durable automatic recovery limits.
            def execute(task):
                return self.executor.start({**task,'retryBlockedPolicy':True} if retry_blocked_policy else task)
            if record.get('sourceTask'):
                current=next((r for r in self.list_requests() if r['id']==identifier),record)
                if current['state'] in ('waiting-for-evolution','preparing-evolution'):
                    if current['plan'].get('canContinue'):return self.executor.continue_acquisition(record,current['plan']['acquisition'])
                    raise ValueError('The source Pokémon is already saved. Evolution and any required native trades remain pending.')
                return {**execute(record['sourceTask']),'stage':'source','destination':record['request']['speciesId']}
            plan=self.preview(record['request'])
            if plan['canStart']:return execute(record)
            if not plan.get('canStartSource'):raise ValueError(plan['limitations'][0])
            stage=plan['sourceStage']
            record['sourceTask']={'id':identifier+'-source','request':stage['request'],'name':stage['name'],'destination':plan['acquisition']['destination'],
                'continuation':{'requestId':identifier,'sourceId':identifier+'-source','request':record['request'],'route':plan['acquisition']}}
            with self.connection() as db:
                db.execute('UPDATE requests SET body=? WHERE id=?',(json.dumps(record),identifier))
            return {**execute(record['sourceTask']),'stage':'source','destination':record['request']['speciesId']}

    def stop(self, identifier):
        with self.lock:
            if not self.executor:raise ValueError('No game session is configured.')
            record=self.get(identifier)
            return self.executor.stop(record.get('sourceTask',record))
