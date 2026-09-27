"""Read-only PC inventory and physical wireless trade readiness."""
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import threading
import time
from .paths import ROOT
from .inventory_sources import InventorySources
from .trade_state import native_trade_finished

def trade_blocker(game,live,radio):
    if game!='firered':return 'Direct Switch trading is currently implemented for the FireRed route only.'
    if not live or live.get('state') in {'offline','closed'}:return 'Start this game to prepare a trade.'
    campaign=live.get('campaign') or {}
    if campaign and campaign.get('status')!='complete':return 'This save has an unfinished story run. Finish it or choose a different save before trading.'
    trade=live.get('nativeTrade') or {}
    if not native_trade_finished(trade):return 'Finish or resolve the current exchange before selecting another Pokémon.'
    local=live.get('localEvolution') or {}
    if local and local.get('phase')!='complete':return 'Finish the reserved evolution round trip first.'
    if not radio.get('ready'):return radio.get('reason') or 'The wireless radio is not ready yet.'
    support=live.get('tradeSupport') or {}
    if not support.get('nativeRadio'):return 'This save is not using the qualified wireless emulator and compatibility cartridge yet.'
    if radio.get('transport')=='appliance' and not support.get('radioAppliance'):return 'Apply the wireless bot update in Settings → Updates before preparing this save.'
    if not support.get('inventory'):return 'This game owner needs the inventory trading update before it can accept a selection.'
    if not support.get('inventoryReady',support.get('missionReady')):return support.get('inventoryReason') or 'Finish the current capture and save before preparing its trade lobby.'
    if live.get('state')=='running' and (live.get('bot') or {}).get('enabled',True):return 'Stop the current bot task before selecting a Pokémon to trade.'
    return None

