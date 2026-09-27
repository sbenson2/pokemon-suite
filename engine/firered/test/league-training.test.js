import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolvePostgameObjective,postgameChecklist,postgamePresentation,PostgameAgenda} from '../src/suite/postgame-agenda.js';
import * as share from '../src/suite/league-exp-share.js';
import {createPostgameController} from '../src/suite/postgame.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// The league-training checklist entry drives League rounds only while a real
// Exp. Share trainee exists (league-exp-share.js). Native League rematch
// observations (see league-exp-share.test.js): Fearow, Golduck, Dragonite,
// Machamp (100), Persian (94) and Venusaur (89); a boxed Raichu holds the Exp. Share.
const fixture=JSON.parse(readFileSync(new URL('../test-support/champion-rematch-tactics.json',import.meta.url)));
const {mechanics}=fixture;
const agendaMechanics={...mechanics,trainers:Object.values(mechanics.trainers)};
const observed=label=>structuredClone(fixture.observations.find(x=>x.label===label).observation);
const FEAROW=22,DRAGONITE=149,PERSIAN=53,MACHAMP=68,VENUSAUR=3,RAICHU=26,DIGLETT=50,DUGTRIO=51;
const teamPlan={schema:'master-red/permanent-team-plan/v1',starterFamily:[1,2,3],
  permanentFamilies:[[1,2,3],[21,22],[52,53],[66,67,68],[54,55],[147,148,149]],acquisitions:[],utilityAcquisitions:[]};
const CENTER='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F',SHA='c'.repeat(64),BASKET=[24,20,23,19];
const world={maps:[{id:CENTER,objectEvents:[{script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}],backgroundEvents:[],warpEvents:[],coordEvents:[],connections:[]}]};
const RECEIPT={nativeSaveVerified:true,leagueEntries:4,savedGame:400};
const ROOMS=['LORELEIS','BRUNOS','AGATHAS','LANCES','CHAMPIONS'].map(name=>`MAP_POKEMON_LEAGUE_${name}_ROOM`);
const GAIN=36009;
const member=(o,species)=>o.playerMemory.trainer.party.find(p=>p.species===species);
const boxed=(o,species)=>o.playerMemory.trainer.storage.pokemon.find(p=>p.species===species);
const fp=encounterFingerprint;

// The Indigo Plateau Pokemon Center between rounds, healed and stocked, after
// the verified stronger League victory (Celio's link complete).
function center({diglett=false}={}){
  const o=observed('lorelei-room-after-battle'),m=o.playerMemory;
  m.map.id=CENTER;o.emulator={mode:'overworld',inBattle:false,inputReady:true};o.phase='stable';o.sram={sha256:SHA};
  m.ui=Object.fromEntries(Object.keys(m.ui).map(key=>[key,null]));
  for(const flag of [1208,1209,1210,1211])m.storyState.flagIds[flag]=false;
  for(const flag of [2092,2112,2116])m.storyState.flagIds[flag]=true;
  for(const p of m.trainer.party){p.hp=p.maxHp;p.status1=0;p.pp=p.moves.map(id=>id?mechanics.moves[id]?.pp??0:0);p.ppBonuses=0;}
  m.trainer.partyValidity='valid';m.trainer.storage.validity='valid';
  if(diglett){
    const template=m.trainer.storage.pokemon.find(p=>p.species!==RAICHU&&!p.isEgg);
    m.trainer.storage.pokemon.push({...structuredClone(template),box:13,slot:29,species:DIGLETT,personality:777001,otId:m.trainer.otId??template.otId,
      experience:20**3,heldItem:0,shiny:false,isEgg:false,moves:[10,0,0,0],pp:[35,0,0,0]});
  }
  m.gameStats={...(m.gameStats??{}),leagueEntries:4,savedGame:400};
  return o;
}
// Composed: Venusaur holds the (boxed Raichu's) Exp. Share and does not lead.
function composed({entries=4,gain=0}={}){
  const o=center();
  boxed(o,RAICHU).heldItem=0;member(o,VENUSAUR).heldItem=182;
  o.playerMemory.gameStats.leagueEntries=entries;member(o,VENUSAUR).experience+=gain;return o;
}
function inRoom(o,room,{beaten=false,apply=()=>{}}={}){
  const r=structuredClone(o),m=r.playerMemory;m.map.id=ROOMS[room];
  for(let i=0;i<4;i++)m.storyState.flagIds[1208+i]=i<room||i===room&&beaten;
  apply(r);return r;
}
// The boxed Raichu (a non-team filler) visits the party in Fearow's place.
function withFiller(o){
  const m=o.playerMemory,raichu=boxed(o,RAICHU),fearow=member(o,FEAROW);
  m.trainer.storage.pokemon=m.trainer.storage.pokemon.filter(p=>p!==raichu).concat({...fearow,box:0,slot:11});
  m.trainer.party=[...m.trainer.party.filter(p=>p!==fearow),{...raichu,level:25,hp:60,maxHp:60,status1:0,
    stats:{attack:40,defense:30,speed:60,spAttack:40,spDefense:40}}].map((p,slot)=>({...p,slot}));
  return o;
}
function moveItem(o,holder,itemId,{give}){
  const items=o.playerMemory.trainer.bag.items,entry=items.find(i=>i.itemId===itemId);
  if(give){entry.quantity--;if(!entry.quantity)items.splice(items.indexOf(entry),1);holder.heldItem=itemId;}
  else{assert.equal(holder.heldItem,itemId);holder.heldItem=0;if(entry)entry.quantity++;else items.push({itemId,quantity:1});}
}
const resolve=(id,o,workflows,context={})=>resolvePostgameObjective(id,o,world,workflows,{mechanics:agendaMechanics,teamPlan,protectedFingerprints:[],...context});
const refresh=(o,workflows,extra={})=>share.refreshLeagueTraining(workflows,{o,mechanics:agendaMechanics,teamPlan,protectedFingerprints:[],owner:null,...extra});
const entry=(o,workflows)=>postgameChecklist(o,workflows,teamPlan).find(e=>e.id==='league-training');
const shape=e=>[e?.status,e?.executable,e?.reason];
const trainee=p=>({personality:p.personality,otId:p.otId,species:p.species,reason:'team-below-max-level',targetLevel:100});
const T=Date.parse('2026-09-26T05:00:00.000Z'),at=ms=>new Date(T+ms).toISOString();
const LEGACY={reason:'battler-fainted',leagueEntries:101,frame:16496570,map:'MAP_POKEMON_LEAGUE_AGATHAS_ROOM'};
const PAUSED='Paused after a battler fainted at Hall of Fame entry 101. To resume, turn League training off in Bot settings and save, then turn it on and save again.';
const deferOthers=(agenda,o,keep)=>{for(const e of postgameChecklist(o,agenda.state.workflows))if(!keep.includes(e.id))agenda.state.failures[e.id]={retryAt:1e15};};

