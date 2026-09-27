"""Persistent unique-species collection using the Suite's existing game owners."""
from __future__ import annotations
import argparse,json,os,time,uuid
from . import file_lock as fcntl
from contextlib import contextmanager
from pathlib import Path

RNG_RETRY_REASONS={
    'RNG menu navigation exceeded its budget',
    'No calculated shiny input plan passed cartridge replay',
    'Teachy TV rate changed; recalibration required',
    'Teachy TV timing qualification failed',
    'Sweet Scent timing qualification did not finish',
}
# The early no-route stop of an RNG trial names its map. It replaces the menu
# budget stop above for the same condition, so it keeps the same retry.
RNG_RETRY_PREFIXES=('RNG setup has no executable route to an encounter cell of ',)


def rng_retryable(reason):
    return isinstance(reason,str) and (reason in RNG_RETRY_REASONS or reason.startswith(RNG_RETRY_PREFIXES))


def shiny_request(species):
    return {'schema':'pokemon-suite/farming-request/v1','game':'firered','speciesId':species,'quantity':1,'locationId':'any','shiny':'required','natures':[],'gender':'any','abilityId':None,'ball':{'id':'any','requirement':'preferred'},'minIvs':{},'minDvs':{},'encounterLevel':{'min':1,'max':100},'finalLevel':None,'moves':[],'heldItemId':None,'limits':{'maxEncounters':1000,'maxMinutes':120,'minBalls':10,'maxSpend':999999},'afterCompletion':'stop-save'}


def owned_shiny_species(records):
    return {r['nationalSpeciesId'] for r in records if r.get('owned') is True and r.get('nativeSaveVerified') is True and r.get('pokemon',{}).get('shiny') is True and isinstance(r.get('nationalSpeciesId'),int)}


def starting_form_candidates(candidates):
    """Keep the earliest reachable member of each branch, including cached plans."""
    from .pokemon_farming import catalog
    parents={p['id']:p.get('evolvesFrom') for p in catalog('firered')['species']}
    reachable={c['speciesId'] for c in candidates}
    result=[]
    for candidate in candidates:
        parent=parents.get(candidate['speciesId']);seen=set()
        while parent is not None and parent not in seen:
            if parent in reachable:break
            seen.add(parent);parent=parents.get(parent)
        else:result.append(candidate)
    return result


def collection_plan(farming):
    from .pokemon_farming import catalog
    result=[];targets=[]
    for mon in catalog('firered')['species']:
        request=shiny_request(mon['id'])
        target={'speciesId':mon['id'],'name':mon['name']};targets.append(target)
        try:plan=farming.preview(request)
        except ValueError as error:target['reason']=str(error);continue
        route=plan.get('route') or {}
        direct=plan.get('canStart') and route.get('method') in {'wild-land','safari-land','gift'}
        if not direct and not plan.get('canStartSource'):
            target['reason']='This encounter still needs a route that preserves the current collection.' if plan.get('canStart') else (plan.get('limitations') or ['No executable acquisition route is available in the configured games.'])[0]
            continue
        if not direct:
            # Every evolved target gets a NEW source; existing collection members
            # are preserved. The worker performs native evolution/return trades.
            source=plan['sourceStage']['request'];capability=farming.executor.capability(source)
            route=capability.get('route') or {}
            if capability.get('setup')!='current-game':
                target['reason']='The source needs an acquisition route in the current game.';continue
        rank=(0 if direct else 1000)+(200 if route.get('method')=='safari-land' else 0)+(255-mon.get('catchRate',45))/5+route.get('minLevel',25)*2+100/max(1,route.get('chance',100))
        result.append({'speciesId':mon['id'],'name':mon['name'],'request':request,'rank':rank,'map':route.get('map'),'method':route.get('method'),'evolution':not direct})
    return {'candidates':sorted(result,key=lambda c:(c['rank'],c['speciesId'])),'targets':targets}


def collection_candidates(farming):return collection_plan(farming)['candidates']


