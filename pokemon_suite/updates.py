"""Session-aware update coordinator. No save rollback after releasing gameplay."""
import hashlib
import json
from pathlib import Path
import threading
import time
import uuid
from .packages import PackageStore
from .update_journal import UpdateJournal
from .suite_save_store import atomic_file


class UpdateManager:
    def __init__(self,sessions):
        self.sessions=sessions;self.directory=sessions.directory
        self.store=PackageStore(self.directory);self.journal=UpdateJournal(self.directory/'packages')
        self.lock=threading.Lock();self.thread=None;self.closed=threading.Event()
    def status(self):
        return {**self.store.status(),'updates':self.journal.recent(),
                'policy':'qualification-pinned','message':'Active runs keep their versions. Applying an engine update during a campaign records an intervention.'}
    def install(self,path):return self.store.install(path)
    def activate(self,game,target):
        from .pokemon_main_series import MAIN_GAMES
        if game not in MAIN_GAMES:raise ValueError('Choose a game in the Suite catalog.')
        manifest=self.store.verify(target)
        if manifest['kind']=='data':
            from .data_provider import validate_data
            prefix=manifest.get('entrypoints',{}).get('data')
            if not prefix:raise ValueError('The data package is missing its data entrypoint.')
            for entry in manifest['files']:
                if entry['path'].startswith(prefix+'/') and entry['path'].endswith('.json'):
                    name=entry['path'][len(prefix)+1:]
                    validate_data(name,json.loads((self.store.objects/target/entry['path']).read_text()),game)
        result=self.store.activate(game,target)
        return {'lock':result['lock'],'effect':'new-plans' if result['manifest']['kind']=='data' else 'new-game-profiles'}
    def apply(self,game,target,request_id,*,allow_intervention=False):
        with getattr(self.sessions,'lock',threading.RLock()):
            return self._apply(game,target,request_id,allow_intervention=allow_intervention)

    def _apply(self,game,target,request_id,*,allow_intervention=False):
        if game not in self.sessions.config()['games']:raise ValueError('Choose a configured game.')
        if self._is_partner(game):raise ValueError(f'A trade partner runs {self._title(game)}’s engine and follows its updates. Apply the update to {self._title(game)}.')
        graph=self.store._graph(target,game)
        if graph[0]['kind'] not in {'engine','planner','game','emulator'}:raise ValueError('Data packages are activated for new plans without a game handoff.')
        manifest=self.store.verify(target)
        if graph[0]['kind'] in {'engine','planner'} and 'pokemon-suite/campaign-state/v1' not in manifest['stateSchemas']:raise ValueError('This engine cannot read the current campaign state schema.')
        live=self.sessions._live(game)
        if graph[0]['kind'] in {'game','emulator'}:
            if live:raise ValueError('Stop this game before applying an observation-resource or emulator update.')
            from .runtime_components import apply_component
            config=self.sessions.config();resolved={'manifest':manifest,'lock':{'schema':'pokemon-suite/run-lock/v1','game':game,'packages':graph},**{k:str(self.store.objects/target/v) for k,v in manifest['entrypoints'].items()}}
            apply_component(config,game,resolved)
            if graph[0]['kind']=='emulator':
                cfg=config['games'][game]
                core_hash=json.loads((Path(cfg['core'])/'build-manifest.json').read_text())['mgba_wasm_sha256'] if cfg.get('backend','wasm')=='wasm' else cfg['coreSha256']
                paths=[self.directory/game/'saves/current.json']
                active=self.directory/game/'active-hunt.json'
                if active.exists():
                    identifier=json.loads(active.read_text())['id']
                    from .packages import path_name
                    path_name(identifier)
                    if '/' in identifier:raise ValueError('Invalid active save identity.')
                    paths.append(self.directory/game/'hunts'/identifier/'saves/current.json')
                if any(json.loads(p.read_text())['identity']['coreSha256']!=core_hash for p in paths if p.exists()):raise ValueError('This core differs from the saved checkpoint. A qualified native-save migration is required; the current selection and saves remain intact.')
        if live and self.sessions.config()['games'][game].get('backend') in {'libretro','desktop'}:raise ValueError('This playback adapter requires an orderly game close before software updates.')
        if live and (live.get('runtime') or {}).get('protocol')!=1:raise ValueError('This owner needs the initial app update before it can hand off safely. Its current game keeps running.')
        if live and live.get('campaign') and not allow_intervention:raise ValueError('This campaign pins its software for qualification. Explicitly allow a recorded intervention to update it.')
        with self.lock:
            existing=[r for r in self.journal.recent() if r['game']==game and r['state'] in {'created','verified','waiting','checkpointed','activating','healthy'} and r['requestId']!=request_id]
            if existing:raise ValueError('This game already has an update in progress.')
            r=self.journal.create(game,target,request_id)
            if r['state']=='created':r=self.journal.transition(r['id'],r['revision'],'verified',{'allowIntervention':allow_intervention,'kind':graph[0]['kind']})
            if r['state']=='verified':
                if not live:
                    resolved=self.store.activate(game,target)
                    path=self._selection_path(game);selection=json.loads(path.read_text()) if path.exists() else {'lock':None}
                    if graph[0]['kind'] in {'game','emulator'}:selection.setdefault('componentLocks',{})[graph[0]['kind']]=resolved['lock']
                    else:selection['plannerLock' if graph[0]['kind']=='planner' else 'lock']=resolved['lock']
                    self._selection(game,selection)
                    partners=self._follow_partners(game,target,r) if graph[0]['kind']=='engine' else {}
                    r=self.journal.transition(r['id'],r['revision'],'activated',{'reason':'Selected for the next game launch.',**({'partners':partners} if partners else {})})
                else:r=self.journal.transition(r['id'],r['revision'],'waiting',{'sessionId':live['sessionId'],'reason':'Waiting for a stable field and completed transactions.'})
        # The update thread takes this lock; start it after releasing it. An
        # immediately activated title starts it only for a partner handoff.
        if r['state']!='activated' or any(p.get('state')=='handoff' for p in r['detail'].get('partners',{}).values()):self.start()
        return r
    def _selection_path(self,game):return self.directory/game/'runtime-selection.json'
    def _selection(self,game,value):atomic_file(self._selection_path(game),json.dumps(value).encode())
    # A declared trade partner (a second FireRed owner) resolves its packages
    # by its cartridge title but pins them in its own owner directory. The
    # updater targets title owners only, so each engine update of a title is
    # carried to that title's partners: both owners of a paired exchange run
    # the same engine and pair protocol.
    def _title(self,game):
        title=getattr(self.sessions,'title',None)
        return title(game) if title else game
    def _is_partner(self,game):
        check=getattr(self.sessions,'is_partner',None)
        return bool(check and check(game))
    def _partners(self,title):
        owners=getattr(self.sessions,'partner_owners',None)
        return [owner for owner,t in (owners() if owners else []) if t==title and owner!=title]
    def _owner_running(self,game):
        pid=getattr(self.sessions,'_owner_pid',None)
        return bool(self.sessions._live(game) or pid and pid(game) is not None)
    @staticmethod
    def _partner_idle(live):
        # Idle for commands with no local evolution (paired exchange) in progress.
        bot=live.get('bot') or {};local=(live.get('localEvolution') or {}).get('phase')
        prepared=(bot.get('preparation') or {}).get('phase')
        return (bot.get('awaitingCommand') is True or bot.get('status')=='ready') and local in (None,'complete') and prepared not in {'preparing','ready-for-transfer'}
    def _pin_partner(self,owner,title,target):
        # Selected for the partner's next launch; its save is never touched.
        lock={'schema':'pokemon-suite/run-lock/v1','game':title,'packages':self.store._graph(target,title)}
        path=self._selection_path(owner)
        if not path.exists():return 'follows-active'
        selection=json.loads(path.read_text())
        if selection.get('lock')==lock:return 'current'
        self._selection(owner,{**selection,'lock':lock});return 'pinned'
    def _follow_partners(self,title,target,source):
        if self._is_partner(title):return {}
        return {owner:self._follow(owner,title,target,source) for owner in self._partners(title)}
    def _follow(self,owner,title,target,source):
        try:
            live=self.sessions._live(owner) or {};running=self._owner_running(owner)
            u=(live.get('runtime') or {}).get('update') or {}
            request='partner-'+hashlib.sha256(f"{source['id']}:{owner}".encode()).hexdigest()[:32]
            for other in self.journal.recent():
                if other['game']!=owner or other['id']==source['id'] or other['requestId']==request or other['state'] not in {'waiting','checkpointed','activating','healthy'}:continue
                if other['state']=='waiting' and live and not (u.get('id')==other['id'] and u.get('held')):
                    # Supersede an earlier handoff the live partner has not held for.
                    if u.get('id')==other['id']:self.sessions.command(owner,{'type':'cancel-update','updateId':other['id']},session_id=live['sessionId'])
                    self.journal.transition(other['id'],other['revision'],'cancelled',{'reason':f'Superseded by a newer {title} engine update.'})
                    continue
                # Held, mid-handoff, or stopped mid-handoff: that handoff
                # finishes first (after the partner's next launch if it
                # stopped); the partner then follows this engine.
                return {'state':'deferred','update':other['id']}
            if not running:return {'state':self._pin_partner(owner,title,target)}
            if ((live.get('runtime') or {}).get('lock') or {}).get('packages')==self.store._graph(target,title):
                return {'state':self._pin_partner(owner,title,target)}
            # A running partner hands off through its own journaled checkpoint,
            # which it only reaches while idle; its pin changes at that handoff
            # so a rollback restores the previous one.
            r=self.journal.create(owner,target,request)
            if r['state']=='created':r=self.journal.transition(r['id'],r['revision'],'verified',{'kind':'engine','partnerOf':title,'sourceUpdate':source['id']})
            if r['state']=='verified':r=self.journal.transition(r['id'],r['revision'],'waiting',{'sessionId':live.get('sessionId'),'reason':'Waiting until the trade partner is idle with no paired exchange in progress.'})
            return {'state':'handoff','update':r['id']}
        except Exception as error:return {'state':'failed','reason':str(error)}
    def _title_engine(self,title):
        # The engine the title owner itself was last handed off to.
        path=self._selection_path(title);lock=json.loads(path.read_text()).get('lock') if path.exists() else None
        return (lock or {}).get('packages',[{}])[0].get('digest') if (lock or {}).get('game')==title else None
    def _retire(self,game,session_id):
        live=self.sessions._live(game)
        if live and live.get('sessionId')!=session_id:raise ValueError('Another owner replaced the update session.')
        if live:
            if not live.get('runtime',{}).get('update',{}).get('held'):raise ValueError('The game has not released its inputs for updating.')
            atomic_file(self.directory/game/'command.json',json.dumps({'type':'shutdown','sessionId':session_id,'commandId':uuid.uuid4().hex}).encode())
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            if not self.sessions._live(game) and not (self.directory/game/'owner.lock').exists():return
            if self.closed.wait(.1):raise ValueError('The update service is closing; the checkpoint remains held.')
        raise ValueError('The previous owner has not finished saving and closing.')
    def step(self,r):
        game=r['game'];live=self.sessions._live(game);state=r['state'];partner=r['detail'].get('partnerOf')
        if state=='waiting':
            # A stopped or starting partner continues this handoff after its
            # next launch (also when it was held at this checkpoint).
            if partner and not live:return
            if not live:raise ValueError('The game owner stopped before acknowledging the update checkpoint.')
            u=live.get('runtime',{}).get('update',{})
            # Never while a paired exchange is in progress: the partner gets its
            # checkpoint request only while idle (its worker also holds only at
            # an idle field boundary).
            if partner and u.get('id')!=r['id'] and not self._partner_idle(live):return
            if u.get('id')!=r['id']:
                self.sessions.command(game,{'type':'prepare-update','updateId':r['id']},session_id=live['sessionId']);return
            if not u.get('held'):return
            path=self._selection_path(game);previous=json.loads(path.read_text()) if path.exists() else {'lock':None}
            self.journal.transition(r['id'],r['revision'],'checkpointed',{'checkpoint':u['checkpoint'],'previous':previous,'sessionId':live['sessionId']});return
        if state=='checkpointed':
            self.journal.transition(r['id'],r['revision'],'activating',{});return
        if state=='activating':
            target=self.store.verify(r['target'])
            if target['kind']=='planner':
                if not live:raise ValueError('The game owner disappeared during planner handoff.')
                graph=self.store._graph(r['target'],game);lock={'schema':'pokemon-suite/run-lock/v1','game':game,'packages':graph}
                current=(live.get('runtime',{}).get('plannerLock') or {}).get('packages') or [{}]
                if current[0].get('digest')!=r['target']:
                    module=str(self.store.objects/r['target']/target['entrypoints']['campaignPlanner'])
                    live=self.sessions.command(game,{'type':'replace-planner','updateId':r['id'],'module':module,'lock':lock},session_id=live['sessionId'])
                self._selection(game,{**r['detail']['previous'],'plannerLock':lock})
                self.journal.transition(r['id'],r['revision'],'healthy',{'candidateSessionId':live['sessionId']});return
            if live and (live.get('runtime',{}).get('lock') or {}).get('packages',[{}])[0].get('digest')!=r['target']:
                self._retire(game,live['sessionId']);live=None
            if not live:
                title=partner or game;graph=self.store._graph(r['target'],title)
                self._selection(game,{**r['detail']['previous'],'lock':{'schema':'pokemon-suite/run-lock/v1','game':title,'packages':graph}})
                live=self.sessions.ensure(game,update_hold=True)
            runtime=live.get('runtime') or {};u=runtime.get('update') or {}
            packages=(runtime.get('lock') or {}).get('packages') or [{}]
            if runtime.get('protocol')!=1 or packages[0].get('digest')!=r['target'] or not u.get('held'):
                raise ValueError('The candidate did not confirm its package version and held inputs.')
            self.journal.transition(r['id'],r['revision'],'healthy',{'candidateSessionId':live['sessionId']});return
        if state=='healthy':
            if not live or live['sessionId']!=r['detail']['candidateSessionId']:raise ValueError('The verified owner disappeared. Its checkpoint is preserved for recovery.')
            if live.get('runtime',{}).get('update',{}).get('held'):
                # Record intervention before any gameplay can continue, even if
                # the service exits between release and the journal receipt.
                atomic_file(self.directory/game/('intervention-'+r['id']+'.json'),json.dumps({'schema':'pokemon-suite/intervention/v1','update':r['id'],'target':r['target'],'checkpoint':r['detail']['checkpoint'],'at':time.time()}).encode())
                self.sessions.command(game,{'type':'resume-update','updateId':r['id']},session_id=live['sessionId'])
            if not partner:self.store.activate(game,r['target'])
            # The title runs the new engine now; its declared partners follow.
            partners=self._follow_partners(game,r['target'],r) if not partner and r['detail'].get('kind')=='engine' else {}
            # A partner whose title moved on during this handoff follows again.
            current=self._title_engine(partner) if partner else None
            follow=self._follow(game,partner,current,r) if current and current!=r['target'] else None
            self.journal.transition(r['id'],r['revision'],'resumed',{'reason':'Verified worker resumed from the owning checkpoint.',**({'partners':partners} if partners else {}),**({'follow':follow} if follow else {})})
    def recover(self,identifier):
        with self.sessions.lock:
            row=self.journal.get(identifier)
            if row['state']!='failed':raise ValueError('Choose an update that needs recovery.')
            game=row['game'];live=self.sessions._live(game)
            if not live:
                # A failed launch may already have restored the previous
                # executable selection. Never restore or rewrite game data.
                if not row['detail'].get('previous'):raise ValueError('This update has no acknowledged checkpoint to recover.')
                self._selection(game,row['detail']['previous'])
                live=self.sessions.ensure(game,update_hold=True)
            runtime=live.get('runtime') or {};update=runtime.get('update') or {}
            checkpoint=update.get('checkpoint') or {}
            if not update.get('held') or checkpoint.get('id')!=identifier:raise ValueError('The owner is no longer held at this update checkpoint. Its gameplay will not be rewound.')
            self.sessions.command(game,{'type':'resume-update','updateId':identifier},session_id=live['sessionId'])
            return self.journal.transition(identifier,row['revision'],'recovered',{'reason':'Resumed the verified held owner without rewinding its game save.'})

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():return
            self.thread=threading.Thread(target=self._run,name='suite-updates',daemon=True);self.thread.start()
    def _run(self):
        while not self.closed.is_set():
            for row in self.journal.recent():
                if row['state'] not in {'waiting','checkpointed','activating','healthy'}:continue
                try:
                    with self.sessions.lock:self.step(row)
                except Exception as error:
                    current=self.journal.get(row['id'])
                    detail={'reason':str(error)}
                    # Never rewind game data. Only restore the old executable
                    # while both owners are fenced before the first input.
                    if current['state']=='activating' and current['detail'].get('kind')!='planner':
                        try:
                            live=self.sessions._live(row['game'])
                            if live:self._retire(row['game'],live['sessionId'])
                            self._selection(row['game'],current['detail']['previous'])
                            old=self.sessions.ensure(row['game'],update_hold=True)
                            self.sessions.command(row['game'],{'type':'resume-update','updateId':row['id']},session_id=old['sessionId'])
                            self.journal.transition(row['id'],current['revision'],'rolled-back',detail);continue
                        except Exception as rollback:detail['recoveryReason']=str(rollback)
                    self.journal.transition(row['id'],current['revision'],'failed',detail)
            self.closed.wait(1)
    def close(self):self.closed.set()