test('nothing to drive: league-training is complete and never selected',()=>{
  const o=withFiller(center()),workflows={league:{receipt:RECEIPT}};
  for(const p of o.playerMemory.trainer.party)if(p.species!==RAICHU)p.level=100;
  refresh(o,workflows);
  assert.deepEqual(shape(entry(o,workflows)),['complete',true,'no-eligible-trainee']);
  // League rounds that run anyway (hall-sticker, league-rematch) still train the filler.
  assert.equal(share.leagueExpSharePlan({o,mechanics:agendaMechanics,teamPlan,sweepLevel:90}).trainee?.species,RAICHU);
  const agenda=new PostgameAgenda({enabled:true,active:null,entries:[],failures:{},workflows});
  deferOthers(agenda,o,['league-training']);
  assert.equal(agenda.select(o,1000),null);
});

test('a team member below 100 makes it pending and executable after the rematch receipt; before the receipt it waits',()=>{
  const o=center(),waiting={};
  refresh(o,waiting);
  assert.deepEqual(shape(entry(o,waiting)),['pending',false,'Starts after the first stronger League victory.']);
  const agenda=new PostgameAgenda({enabled:true,active:null,entries:[],failures:{},workflows:waiting});
  deferOthers(agenda,o,['league-training']);
  assert.equal(agenda.select(o,1000),null);
  const workflows={league:{receipt:RECEIPT}};
  refresh(o,workflows);
  assert.deepEqual(shape(entry(o,workflows)),['pending',true,'Venusaur Lv. 89 → Lv. 100']);
  const ready=new PostgameAgenda({enabled:true,active:null,entries:[],failures:{},workflows});
  deferOthers(ready,o,['league-training']);
  assert.equal(ready.select(o,1000)?.id,'league-training');
});

test('a current filler trainee is finished; a new filler never schedules a round',()=>{
  // Every team member is at 100; the boxed Diglett trained as filler (Dugtrio is owned).
  const o=center({diglett:true}),m=o.playerMemory;
  for(const p of m.trainer.party)p.level=100;m.trainer.pokedex.ownedSpecies.push(DUGTRIO);
  const d=boxed(o,DIGLETT);
  const workflows={league:{receipt:RECEIPT},leagueExpShare:{trainee:{personality:d.personality,otId:d.otId,species:DIGLETT,reason:'lowest-level-party-member',targetLevel:100},active:false}};
  refresh(o,workflows);
  const e=entry(o,workflows);
  assert.deepEqual([e.status,e.executable],['pending',true]);
  assert.match(e.reason,/^Diglett Lv\. \d+ → Lv\. 100$/);
  const first=resolve('league-training',o,workflows);
  assert.equal(first.expShareTrainee?.species,DIGLETT);
  assert.equal(first.target.kind,'party-roster','the Exp. Share holder and the trainee are composed');
  // At 100 the filler is finished and the entry completes.
  d.level=100;d.experience=1250000;
  refresh(o,workflows);
  assert.deepEqual(shape(entry(o,workflows)),['complete',true,'no-eligible-trainee']);
  // A new filler never starts a round: no purchase, no battle-0.
  const filler=withFiller(center()),fresh={league:{receipt:RECEIPT}};
  for(const p of filler.playerMemory.trainer.party)if(p.species!==RAICHU)p.level=100;
  const stop=resolve('league-training',filler,fresh);
  assert.deepEqual([stop.target.kind,stop.target.reason],['stop-for-review','No League trainee is ready: no-eligible-trainee']);
  assert.equal(stop.expShareTrainee,undefined);
  const round=resolve('league-rematch',filler,{league:{receipt:RECEIPT}});
  assert.equal(round.expShareTrainee?.species,RAICHU,'rounds that run anyway still train the filler');
});