def radio_arguments(config):
    if not isinstance(config,dict) or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*',config.get('host','')):raise ValueError('Configure the radio host as user@host.')
    known=config.get('knownHosts')
    if not isinstance(known,str) or not Path(known).is_file():raise ValueError('Choose the verified SSH host-key file for the radio.')
    args=['ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known]
    if config.get('bindAddress'):
        try:address=str(ipaddress.ip_address(config['bindAddress']))
        except ValueError as error:raise ValueError('Choose a valid local interface address for the radio.') from error
        args+=['-b',address]
    return args+[config['host']]

RADIO_PROBE='''test -f "$HOME/pokemon-suite-radio/serve.py" && test -x "$HOME/pokemon-suite-radio/venv/bin/python" && test -s "$HOME/.switch/prod.keys" && sudo -n true && lsusb -d 2357:012d | grep -q 2357:012d && iw dev | grep -q Interface && printf 'suite-radio-ready\\n' '''

class TradingLibrary:
    def __init__(self,sessions):
        self.sessions=sessions;self.lock=threading.RLock();self.cache={};self.radio_checks={};self.radio_pending=set()
        self.sources=InventorySources(sessions)

    def radio_config(self,game):
        cfg=self.sessions.config().get('games',{}).get(game,{})
        path=self.sessions.directory/game/'wireless.json'
        config={**(cfg.get('nativeRadio') or {}),**(json.loads(path.read_text()) if path.is_file() else {})}
        runtime=self.sessions.config().get('radioRuntime') or {}
        if runtime.get('root'):
            config.setdefault('transport','appliance');config['runtime']=runtime['root']
        return config

    def set_radio_keys(self,game,path):
        from .radio_appliance import read_credentials
        from .suite_save_store import atomic_file
        if game!='firered' or game not in self.sessions.config()['games']:raise ValueError('Choose installed FireRed for wireless trading.')
        path=str(Path(path).resolve());read_credentials(path)
        settings=self.sessions.directory/game/'wireless.json';settings.parent.mkdir(parents=True,exist_ok=True)
        with self.lock:
            value=json.loads(settings.read_text()) if settings.is_file() else {}
            value.update(transport='appliance',keysPath=path)
            atomic_file(settings,json.dumps(value).encode());self.radio_checks.pop(game,None)

    def radio_status(self,game):
        config=self.radio_config(game)
        if config.get('transport')=='appliance':
            from .radio_appliance import readiness
            return {**readiness(config),'transport':'appliance'}
        try:radio_arguments(config)
        except ValueError as error:return {'ready':False,'configured':False,'reason':str(error)}
        cached=self.radio_checks.get(game)
        if cached and cached['config']==config and time.time()-cached['time']<60:return cached['result']
        with self.lock:
            if game not in self.radio_pending:
                self.radio_pending.add(game)
                def refresh():
                    try:self.check_radio(game)
                    except (ValueError,OSError,subprocess.SubprocessError):
                        self.radio_checks[game]={'config':config,'time':time.time(),'result':{'ready':False,'configured':True,'state':'unavailable','reason':'The configured wireless relay is unavailable.'}}
                    finally:
                        with self.lock:self.radio_pending.discard(game)
                threading.Thread(target=refresh,daemon=True).start()
        return {'ready':False,'configured':True,'state':'checking','reason':'Connecting to the wireless relay…'}

    def check_radio(self,game):
        if game!='firered' or game not in self.sessions.config()['games']:raise ValueError('Choose configured FireRed for the wireless check.')
        config=self.radio_config(game)
        if config.get('transport')=='appliance':
            from .radio_appliance import readiness
            return {**readiness(config),'transport':'appliance'}
        args=radio_arguments(config)
        try:
            result=subprocess.run(args+[RADIO_PROBE],capture_output=True,text=True,timeout=12)
            ready=result.returncode==0 and result.stdout.strip()=='suite-radio-ready'
            reason='Wireless relay connected.' if ready else 'The wireless relay is unavailable. Connect the Archer adapter and start the configured Linux relay.'
        except subprocess.TimeoutExpired:ready=False;reason='The wireless relay did not respond. Connect the Archer adapter and start the configured Linux relay.'
        checked={'ready':ready,'configured':True,'state':'ready' if ready else 'unavailable','reason':reason,'host':config['host'],'checkedAt':time.time()}
        self.radio_checks[game]={'config':config,'time':time.time(),'result':checked};return checked

    def _snapshot(self,game,source=None):
        source=source or self.sources.resolve(game,'current')
        if source.get('error'):raise ValueError(source['error'])
        config=self.sessions.config();folder=self.sessions.directory/game
        node=config.get('node','node');profile_id=None
        if source['kind']=='saved':
            library=Path(source['library']);config={**json.loads((library/'config.json').read_text()),'directory':str(library)}
            profile_id=source['profileId'];pointer=library/game/'save-profiles'/profile_id/'current.json'
        else:
            active_path=folder/'active-hunt.json';active=json.loads(active_path.read_text()) if active_path.is_file() else None
            if active and not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',active.get('id','')):raise ValueError('The active save identifier is invalid.')
            cfg=config['games'][game];native=active and (active.get('nativeRadio') is True or (cfg.get('nativeRadio') or {}).get('huntId')==active['id'])
            pointer=(folder/'hunts'/active['id']/('native-radio/saves' if native else 'saves') if active else folder/'saves')/'current.json'
        key=(json.dumps(config,sort_keys=True),pointer.read_bytes() if pointer.is_file() else b'')
        cache_id=(game,source['id'])
        with self.lock:
            cached=self.cache.get(cache_id)
            if cached and cached[0]==key:return cached[1]
            payload={'config':config,'game':game,**({'profileId':profile_id} if profile_id else {})}
            result=subprocess.run([node,str(ROOT/'engine/firered/src/suite/inventory-cli.js')],input=json.dumps(payload),capture_output=True,text=True,timeout=30)
            if result.returncode:raise ValueError(result.stderr.strip()[-1000:] or 'The saved PC inventory could not be read.')
            snapshot=json.loads(result.stdout)
            if snapshot.get('schema')!='pokemon-suite/inventory/v1' or snapshot.get('game')!=game:raise ValueError('The inventory reader returned the wrong game.')
            self.cache[cache_id]=(key,snapshot);return snapshot

    def select_source(self,game,identifier):
        if game not in self.sessions.config()['games']:raise ValueError('Choose an installed game.')
        self.sources.select(game,identifier)

    def add_source(self,game,path):
        if game!='firered' or game not in self.sessions.config()['games']:raise ValueError('Choose installed FireRed for this saved collection.')
        record=self.sources.record(game,path)
        snapshot=self._snapshot(game,record)
        if snapshot.get('validity')!='valid':raise ValueError('The saved party and boxes could not be verified.')
        return self.sources.link(game,record)

    def inventory(self,game,source_id=None):
        if game not in self.sessions.config()['games']:return {'game':game,'supported':False,'pokemon':[],'reason':'Install this game to read its PC.'}
        if game!='firered':return {'game':game,'supported':False,'pokemon':[],'reason':'Verified PC inventory reading is currently available for FireRed.'}
        from .pokemon_farming import catalog
        source=self.sources.resolve(game,source_id);is_active=source['kind']=='current'
        source_info={'sourceId':source['id'],'saveLabel':source['label'],'isActiveSave':is_active,
                     'sources':[{k:p[k] for k in ['id','label','kind']} for p in self.sources.list(game)]}
        radio=self.radio_status(game)
        try:snapshot=self._snapshot(game,source)
        except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:
            return {'game':game,'supported':True,'validity':'unknown','pokemon':[],'reason':str(error),'radio':radio,**source_info}
        live=self.sessions._live(game) if is_active else None
        blocker=trade_blocker(game,live,radio) if is_active else 'You are browsing a preserved save. Load this collection as the active game before preparing a trade.'
        dex=catalog(game);species={p['id']:p for p in dex['species']};moves={m['id']:m for m in dex['moves']}
        records=[]
        for original in snapshot['pokemon']:
            p=dict(original);entry=species.get(p.get('nationalSpeciesId'),{});abilities=entry.get('abilities',[])
            reason='The individual has a duplicate identity in this save.' if p.get('identityConflict') else 'Egg trading is not qualified for this route.' if p.get('isEgg') else blocker
            p.update(name=entry.get('name',f"Species {p['species']}"),types=entry.get('types',[]),
                natureName=(p.get('nature') or {}).get('name'),ability=abilities[min(p.get('abilityNum',0),len(abilities)-1)]['name'] if abilities else None,
                moveDetails=[{'id':m,'name':moves.get(m,{}).get('name',f'Move {m}'),'pp':p.get('pp',[])[i] if i<len(p.get('pp',[])) else None} for i,m in enumerate(p.get('moves',[])) if m],canTrade=reason is None,tradeReason=reason,
                canPrepare=not p.get('identityConflict') and not p.get('isEgg') and snapshot.get('validity')=='valid' and (not is_active or not live or trade_blocker(game,live,{**radio,'ready':True}) is None))
            records.append(p)
        return {**snapshot,**source_info,'supported':True,'pokemon':records,'sessionId':(live or {}).get('sessionId'),
            'radio':radio,'tradeReason':blocker,'trade':(live or {}).get('nativeTrade'),'preparation':(live or {}).get('tradePreparation')}

    def trade_plan(self,game,identifier,source_id):
        if not isinstance(identifier,str) or not re.fullmatch('[a-f0-9]{64}',identifier):raise ValueError('Select a Pokémon from the PC inventory.')
        source=self.sources.resolve(game,source_id)
        current=self.inventory(game,source_id)
        selected=next((p for p in current.get('pokemon',[]) if p['id']==identifier),None)
        if not selected or not selected.get('canPrepare'):raise ValueError((selected or {}).get('tradeReason') or 'This individual is no longer available in the selected save.')
        return {'game':game,'pokemonId':identifier,'sourceId':source_id,
                'load':{'libraryPath':source['library'],'profileId':source['profileId']} if source['kind']=='saved' else None}

    def trade(self,game,identifier,session_id,source_id='current'):
        if source_id!='current':raise ValueError('Load this saved collection as the active game before trading one of its Pokémon.')
        if not isinstance(identifier,str) or not re.fullmatch('[a-f0-9]{64}',identifier):raise ValueError('Select a Pokémon from the current PC inventory.')
        current=self.inventory(game,source_id)
        if not session_id or current.get('sessionId')!=session_id:raise ValueError('The game session changed. Refresh the inventory before trading.')
        selected=next((p for p in current['pokemon'] if p['id']==identifier),None)
        if not selected or not selected.get('canTrade'):raise ValueError((selected or {}).get('tradeReason') or 'This Pokémon is no longer available for trading.')
        return self.sessions.command(game,{'type':'trade-pokemon','pokemonId':identifier},session_id=session_id)
