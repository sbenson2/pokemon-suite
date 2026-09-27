import {encounterFingerprint} from '../player/encounter-tracker.js';

export function nativeSavePreservesPokemon(before,continued){
 const identities=o=>{
  const t=o?.playerMemory?.trainer;
  if(t?.partyValidity!=='valid'||t.storage?.validity!=='valid')return null;
  const list=[...(t.party??[]),...(t.storage.pokemon??[])].map(encounterFingerprint);
  return list.every(Boolean)?JSON.stringify(list.sort()):null;
 };
 const expected=identities(before);return expected!==null&&expected===identities(continued);
}
// Read-only menu decisions. All state changes remain ordinary game inputs.
export function rngMenuIntent(o,{goal,world,area=null}){
 const m=o.playerMemory??{},u=m.ui??{},callback=o.emulator?.callback2??'';
 const act=recommendation=>({kind:'recommendation',recommendation});
 const wait={kind:'wait'};
 // A rehearsal can cross a trainer's sightline or meet a trapped wild battle.
 // Both need the same battle policy as live play; only Safari has a direct Run menu.
 if(o.emulator?.inBattle)return {kind:m.battleTypeFlags===132?'encounter':'battle'};
 if(callback==='TeachyTvMainCallback')return wait;
 if(callback==='TeachyTvCallback')return goal==='teachy-tv'?{kind:'ready'}:act({kind:'close-menu'});
 if(o.phase!=='stable'||!o.emulator?.inputReady)return wait;
 if(u.fieldDialog)return act({kind:'acknowledge-cartridge-prompt'});
 if(goal==='teachy-tv'){
  const index=m.trainer?.bag?.keyItems?.findIndex(i=>i.itemId===366&&i.quantity>0)??-1;
  if(index<0)return {kind:'blocked',reason:'teachy-tv-missing'};
  if(u.party)return act({kind:'close-menu'});
  if(u.bag)return act(u.bag.stage==='context-menu'?{kind:'choose-bag-context-action',targetIndex:0}:u.bag.pocket!==1?{kind:'choose-bag-pocket',targetPocket:1}:{kind:'choose-bag-item',targetIndex:index});
  if(u.startMenu)return act({kind:'choose-start-menu-item',targetItem:'bag',targetIndex:u.startMenu.order.indexOf('bag')});
  return act({kind:'open-start-menu'});
 }
 if(goal!=='sweet-scent')throw new TypeError('Unknown RNG menu goal');
 const slot=m.trainer?.party?.findIndex(p=>!p.isEgg&&p.moves?.includes(230))??-1;
 if(slot<0)return {kind:'blocked',reason:'sweet-scent-user-missing'};
 const map=(world?.data??world)?.maps?.find(x=>x.id===m.map?.id);
 const cell=map?.layout?.cells?.find(c=>c.x===m.position?.x&&c.y===m.position?.y);
 // Sweet Scent draws from the current map's own wild table. A cave-floor cell of
 // another map on the way (Dunsparce Tunnel for Three Isle Port) is not the zone.
 const inZone=cell?.encounterType===1&&(!area||m.map?.id===area);
 if(u.bag||!inZone&&(u.party||u.startMenu))return act({kind:'close-menu'});
 if(u.party?.stage==='selection-menu'){
  if(u.party.selectedPartySlot!==slot)return act({kind:'close-menu'});
  const index=u.party.actions?.indexOf('sweet-scent')??-1;
  if(index<0)return {kind:'blocked',reason:'sweet-scent-action-unreadable'};
  return u.party.actionCursor===index?{kind:'ready'}:act({kind:'choose-party-action',targetIndex:index});
 }
 if(u.party)return act({kind:'choose-party-member',targetPartySlot:slot});
 if(u.startMenu)return act({kind:'choose-start-menu-item',targetItem:'pokemon',targetIndex:u.startMenu.order.indexOf('pokemon')});
 return inZone?act({kind:'open-start-menu'}):{kind:'navigate'};
}

export function qualifyTitleSeeds(trials){
 const groups=new Map();
 for(const trial of trials){
  if(trial.mode!=='continue'||!Number.isInteger(trial.seed)||trial.seed<0||trial.seed>0xffffffff)continue;
  const key=JSON.stringify([trial.identity,trial.titleFrames,trial.button]);
  const list=groups.get(key)??[];list.push(trial);groups.set(key,list);
 }
 return [...groups.values()].filter(list=>list.length>=2&&list.every(t=>t.seed===list[0].seed&&t.frame===list[0].frame))
  .map(list=>({...list[0],qualified:true,repeats:list.length}));
}

export async function runTitleTiming({session,observer,titleFrames,button='a',nativeSaveVerified=false,signal,yieldTask=()=>new Promise(r=>setImmediate(r))}){
 if(!nativeSaveVerified)throw new Error('Title timing requires a verified native save');
 if(!Number.isSafeInteger(titleFrames)||titleFrames<1800||titleFrames>18000||!['a','start'].includes(button))throw new TypeError('Invalid title timing');
 const before=observer.capture();
 if(before.emulator?.inBattle)throw new Error('Title timing cannot reset an encounter');
 const trace=[{frames:titleFrames,buttons:[]},{frames:120,buttons:[button]},{frames:90,buttons:[]}];
 if(signal?.aborted)return {status:'cancelled'};
 session.reset();
 observer.resetHistory?.();
 for(const step of trace)for(let i=0;i<step.frames;i++){
  if(signal?.aborted){session.releaseButtons?.();return {status:'cancelled'};}
  session.step(step.buttons);if(i%60===59)await yieldTask();
 }
 session.releaseButtons?.();const o=observer.capture();
 return {titleFrames,button,frame:session.frame,seed:o.playerMemory?.rng?.mainState,trace,
  mode:o.emulator?.callback2==='CB2_MainMenu'&&o.phase==='stable'&&!o.playerMemory?.ui?.newGame&&o.playerMemory?.rng?.validity==='valid'?'continue':'unknown'};
}