test('a hold is pending, not executable, with the Paused reason naming the Bot-settings resume; an owed lent item keeps it executable for the restore only',()=>{
  const o=composed(),v=member(o,VENUSAUR),owner={enabled:true,resumedAt:null},legacy=LEGACY;
  const workflows={league:{receipt:RECEIPT},leagueExpShare:{disabled:{...legacy},trainee:trainee(v),active:false,
    lent:{personality:v.personality,otId:v.otId,species:VENUSAUR,ownItem:0}}};
  refresh(o,workflows,{owner,now:T});
  assert.deepEqual(shape(entry(o,workflows)),['pending',true,'Return the lent held item.']);
  const back=resolve('league-training',o,workflows,{leagueTraining:owner,now:T});
  assert.deepEqual(back.target,{kind:'take-held-item',fingerprint:fp(v),map:CENTER,itemId:182});
  moveItem(o,v,182,{give:false});
  const after=resolve('league-training',o,workflows,{leagueTraining:owner,now:T});
  assert.equal(workflows.leagueExpShare.lent,undefined,'the item slot is restored');
  assert.equal(after.target.kind,'stop-for-review');
  refresh(o,workflows,{owner,now:T});
  assert.deepEqual(shape(entry(o,workflows)),['pending',false,PAUSED]);
  assert.deepEqual(workflows.leagueExpShare.disabled,{...legacy,firstSeenAt:at(0)},'a legacy hold is never re-armed automatically');
  const agenda=new PostgameAgenda({enabled:true,active:null,entries:[],failures:{},workflows});
  deferOthers(agenda,o,['league-training']);
  assert.equal(agenda.select(o,1000),null);
  // The owner's Bot-settings resume is applied by the refresh, since a held entry never resolves.
  refresh(o,workflows,{owner:{enabled:true,resumedAt:at(1000)},now:T+2000});
  assert.equal(workflows.leagueExpShare.disabled,undefined);
  assert.deepEqual([workflows.leagueExpShare.history.at(-1).kind,workflows.leagueExpShare.history.at(-1).hold.leagueEntries],['resumed',101]);
  assert.deepEqual(shape(entry(o,workflows)),['pending',true,'Venusaur Lv. 89 → Lv. 100']);
  // New holds name their reason; an unreadable counter leaves the entry out.
  workflows.leagueExpShare.disabled={reason:'round-not-won',class:'hold',conditions:['battler-fainted'],leagueEntries:null,heldAt:at(3000)};
  refresh(o,workflows,{owner:{enabled:true,resumedAt:at(1000)},now:T+4000});
  assert.deepEqual(shape(entry(o,workflows)),['pending',false,
    'Paused after a League round ended without a new Hall of Fame entry. To resume, turn League training off in Bot settings and save, then turn it on and save again.']);
});

test('an unknown party or counter gives unknown',()=>{
  const o=center(),workflows={league:{receipt:RECEIPT}};
  assert.equal(entry(o,workflows).status,'unknown','no demand yet');
  refresh(o,workflows);
  assert.equal(entry(o,workflows).status,'pending');
  const blink=structuredClone(o);blink.playerMemory.trainer.partyValidity='unknown';
  refresh(blink,workflows);
  assert.equal(entry(blink,workflows).status,'unknown');
  const blind=structuredClone(o);delete blind.playerMemory.gameStats.leagueEntries;
  refresh(blind,workflows);
  assert.equal(entry(blind,workflows).status,'unknown');
  const agenda=new PostgameAgenda({enabled:true,active:null,entries:[],failures:{},workflows});
  deferOthers(agenda,blind,['league-training']);
  assert.equal(agenda.select(blind,1000),null);
});

test('owner off gives complete',()=>{
  const o=composed(),off={enabled:false,resumedAt:null},workflows={league:{receipt:RECEIPT}};
  refresh(o,workflows,{owner:off});
  assert.deepEqual(shape(entry(o,workflows)),['complete',true,'Off in Bot settings.']);
  // A lent item is still returned before the entry completes.
  const v=member(o,VENUSAUR);
  workflows.leagueExpShare.lent={personality:v.personality,otId:v.otId,species:VENUSAUR,ownItem:0};
  refresh(o,workflows,{owner:off});
  assert.deepEqual(shape(entry(o,workflows)),['pending',true,'Return the lent held item.']);
});

test('the Center never buys supplies or starts battle-0 without a composed trainee',()=>{
  const o=composed(),v=member(o,VENUSAUR),off={leagueTraining:{enabled:false,resumedAt:null}};
  o.playerMemory.trainer.bag.items=o.playerMemory.trainer.bag.items.filter(i=>!BASKET.includes(i.itemId));
  const lent=()=>({league:{receipt:RECEIPT},leagueExpShare:{trainee:trainee(v),active:false,lent:{personality:v.personality,otId:v.otId,species:VENUSAUR,ownItem:0}}});
  // Without a trainee requirement the basket is bought first.
  assert.equal(resolve('league-rematch',o,lent(),off).target.kind,'purchase-items');
  const workflows=lent();
  const restore=resolve('league-training',o,workflows,off);
  assert.deepEqual(restore.target,{kind:'take-held-item',fingerprint:fp(v),map:CENTER,itemId:182},'the restore comes before any purchase');
  moveItem(o,v,182,{give:false});
  const stop=resolve('league-training',o,workflows,off);
  assert.deepEqual([stop.target.kind,stop.target.reason],['stop-for-review','No League trainee is ready: owner-off']);
  // A composition stop is a stop as well (and a hold), never a full-team round.
  const mail=center();mail.playerMemory.trainer.bag.items=mail.playerMemory.trainer.bag.items.filter(i=>!BASKET.includes(i.itemId));
  for(const p of mail.playerMemory.trainer.party)if(p.species!==VENUSAUR)p.heldItem=121;
  const state={league:{receipt:RECEIPT}},composition=resolve('league-training',mail,state);
  assert.deepEqual([composition.target.kind,composition.target.reason],['stop-for-review','No League trainee is ready: No party member can make room for the boxed Exp. Share holder.']);
  assert.equal(state.leagueExpShare.disabled.reason,'composition:No party member can make room for the boxed Exp. Share holder.');
  assert.deepEqual(state.leagueExpShare.history.map(h=>h.kind),['hold']);
  assert.equal(share.leagueTrainingPaused(state.leagueExpShare.disabled),'Paused after the League team could not be composed (No party member can make room for the boxed Exp. Share holder) at Hall of Fame entry 4. To resume, turn League training off in Bot settings and save, then turn it on and save again.');
  assert.equal(state.training?.cycle,undefined,'no round cycle opens without a round');
});

