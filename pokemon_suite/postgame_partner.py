"""Coordinate existing native game owners without depending on an open viewer."""
import json
import threading
import time
from .suite_save_store import atomic_file
from .trade_state import native_trade_finished

class PostgamePartners:
    def __init__(self,sessions):
        self.sessions=sessions
        self._stop=threading.Event()
        self._thread=None
        self.error=None

    def start(self):
        if self._thread is not None:return
        self._thread=threading.Thread(target=self._run,name='suite-postgame-partners',daemon=True)
        self._thread.start()

    def close(self):
        self._stop.set()
        if self._thread:self._thread.join(timeout=3)

    def _run(self):
        while not self._stop.is_set():
            try:self.tick();self.error=None
            except (OSError,ValueError,KeyError) as error:self.error=str(error)
            self._stop.wait(2)

    @staticmethod
    def available(peer,request_id=None,title='emerald',source=None):
        if title=='firered':return PostgamePartners.firered_available(peer,request_id,source)
        if not peer:return False,'Start the configured Emerald bot and leave it ready for commands.'
        bot=peer.get('bot') or {};control=peer.get('control') or {};local=peer.get('localEvolution') or {}
        if not bot.get('enabled'):return False,'The Emerald bot was stopped.'
        if control.get('mode')=='manual' or control.get('manualSessionCount',0):return False,'Emerald is under manual control.'
        if (peer.get('runtime') or {}).get('update',{}).get('held') or (peer.get('runtime') or {}).get('update',{}).get('id'):return False,'Emerald is applying an update.'
        if not native_trade_finished(peer.get('nativeTrade')):return False,'Emerald owns another native trade.'
        if local.get('phase') not in (None,'complete') and local.get('requestId')!=request_id:return False,'Emerald owns another evolution exchange.'
        preparation=bot.get('preparation') or {}
        if bot.get('mode')=='evolution-partner' and preparation.get('requestId')==request_id:return True,None
        if local.get('phase')=='complete' and preparation.get('requestId')==local.get('requestId'):return True,None
        if not bot.get('awaitingCommand'):return False,'Emerald is working on another task.'
        if (peer.get('gameProgress') or {}).get('leagueComplete') is not True:return False,'Emerald must complete the League before serving as a native partner.'
        return True,None

    @staticmethod
    def firered_available(peer,request_id=None,source=None):
        """The invisible FireRed partner: idle, headless and a distinct save."""
        if not peer:return False,'Start the configured FireRed trade partner.'
        bot=peer.get('bot') or {};control=peer.get('control') or {};local=peer.get('localEvolution') or {}
        if not bot.get('enabled') or bot.get('mode')!='evolution-partner':return False,'The FireRed partner was stopped.'
        if control.get('manualSessionCount',0) or control.get('mode')=='manual' and not control.get('paused'):return False,'The FireRed partner is under manual control.'
        if (peer.get('runtime') or {}).get('update',{}).get('held') or (peer.get('runtime') or {}).get('update',{}).get('id'):return False,'The FireRed partner is applying an update.'
        if not native_trade_finished(peer.get('nativeTrade')):return False,'The FireRed partner owns another native trade.'
        if local.get('phase') not in (None,'complete') and local.get('requestId')!=request_id:return False,'The FireRed partner is serving another evolution exchange.'
        mine=(peer.get('gameProgress') or {}).get('trainerId');theirs=((source or {}).get('gameProgress') or {}).get('trainerId')
        if isinstance(mine,int) and mine==theirs:return False,'The FireRed partner save has the same trainer ID as this save. Configure a distinct save.'
        preparation=bot.get('preparation') or {}
        if preparation.get('requestId')==request_id and preparation.get('phase')=='waiting':return False,preparation.get('reason') or 'The FireRed partner is not ready to trade.'
        if preparation.get('requestId')==request_id:return True,None
        if local.get('phase')=='complete' and preparation.get('requestId')==local.get('requestId'):return True,None
        if not bot.get('awaitingCommand') and preparation.get('phase') not in ('complete',None):return False,'The FireRed partner is serving another evolution request.'
        return True,None

    def partners(self):
        s=self.sessions
        if hasattr(s,'partner_owners'):return s.partner_owners()
        return [('emerald','emerald')] if s.configured('emerald') else []

    def tick(self):
        s=self.sessions
        if not s.configured('firered'):return
        with s.lock:
            source=s._live('firered') or {};bot=source.get('bot') or {};p=bot.get('preparation') or {};request=p.get('requestId')
            partners=self.partners();peers={owner:s._live(owner) for owner,_ in partners}
            results={owner:self.available(peers[owner],request,title,source) for owner,title in partners}
            listed=[{'owner':owner,'title':title} for owner,title in partners if results[owner][0]]
            # The request's own partner decides; without one, any ready partner.
            target=p.get('partnerOwner') or 'emerald'
            if target in results:available,reason=results[target] if request else (bool(listed),None if listed else results[target][1])
            elif not partners:available,reason=self.available(None,request)
            else:available,reason=(bool(listed),None if listed else next(iter(results.values()))[1]) if not request else (False,'The partner game for this evolution is not configured.')
            path=s.directory/'firered/partner-availability.json';path.parent.mkdir(parents=True,exist_ok=True)
            atomic_file(path,json.dumps({'schema':'pokemon-suite/partner-availability/v1','available':bool(listed) if not request else available,'reason':reason,'partners':listed,'checkedAt':int(time.time()*1000)}).encode())
            if not bot.get('enabled') or bot.get('runScope')!='postgame' or p.get('automatic') is not True or p.get('phase')!='waiting-for-transfer' or not request:return
            if (source.get('localEvolution') or {}).get('phase') not in (None,'complete'):return
            if not available:
                s.command('firered',{'type':'defer-partner-evolution','requestId':request,'reason':reason},session_id=source['sessionId']);return
            peer=peers[target];title=dict(partners)[target]
            existing=(peer.get('bot') or {}).get('preparation') or {}
            if existing.get('requestId')==request:return
            s.command(target,{'type':'prepare-partner','requestId':request,'automatic':True,**({'sourceOwner':'firered'} if title=='firered' else {})},session_id=peer['sessionId'])