class ShinySweep:
    def __init__(self,directory,farming,executor):
        self.directory=Path(directory);self.path=self.directory/'shiny-sweep.json';self.farming=farming;self.executor=executor

    def read(self):
        try:return json.loads(self.path.read_text())
        except FileNotFoundError:return None

    @contextmanager
    def transaction(self):
        self.directory.mkdir(parents=True,exist_ok=True)
        with (self.directory/'shiny-sweep-state.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            try:yield
            finally:fcntl.flock(lock,fcntl.LOCK_UN)

    def pause(self,reason):
        with self.transaction():
            state=self.read()
            if state:state.update(enabled=False,status='paused',reason=reason);return self.write(state)

    def summary(self):
        state=self.read()
        if not state:return None
        result={k:state.get(k) for k in ('enabled','status','reason','active','updatedAt','lastTransition','goal','collectionStages')}
        result['game']='firered'
        if state.get('targets'):
            owned=set(state.get('owned',[]));reachable={c['speciesId'] for c in state['candidates']}
            targets=state['targets'];missing=[t for t in targets if t['speciesId'] not in owned]
            deferred={d['speciesId']:d for d in state.get('deferred',[]) if d['speciesId'] not in owned}
            blocked=[{**t,'reason':t.get('reason') or 'No executable route is available yet.'} for t in missing if t['speciesId'] not in reachable]
            result['dexProgress']={'total':len(targets),'owned':len(targets)-len(missing),'available':sum(t['speciesId'] in reachable for t in missing),
                'unavailable':len(blocked),'deferred':len(deferred),'blocked':blocked,'recheckedAt':state.get('plannedAt')}

        # Legacy runs have a deferral receipt but no visible transition record.
        if not result['lastTransition'] and state.get('deferred'):
            item=state['deferred'][-1]
            result['lastTransition']={'from':{'speciesId':item['speciesId'],'name':item['name']},'reason':item.get('reason'),
                'retryAt':item.get('retryAt',item.get('at',time.time())+300 if rng_retryable(item.get('reason')) else None)}
        transition=result['lastTransition']
        if transition and transition['from']['speciesId'] in state.get('owned',[]):result['lastTransition']=None
        return result

    def write(self,state):
        self.directory.mkdir(parents=True,exist_ok=True)
        state['updatedAt']=time.time();temporary=self.path.with_suffix('.'+uuid.uuid4().hex+'.tmp')
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as out:json.dump(state,out);out.flush();os.fsync(out.fileno())
        os.replace(temporary,self.path)
        return state

    def start(self,candidates=None,*,goal='supported'):
        with self.transaction():return self._start(candidates,goal=goal)

    def _start(self,candidates=None,*,goal='supported'):
        if goal not in {'supported','national-dex'}:raise ValueError('Choose a supported collection goal.')
        previous=self.read()
        if previous and previous.get('enabled') and previous.get('goal','supported')==goal:return previous
        live=self.executor._live('firered') or {}
        plan=collection_plan(self.farming) if candidates is None else {'candidates':candidates,'targets':[]}
        # Changing the scope keeps the current hunt, receipts and retry budgets.
        if previous:
            previous.update(enabled=True,goal=goal,**plan,plannedAt=time.time())
            return self.write(previous)
        return self.write({'schema':'pokemon-suite/shiny-sweep/v1','id':uuid.uuid4().hex,'enabled':True,'goal':goal,'status':'starting','reason':'Collect a saved shiny of each National Pokédex entry.' if goal=='national-dex' else 'Collect a saved shiny of each reachable species.','startedAt':time.time(),'baseline':sorted(owned_shiny_species(live.get('collection',[]))),'owned':sorted(owned_shiny_species(live.get('collection',[]))),**plan,'plannedAt':time.time(),'active':None,'completed':[],'deferred':[]})

    def launch_active(self,state):
        active=state['active'];now=time.time()
        if now<active.get('launchRetryAt',0):return self.write(state)
        live=self.executor._live('firered') or {};capacity=live.get('storage') or {};mission=live.get('mission') or {}
        # Resuming an owned capture can finish saving; an unstarted request
        # must recheck capacity even if its initial launch was deferred.
        protected_resume=mission.get('id')==active['requestId'] and mission.get('protected')
        if not protected_resume and (not capacity.get('known') or not capacity.get('canStart')):
            state.update(status='storage',reason=capacity.get('reason') or 'Waiting for verified free party and PC space before the next hunt.')
            return self.write(state)
        try:self.farming.start(active['requestId'])
        except (ValueError,OSError) as error:
            # A route can disappear after planning (for example a one-time gift).
            # An ambiguous acknowledgement must never abandon a started capture.
            live=self.executor._live('firered') or {};mission=live.get('mission') or {}
            record=self.farming.get(active['requestId']);ids={record['id'],(record.get('sourceTask') or {}).get('id')}-{None}
            safe=live.get('mode')=='overworld' and mission.get('id') not in ids and (live.get('pendingHunt') or {}).get('id') not in ids
            safe=safe and (not mission.get('protected') or mission.get('state')=='complete') and (live.get('localEvolution') or {}).get('phase') in (None,'complete') and (live.get('nativeTrade') or {}).get('phase') in (None,'complete')
            if safe:
                deferred={k:active[k] for k in ['speciesId','name','requestId']}
                deferred.update(reason=str(error),at=now,retryAt=now+300)
                state['deferred']=[d for d in state['deferred'] if d['speciesId']!=active['speciesId']]+[deferred]
                state['lastTransition']={'from':{'speciesId':active['speciesId'],'name':active['name']},'reason':str(error),'at':now,'retryAt':now+300}
                state['active']=None
            else:active['launchRetryAt']=now+30
            state.update(status='waiting',reason=f"Shiny {active['name']} is waiting: {error}")
        else:
            active['started']=True;active.pop('launchRetryAt',None)
            state.update(status='running',reason=f"Finding shiny {active['name']}.")
        return self.write(state)

    def tick(self):
        with self.transaction():return self._tick()

    def _tick(self):
        state=self.read()
        if not state or not state['enabled']:return state
        live=self.executor._live('firered')
        def report(status,reason):
            state.update(status=status,reason=reason);return self.write(state)
        if not live:
            reconnect=state.get('reconnect') or {}
            if time.time()<reconnect.get('nextAttemptAt',0):return report('waiting',reconnect.get('reason','Waiting to reconnect to FireRed.'))
            attempts=reconnect.get('attempts',0)+1
            state['reconnect']={'attempts':attempts,'nextAttemptAt':time.time()+min(60,5*2**min(attempts-1,4))}
            self.write(state)
            try:live=self.executor.ensure('firered')
            except (ValueError,OSError) as error:
                state['reconnect']['reason']=str(error)
                return report('waiting',f'FireRed reconnect will retry: {error}')
            if not live:return report('waiting','Waiting for the owning FireRed session to reconnect.')
        state.pop('reconnect',None)
        owned=owned_shiny_species(live.get('collection',[]));state['owned']=sorted(owned)
        if not live.get('bot',{}).get('enabled'):return report('paused','Stopped by you. Enable the FireRed bot to continue.')
        if live.get('bot',{}).get('awaitingCommand'):return report('paused','Ready for commands. Run the collection goal to continue.')
        if (live.get('postgame') or {}).get('enabled') and (live.get('postgame') or {}).get('active'):
            return report('waiting','The postgame checklist is completing its current objective.')
        mission=live.get('mission') or {};local=live.get('localEvolution') or {};active=state['active']
        trade=live.get('nativeTrade') or {}
        if trade.get('phase') not in (None,'complete'):
            return report('waiting','Waiting for the complete native trade and save routine.')
        # Upgrade old deferrals without interrupting the current hunt. A failed
        # setup is eligible again after a cooldown, never excluded forever.
        for item in state['deferred']:
            if rng_retryable(item.get('reason')):item.setdefault('retryAt',item.get('at',time.time())+300)
        if active:
            record=self.farming.get(active['requestId']);source=record.get('sourceTask');task=source or record
            task_ids={record['id'],task['id']};pending=(live.get('pendingHunt') or {}).get('id')
            if mission.get('id') not in task_ids and pending not in task_ids:
                if active.get('started'):
                    state['enabled']=False;return report('paused','Another command took control of FireRed. Collection yields to your task.')
                # A saved request can precede its first acknowledged start. Reuse
                # its idempotency key after a crash instead of creating a second.
                if mission.get('state') not in (None,'complete'):return report('waiting','Waiting for the previous game task to finish saving.')
                return self.launch_active(state)
            active['started']=True
            recovery=live.get('recovery') or {}
            if recovery.get('huntId') in task_ids and recovery.get('status')=='recovering':
                return report('recovering',f"Recovering shiny {active['name']} · {recovery.get('action','resume')} · attempt {recovery.get('attempt',1)}/3.")
            complete=self.executor.completed_acquisition(record) if source else mission.get('state')=='complete' or self.executor.completed_hunt(record)
            if complete:
                if active['speciesId'] not in owned:return report('attention','The task ended but this shiny species has no verified current ownership yet.')
                state['completed'].append({'speciesId':active['speciesId'],'name':active['name'],'requestId':record['id'],'at':time.time()});state['active']=None
            elif source and mission.get('state')=='complete':
                preparation=live.get('bot',{}).get('preparation') or {}
                if local.get('phase') not in (None,'complete'):
                    return report('attention' if local.get('phase') in {'waiting','paused'} else 'running',local.get('reason') or f"Evolving and returning shiny {active['name']}.")
                if preparation.get('requestId')!=record['id'] or preparation.get('phase')=='waiting-for-transfer':
                    self.executor.continue_acquisition(record,record['plan']['acquisition'])
                return report('running',f"Preparing shiny {active['name']} through its native evolution route.")
            elif mission.get('state')=='blocked':
                if mission.get('protected') or local.get('phase') not in (None,'complete') or live.get('mode')!='overworld':return report('attention',mission.get('reason') or 'A protected encounter needs completion before collection can continue.')
                reason=mission.get('reason');now=time.time();retryable=rng_retryable(reason)
                if retryable:
                    retry=active.setdefault('retry',{'attempts':0,'nextAttemptAt':now+5,'reason':reason})
                    if retry['attempts']<3:
                        if now<retry['nextAttemptAt']:
                            return report('recovering',f"Retrying shiny {active['name']} in {max(1,int(retry['nextAttemptAt']-now))}s: {reason}.")
                        retry.update(attempts=retry['attempts']+1,reason=reason)
                        retry['nextAttemptAt']=now+min(40,5*2**retry['attempts'])
                        # Persist before the command. A restart or an ambiguous
                        # acknowledgement must not send unbounded duplicate starts.
                        self.write(state)
                        try:self.farming.start(record['id'])
                        except (ValueError,OSError) as error:
                            return report('recovering',f"Retry {retry['attempts']}/3 for shiny {active['name']} is waiting: {error}")
                        return report('recovering',f"Retrying shiny {active['name']} · attempt {retry['attempts']}/3 after {reason}.")
                deferred={'speciesId':active['speciesId'],'name':active['name'],'requestId':record['id'],'reason':reason,'at':now}
                if retryable:deferred.update(retryAt=now+300,attempts=active['retry']['attempts'])
                state['deferred']=[d for d in state['deferred'] if d['speciesId']!=active['speciesId']]+[deferred]
                state['lastTransition']={'from':{'speciesId':active['speciesId'],'name':active['name']},'reason':reason,'at':now,'retryAt':deferred.get('retryAt')}
                state['active']=None
            elif mission.get('state')=='paused':return report('paused','The current hunt is paused. Resume it with Start bot.')
            else:return report('running',f"Finding shiny {active['name']} · {mission.get('phase','hunting')}.")
        if local.get('phase') not in (None,'complete'):return report('waiting','Waiting for the complete native trade and save routine.')
        if live.get('pendingHunt'):return report('waiting','A requested hunt is waiting for control of the game.')
        if mission.get('state') not in (None,'complete','blocked') or (mission.get('protected') and mission.get('state')!='complete') or live.get('mode')!='overworld':return report('waiting','Waiting for a saved, unlinked field state before the next species.')
        capacity=live.get('storage') or {}
        if not capacity.get('known') or not capacity.get('canStart'):
            return report('storage',capacity.get('reason') or 'Waiting for verified free party and PC space before the next hunt.')
        deferred={c['speciesId'] for c in state['deferred'] if c.get('retryAt') is None or c['retryAt']>time.time()}
        due={c['speciesId'] for c in state['deferred'] if c.get('retryAt') is not None and c['retryAt']<=time.time()}
        try:policy=json.loads((self.directory/'bot-settings.json').read_text())['preferences'].get('collectionStages','base-forms')
        except FileNotFoundError:policy='base-forms'
        if state.get('goal')=='national-dex':
            policy='each-stage'
            if time.time()-state.get('plannedAt',time.time())>=300:
                state.update(**collection_plan(self.farming),plannedAt=time.time())
        candidates=state['candidates'] if policy=='each-stage' else starting_form_candidates(state['candidates'])
        state['collectionStages']=policy
        choices=[c for c in candidates if c['speciesId'] not in owned|deferred]
        if not choices:
            pending=[d for d in state['deferred'] if d.get('retryAt') is not None and d['speciesId'] not in owned]
            if pending:
                next_retry=min(pending,key=lambda d:d['retryAt'])
                return report('waiting',f"Shiny {next_retry['name']} will retry in {max(1,int(next_retry['retryAt']-time.time()))}s after a setup failure.")
            if state.get('goal')=='national-dex':
                missing=[t for t in state.get('targets',[]) if t['speciesId'] not in owned]
                if missing:return report('waiting',f'{len(missing)} National Pokédex entries remain. Unavailable routes are listed in Bot settings and checked again every five minutes.')
                return report('complete','Every National Pokédex entry has an owned, verified shiny. The bot remains on for your next command.')
            return report('waiting','Every currently supported candidate is owned or deferred. Saved catches remain available in Shinies.')
        target=min(choices,key=lambda c:(0 if c['speciesId'] in due else 1,c['rank']-(25 if c.get('map')==live.get('map') else 0),c['speciesId']))
        from .pokemon_farming import COLLECTION_KEY
        key=f"{COLLECTION_KEY}{state['id']}-{target['speciesId']}"
        # Candidates persist between software updates. Apply the current
        # collection policy only when creating the next automatic request.
        record=self.farming.save(shiny_request(target['speciesId']),key)
        state['active']={'speciesId':target['speciesId'],'name':target['name'],'requestId':record['id'],'started':False}
        state['deferred']=[d for d in state['deferred'] if d['speciesId']!=target['speciesId']]
        transition=state.get('lastTransition')
        if transition and not transition.get('to'):transition['to']={'speciesId':target['speciesId'],'name':target['name']}
        self.write(state)
        return self.launch_active(state)


def collection_requests(suite_root,executor):
    """The collection saves its requests in the Suite's one request database."""
    from .pokemon_farming import suite_requests
    return suite_requests(suite_root,executor)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--suite-root',type=Path,required=True);parser.add_argument('--start',action='store_true');args=parser.parse_args()
    from .pokemon_sessions import SuiteSessions
    directory=args.suite_root/'firered';directory.mkdir(parents=True,exist_ok=True)
    with (directory/'shiny-sweep.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        executor=SuiteSessions(args.suite_root);farming=collection_requests(args.suite_root,executor);sweep=ShinySweep(directory,farming,executor)
        if args.start:sweep.start()
        from .desktop import desktop_parent_alive
        previous=None
        while desktop_parent_alive():
            try:
                result=sweep.tick();status={k:(result or {}).get(k) for k in ('status','reason','active','owned')}
                if status!=previous:print(json.dumps(status),flush=True);previous=status
            except Exception as error:
                with sweep.transaction():
                    result=sweep.read()
                    if result:result.update(status='attention',reason=str(error));sweep.write(result)
                print(json.dumps({'error':str(error)}),flush=True)
            time.sleep(5)

if __name__=='__main__':main()