test('resolve opens a native cycle when the round starts and delegates to the League objectives',()=>{
  // No cycle while the Center still has work (the basket here).
  const shop=composed(),waiting={league:{receipt:RECEIPT}};shop.playerMemory.trainer.bag.items=shop.playerMemory.trainer.bag.items.filter(i=>!BASKET.includes(i.itemId));
  assert.equal(resolve('league-training',shop,waiting).target.kind,'purchase-items');
  assert.equal(waiting.training?.cycle,undefined);
  const o=composed(),workflows={league:{receipt:RECEIPT}};
  const first=resolve('league-training',o,workflows);
  assert.equal(first.id,'postgame-league-rematch-battle-0');
  assert.equal(first.expShareTrainee?.species,VENUSAUR);
  assert.deepEqual(workflows.training.cycle,{baseline:{leagueEntries:4,savedGame:400,sha256:SHA}});
  assert.equal(workflows.leagueExpShare.active,true);
  // The cycle survives the next resolve without a receipt.
  resolve('league-training',o,workflows);
  assert.deepEqual(workflows.training.cycle,{baseline:{leagueEntries:4,savedGame:400,sha256:SHA}});
  for(const blind of [x=>{delete x.sram;},x=>{delete x.playerMemory.gameStats.savedGame;},x=>{delete x.playerMemory.gameStats.leagueEntries;}]){
    const x=composed(),state={league:{receipt:RECEIPT}};blind(x);
    const stop=resolve('league-training',x,state);
    assert.deepEqual([stop.target.kind,stop.target.reason],['stop-for-review','League training needs a verified native save baseline.']);
    assert.equal(state.training?.cycle,undefined);
  }
});

test('agenda.observe closes the cycle on a verified Hall of Fame save',()=>{
  const o=composed(),v=member(o,VENUSAUR),workflows={league:{receipt:RECEIPT}};
  assert.equal(resolve('league-training',o,workflows).id,'postgame-league-rematch-battle-0');
  resolve('league-training',inRoom(o,0),workflows);
  const agenda=new PostgameAgenda({enabled:true,active:'league-training',entries:[],failures:{},workflows});
  const hof=composed({entries:5,gain:GAIN});hof.playerMemory.gameStats.savedGame=401;hof.sram={sha256:'b'.repeat(64)};
  hof.emulator={mode:'hall-of-fame',callback2:'CB2_HofIdle'};
  agenda.observe(hof);
  assert.equal(agenda.state.workflows.training.cycle.receipt,undefined,'wait for the playable field');
  const field=structuredClone(hof);field.emulator={mode:'overworld',inBattle:false,inputReady:true};
  agenda.observe(field);
  const w=agenda.state.workflows;
  // The verified save closes the run at once and counts it for the trainee of the open round.
  assert.equal(w.training.cycle,undefined);
  assert.deepEqual([w.training.lastRun.nativeSaveVerified,w.training.lastRun.leagueEntries,w.training.runs],[true,5,1]);
  assert.deepEqual(w.training.byTrainee,{[`${v.personality}:${v.otId}`]:1});
  resolve('league-training',field,w);
  assert.deepEqual(w.training.cycle,{baseline:{leagueEntries:5,savedGame:401,sha256:'b'.repeat(64)}},'the next round opens its own cycle');
  assert.equal(w.training.runs,1);
  const round=w.leagueExpShare.history.filter(h=>h.kind==='round').at(-1);
  assert.deepEqual([round.baseline,round.leagueEntries,round.expGain],[4,5,GAIN]);
  assert.deepEqual(w.league.receipt,RECEIPT,'the first rematch receipt is kept');
});

test('a JSON restart in Agatha\'s room keeps the round, cycle and trainee objective; one faint is a strike, two hold, and the trainee stays protected',()=>{
  const o=composed();let workflows={league:{receipt:RECEIPT}};
  resolve('league-training',o,workflows);
  resolve('league-training',inRoom(o,0),workflows);
  const agatha=inRoom(o,2);
  resolve('league-training',agatha,workflows);
  workflows=JSON.parse(JSON.stringify(workflows));
  const next=resolve('league-training',agatha,workflows);
  assert.equal(next.id,'postgame-league-rematch-battle-2');
  assert.equal(next.expShareTrainee?.species,VENUSAUR);
  assert.deepEqual(workflows.training.cycle.baseline,{leagueEntries:4,savedGame:400,sha256:SHA});
  // Owner decision (Sept 26): one fainted battler is a strike (build 106 held
  // here), and the trainee stays protected for the whole round, a hold included.
  const fainted=inRoom(o,2,{apply:r=>{member(r,DRAGONITE).hp=0;}});
  resolve('league-training',fainted,workflows);
  workflows=JSON.parse(JSON.stringify(workflows));
  const strike=resolve('league-training',fainted,workflows);
  assert.equal(strike.id,'postgame-league-rematch-battle-2');
  assert.equal(strike.expShareTrainee?.species,VENUSAUR,'a strike keeps the trainee\'s round');
  assert.equal(workflows.leagueExpShare.disabled,undefined);
  assert.deepEqual(workflows.leagueExpShare.round.faints.map(f=>[f.species,f.room]),[[DRAGONITE,2]]);
  const twice=inRoom(o,2,{apply:r=>{member(r,DRAGONITE).hp=0;member(r,MACHAMP).hp=0;}});
  resolve('league-training',twice,workflows);
  workflows=JSON.parse(JSON.stringify(workflows));
  const held=resolve('league-training',twice,workflows);
  assert.equal(held.id,'postgame-league-rematch-battle-2');
  assert.equal(held.expShareTrainee?.species,VENUSAUR,'the hold keeps the trainee protected to the end of the round');
  assert.equal(workflows.leagueExpShare.disabled.reason,'battler-fainted:multiple');
  assert.deepEqual(workflows.leagueExpShare.round.faints.map(f=>[f.species,f.room]),[[DRAGONITE,2],[MACHAMP,2]]);
  assert.deepEqual(workflows.training.cycle.baseline,{leagueEntries:4,savedGame:400,sha256:SHA},'the run keeps its cycle to the end of the round');
});

test('league-training sits after hall-sticker and before egg-sticker; an eligible national-collection preempts it',()=>{
  const o=composed(),workflows={league:{receipt:RECEIPT}};refresh(o,workflows);
  const ids=postgameChecklist(o,workflows).map(e=>e.id);
  assert.equal(ids.indexOf('league-training'),ids.indexOf('hall-sticker')+1);
  assert.equal(ids.indexOf('egg-sticker'),ids.indexOf('league-training')+1);
  const agenda=new PostgameAgenda({enabled:true,active:null,entries:[],failures:{},workflows});
  deferOthers(agenda,o,['national-collection','league-training']);
  assert.equal(agenda.select(o,1000)?.id,'national-collection');
  agenda.defer('national-collection','Try another objective.',1000);
  assert.equal(agenda.select(o,1000)?.id,'league-training');
});

test('the driver finishes its trainee, judges the round, returns the Exp. Share and then completes',()=>{
  const o=composed(),workflows={league:{receipt:RECEIPT}};member(o,PERSIAN).level=100;
  refresh(o,workflows);
  assert.deepEqual(shape(entry(o,workflows)),['pending',true,'Venusaur Lv. 89 → Lv. 100']);
  assert.equal(resolve('league-training',o,workflows).id,'postgame-league-rematch-battle-0');
  resolve('league-training',inRoom(o,0),workflows);
  // The round made Venusaur 100 (Persian already is): nothing is left to train.
  const after=composed({entries:5,gain:GAIN});member(after,PERSIAN).level=100;member(after,VENUSAUR).level=100;
  refresh(after,workflows);
  assert.deepEqual(shape(entry(after,workflows)),['pending',true,'Judge the last League round.']);
  const back=resolve('league-training',after,workflows),s=workflows.leagueExpShare;
  assert.deepEqual(s.history.filter(h=>['round','completed'].includes(h.kind)).map(h=>[h.kind,h.reason??h.leagueEntries]),[['round',5],['completed','max-level']]);
  assert.equal(s.disabled,undefined);
  assert.deepEqual(back.target,{kind:'take-held-item',fingerprint:fp(member(after,VENUSAUR)),map:CENTER,itemId:182});
  refresh(after,workflows);
  assert.deepEqual(shape(entry(after,workflows)),['pending',true,'Return the lent held item.']);
  moveItem(after,member(after,VENUSAUR),182,{give:false});
  const done=resolve('league-training',after,workflows);
  assert.deepEqual([done.target.kind,done.target.reason],['stop-for-review','No League trainee is ready: no-eligible-trainee']);
  assert.equal(s.lent,undefined);
  refresh(after,workflows);
  assert.deepEqual(shape(entry(after,workflows)),['complete',true,'no-eligible-trainee']);
});

test('the demand is memoized on the party, PC, Bag, state, owner and Hall of Fame count',()=>{
  const o=composed(),workflows={league:{receipt:RECEIPT}};
  const frame=refresh(o,workflows).frame;
  const later=structuredClone(o);later.frame=o.frame+600;
  assert.equal(refresh(later,workflows).frame,frame,'an unchanged signature keeps the cached demand');
  // A League round spends PP: two battlers without attacking PP leave four at the sweep level.
  for(const species of [FEAROW,MACHAMP])member(later,species).pp=[0,0,0,0];
  assert.equal(refresh(later,workflows).frame,later.frame);
  assert.deepEqual(shape(entry(later,workflows)),['complete',true,'fewer-than-five-sweep-level-battlers']);
  // The Nurse restores PP: the demand is recomputed.
  later.frame+=600;for(const species of [FEAROW,MACHAMP])member(later,species).pp=member(o,species).pp;
  assert.deepEqual(shape((refresh(later,workflows),entry(later,workflows))),['pending',true,'Venusaur Lv. 89 → Lv. 100']);
  later.frame+=600;member(later,VENUSAUR).level=100;member(later,PERSIAN).level=100;
  refresh(later,workflows);
  assert.deepEqual(shape(entry(later,workflows)),['complete',true,'no-eligible-trainee']);
  later.frame+=600;refresh(later,workflows,{owner:{enabled:false,resumedAt:null}});
  assert.equal(workflows.leagueExpShare.demand.frame,later.frame,'the owner option is part of the signature');
});

// A minimal controller scene (see postgame-combat-roster.test.js).
const mon=(species,slot)=>({species,slot,personality:100+species,otId:10,validity:'valid',isEgg:false,
  level:species===22?93:70,hp:100,maxHp:100,status1:0,moves:[33],pp:[35]});
function controllerScene(map){
  const cell=i=>({x:i%5,y:Math.floor(i/5),collision:0,elevation:3,behaviorName:'MB_NORMAL',encounterType:0});
  const layout={id:'LAYOUT_TEST_CENTER',width:5,height:5,blockDataSha256:'fixture',cells:Array.from({length:25},(_,i)=>cell(i))};
  const room={id:ROOMS[0],objectEvents:[{x:2,y:2,script:'Lorelei'}],coordEvents:[],backgroundEvents:[],warpEvents:[],connections:[],layout};
  const stock=['ITEM_ULTRA_BALL','ITEM_GREAT_BALL','ITEM_FULL_RESTORE','ITEM_MAX_POTION','ITEM_REVIVE','ITEM_FULL_HEAL','ITEM_MAX_REPEL'];
  const story={data:{scripts:[{label:'Shop',instructions:[{op:'pokemart',args:['Stock']}]},{label:'Stock',instructions:stock.map(name=>({op:'.2byte',args:[name]}))}],
    symbols:{items:Object.fromEntries(stock.map((name,i)=>[name,{value:[2,3,19,20,24,23,84][i]}]))}}};
  const world={data:{maps:[{id:CENTER,objectEvents:[{x:1,y:1,script:'Shop'},{x:2,y:2,script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}],coordEvents:[],backgroundEvents:[],warpEvents:[],connections:[],layout},room],wildEncounters:[]}};
  const mechanics={data:{moves:[{id:33,pp:35,power:40,type:'TYPE_NORMAL',effect:'EFFECT_HIT'}],species:[]}};
  const o={captureId:'league-training',frame:100,phase:'stable',phaseReasons:[],emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'before'},playerMemory:{
    map:{id:map},position:{x:2,y:3},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{0x4082:0,0x4049:1,0x404a:0}},gameStats:{savedGame:10,leagueEntries:1,eggsHatched:0},saveAttemptStatus:1,
    trainer:{partyValidity:'valid',party:[3,22,53,67,55,149].map(mon),usablePartyCount:6,storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)},
      pokedex:{ownedSpecies:[3,22,53,67,55,149]},money:30000,bag:{items:[],pokeBalls:[]}}}};
  for(const evidence of [o.emulator,o.sram,o.playerMemory])Object.assign(evidence,{frame:o.frame,captureId:o.captureId});
  const state={schema:'pokemon-suite/postgame/v1',preparation:{phase:'complete'},fieldTeamPlan:teamPlan,
    agenda:{schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:null,entries:[],failures:{},workflows:{league:{receipt:{nativeSaveVerified:true,leagueEntries:1,savedGame:10}}}}};
  return {o,args:{world,story,mechanics},state};
}

test('the in-League owner is league-training only while its cycle is open (hall-sticker first, else league-rematch); league-training blocks generic shopping',()=>{
  const cycle={baseline:{leagueEntries:1,savedGame:10,sha256:'before'}},receipt={nativeSaveVerified:true,leagueEntries:2,savedGame:11};
  for(const [label,workflows,owner] of [
    ['training cycle',{training:{cycle}},'league-training'],
    ['hall-sticker first',{training:{cycle},records:{'hall-sticker':{cycle}}},'hall-sticker'],
    ['a closed training cycle',{training:{cycle:{...cycle,receipt}}},'league-rematch'],
    ['no cycle',{},'league-rematch'],
  ]){
    const {o,args,state}=controllerScene(ROOMS[0]);Object.assign(state.agenda.workflows,structuredClone(workflows));
    let controller=createPostgameController({...args,state,clock:()=>1000});controller.decide(o);
    assert.equal(controller.state().agenda.active,owner,label);
    assert.equal(controller.state().objective?.target?.map,ROOMS[0],label);
    controller=createPostgameController({...args,state:JSON.parse(JSON.stringify(controller.state())),clock:()=>1000});controller.decide(o);
    assert.equal(controller.state().agenda.active,owner,`${label} after restart`);
  }
  // Outside, league-training owns its budget: generic restocking does not claim the money.
  const {o,args,state}=controllerScene(CENTER);
  state.agenda.active='league-training';
  for(const e of postgameChecklist(o,state.agenda.workflows))if(e.id!=='league-training')state.agenda.failures[e.id]={attempts:1,retryAt:86400000};
  const controller=createPostgameController({...args,state,clock:()=>1000});controller.decide(o);
  assert.notEqual(controller.state().fieldCare.active?.kind,'shop',JSON.stringify(controller.state().fieldCare));
});

test('the controller refreshes the demand outside the League with the Bot setting, never inside',()=>{
  const legacy=LEGACY,seen={...legacy,firstSeenAt:at(0)};
  const inside=controllerScene(ROOMS[0]);inside.state.agenda.workflows.leagueExpShare={disabled:{...legacy}};
  const owner={enabled:true,resumedAt:at(1000)};
  let controller=createPostgameController({...inside.args,state:inside.state,clock:()=>T,leagueTraining:owner});
  assert.deepEqual(controller.state().agenda.workflows.leagueExpShare.disabled,seen,'the controller notes when it first saw the older record');
  controller=createPostgameController({...inside.args,state:controller.state(),clock:()=>T+2000,leagueTraining:owner});controller.decide(inside.o);
  assert.deepEqual(controller.state().agenda.workflows.leagueExpShare.disabled,seen,'never released inside the League');
  assert.equal(controller.state().agenda.workflows.leagueExpShare.demand,undefined);
  const outside=controllerScene(CENTER);outside.state.agenda.workflows.leagueExpShare={disabled:{...legacy}};
  controller=createPostgameController({...outside.args,state:outside.state,clock:()=>T,leagueTraining:{enabled:true,resumedAt:null}});controller.decide(outside.o);
  let s=controller.state().agenda.workflows.leagueExpShare;
  assert.deepEqual(s.disabled,seen,'no resume without an owner stamp');
  assert.equal(s.demand?.known,true);
  assert.equal(postgameChecklist(outside.o,controller.state().agenda.workflows).find(e=>e.id==='league-training').reason,PAUSED);
  controller=createPostgameController({...outside.args,state:JSON.parse(JSON.stringify(controller.state())),clock:()=>T+2000,leagueTraining:owner});controller.decide(outside.o);
  s=controller.state().agenda.workflows.leagueExpShare;
  assert.equal(s.disabled,undefined);
  assert.equal(s.history.at(-1).kind,'resumed');
});

// The owner control (Bot settings): pokemon_bot_settings.py writes the setting and,
// when it goes from off to on, the resume stamp; the host pushes a saved change to
// the running owner (bot-settings-changed), which re-reads the file.
test('the Bot settings file gives League training on by default, off only when turned off, and a resume only from a valid stamp',()=>{
  const at='2026-09-26T05:00:00.000Z';
  assert.deepEqual(share.leagueTrainingSetting(null),{enabled:true,resumedAt:null},'no file: the default');
  assert.deepEqual(share.leagueTrainingSetting({preferences:{shiny:'any'}}),{enabled:true,resumedAt:null},'a legacy file');
  // The setting sits beside the preferences, where an older host ignores it.
  assert.deepEqual(share.leagueTrainingSetting({preferences:{},leagueExpShareTraining:false,leagueExpShareResumedAt:at}),{enabled:false,resumedAt:at});
  assert.deepEqual(share.leagueTrainingSetting({preferences:{},leagueExpShareTraining:true,leagueExpShareResumedAt:at}),{enabled:true,resumedAt:at});
  for(const stamp of ['soon',12,null])
    assert.deepEqual(share.leagueTrainingSetting({preferences:{},leagueExpShareTraining:true,leagueExpShareResumedAt:stamp}),{enabled:true,resumedAt:null});
});

test('the session worker gives every postgame owner the League training setting and pushes a saved change to the running one',()=>{
  const worker=readFileSync(new URL('../src/suite/session-worker.js',import.meta.url),'utf8');
  const created=worker.match(/createPostgameClient\(/g).length;
  assert.ok(created>=8);
  assert.equal(worker.match(/createPostgameClient\(\{\.\.\.inputs,mechanics:inputs\.battle,qmmSupply:qmmSupplyOption\(\),leagueTraining:leagueTrainingOption\(\)/g)?.length,created);
  const option=worker.slice(worker.indexOf('function leagueTrainingOption(){'),worker.indexOf('const maintenancePath='));
  assert.match(option,/leagueTrainingSetting\(json\(join\(directory,'bot-settings\.json'\)\)\)/);
  const command=worker.slice(worker.indexOf("if(c.type==='bot-settings-changed')"),worker.indexOf("if(c.type==='preserve-source')"));
  assert.match(command,/await postgame\.setLeagueTraining\(leagueTrainingOption\(\)\)/);
  assert.ok(worker.indexOf("if(updateHold&&c.type!=='shutdown')")<worker.indexOf("if(c.type==='bot-settings-changed')"),'an update handoff reads the file when its owner restarts');
});

test('a pushed Bot setting reaches the running postgame planner and survives a planner restart',async t=>{
  const {createPostgameClient}=await import('../src/suite/postgame-client.js');
  const legacy=LEGACY;
  const {o,args,state}=controllerScene(CENTER);state.agenda.workflows.leagueExpShare={disabled:{...legacy}};
  const client=createPostgameClient({...args,state,leagueTraining:{enabled:true,resumedAt:null}});t.after(()=>client.close());
  let frame=o.frame;
  const later=()=>{const x=structuredClone(o);x.frame=frame+=600;for(const e of [x.emulator,x.sram,x.playerMemory])e.frame=x.frame;return x;};
  const s=()=>client.state().agenda.workflows.leagueExpShare;
  await client.decide(later());
  const seen=s().disabled;
  assert.deepEqual({...seen,firstSeenAt:undefined},{...legacy,firstSeenAt:undefined},'no resume stamp yet');
  // The owner resumes after the planner first saw the older record.
  await new Promise(done=>setTimeout(done,5));
  const owner={enabled:true,resumedAt:new Date().toISOString()};
  assert.ok(Date.parse(owner.resumedAt)>Date.parse(seen.firstSeenAt));
  await client.setLeagueTraining(owner);
  assert.equal(client.state().agenda.workflows.leagueExpShare.owner.resumedAt,owner.resumedAt,'the pushed setting is shown before the next decision');
  assert.match(postgameChecklist(o,client.state().agenda.workflows,teamPlan).find(e=>e.id==='league-training').reason,/^Resume requested in Bot settings\./);
  await client.decide(later());
  assert.equal(s().disabled,undefined,'the running planner applies the pushed resume');
  assert.deepEqual([s().history.at(-1).kind,s().history.at(-1).resumedAt],['resumed',owner.resumedAt]);
  // Turned off, then the planner worker is replaced: a protocol violation crashes it, the
  // supervisor relaunches it from its options twice and gives up, and the next call starts
  // a fresh worker from the same options.
  await client.setLeagueTraining({enabled:false,resumedAt:owner.resumedAt});
  await assert.rejects(client.command('not-a-planner-command'),/Invalid planner protocol message/);
  assert.equal(client.metrics().restarts,2);
  const off=later();await client.decide(off);
  assert.equal(s().demand.owner.enabled,false,'the relaunched planner keeps the pushed setting');
  assert.deepEqual(shape(postgameChecklist(off,client.state().agenda.workflows,teamPlan).find(e=>e.id==='league-training')),['complete',true,'Off in Bot settings.']);
  await assert.rejects(client.setLeagueTraining({enabled:'yes',resumedAt:null}),/Invalid League training setting/);
  const local=createPostgameController({...args,state:client.state()});
  assert.throws(()=>local.setLeagueTraining({enabled:true,resumedAt:5}),/Invalid League training setting/);
});

test('a hold is marked paused in the checklist; the other pending states are not',()=>{
  const o=composed(),legacy=LEGACY;
  const workflows={league:{receipt:RECEIPT},leagueExpShare:{disabled:{...legacy}}};
  // Before the controller's first refresh (a hunt may own the game) the hold still shows.
  assert.deepEqual(shape(entry(o,workflows)),['pending',false,PAUSED]);
  assert.equal(entry(o,workflows).paused,true);
  assert.equal(entry(o,{league:{receipt:RECEIPT}}).status,'unknown','without a hold the demand is unknown until then');
  refresh(o,workflows,{now:T});
  const held=entry(o,workflows);
  assert.deepEqual([held.status,held.executable,held.paused],['pending',false,true]);
  assert.match(held.reason,/^Paused after a battler fainted/);
  // A resume the controller has read but not yet applied (it waits for a free field decision).
  workflows.leagueExpShare.owner={enabled:true,resumedAt:at(1000)};
  assert.deepEqual([entry(o,workflows).paused,entry(o,workflows).reason],[true,'Resume requested in Bot settings. It applies at the next free moment outside the League.']);
  refresh(o,workflows,{owner:{enabled:true,resumedAt:at(1000)},now:T+2000});
  assert.deepEqual([entry(o,workflows).status,entry(o,workflows).paused],['pending',undefined]);
  const waiting={};refresh(o,waiting);
  assert.equal(entry(o,waiting).paused,undefined,'waiting for the stronger League victory is not a pause');
});

test('a run that ends without a new Hall of Fame entry drops its cycle, so a later League run is never counted as training',()=>{
  const o=composed(),workflows={league:{receipt:RECEIPT}};
  assert.equal(resolve('league-training',o,workflows).id,'postgame-league-rematch-battle-0');
  resolve('league-training',inRoom(o,0,{beaten:true}),workflows);
  // A whiteout: back at the Center with the count unchanged; the round is judged.
  const back=composed();resolve('league-training',back,workflows);
  assert.equal(workflows.leagueExpShare.disabled.reason,'round-not-won');
  const agenda=new PostgameAgenda({enabled:true,active:'league-training',entries:[],failures:{},workflows});
  agenda.observe(back);
  assert.ok(agenda.state.workflows.training.cycle,'kept while League training owns the agenda');
  agenda.state.active='hall-sticker';agenda.observe(back);
  assert.equal(agenda.state.workflows.training.cycle,undefined,'the finished run is dropped');
  // A Hall of Fame run by another owner then leaves the training count alone.
  const hof=composed({entries:5});hof.playerMemory.gameStats.savedGame=401;hof.sram={sha256:'b'.repeat(64)};
  agenda.observe({...hof,emulator:{mode:'hall-of-fame',callback2:'CB2_HofIdle'}});agenda.observe(hof);
  assert.equal(agenda.state.workflows.training.runs,undefined);
  // A cycle whose Hall of Fame was seen is never dropped, whoever owns the agenda.
  const seen={league:{receipt:RECEIPT},training:{cycle:{baseline:{leagueEntries:4,savedGame:400,sha256:SHA},hallOfFame:{frame:1}}}};
  const other=new PostgameAgenda({enabled:true,active:'hall-sticker',entries:[],failures:{},workflows:seen});
  other.observe(composed());
  assert.ok(other.state.workflows.training.cycle);
});

test('the presentation says which earlier goal League training waits for',()=>{
  const o=composed(),workflows={league:{receipt:RECEIPT}};refresh(o,workflows);
  const list=postgameChecklist(o,workflows,teamPlan),i=list.findIndex(e=>e.id==='league-training');
  const first=list.slice(0,i).find(e=>e.status==='pending'&&e.executable&&!e.storageBlocked);
  assert.ok(first,'an earlier goal is ready in this fixture');
  const shown=agenda=>postgamePresentation(o,agenda).entries.find(e=>e.id==='league-training').reason;
  assert.equal(shown({enabled:true,active:null,failures:{},workflows}),`Venusaur Lv. 89 → Lv. 100 · waits for ${first.label}`);
  assert.equal(shown({enabled:true,active:'league-training',failures:{},workflows}),'Venusaur Lv. 89 → Lv. 100','not while it runs');
  assert.equal(list[i].reason,'Venusaur Lv. 89 → Lv. 100','the checklist itself is unchanged');
});
