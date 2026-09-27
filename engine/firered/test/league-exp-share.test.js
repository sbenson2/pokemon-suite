import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {resolvePostgameObjective} from '../src/suite/postgame-agenda.js';
import {leagueTrainingPaused} from '../src/suite/league-exp-share.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// Native League rematch observations (see battle-sense.test.js). The live team
// is Fearow, Golduck, Dragonite, Machamp (100), Persian (94) and Venusaur (89);
// its Exp. Share is held by a boxed Raichu.
const fixture=JSON.parse(readFileSync(new URL('../test-support/champion-rematch-tactics.json',import.meta.url)));
const {mechanics}=fixture;
const observed=label=>structuredClone(fixture.observations.find(x=>x.label===label).observation);
const FEAROW=22,GOLDUCK=55,DRAGONITE=149,PERSIAN=53,MACHAMP=68,VENUSAUR=3,RAICHU=26,DIGLETT=50,DUGTRIO=51;
const teamPlan={schema:'master-red/permanent-team-plan/v1',starterFamily:[1,2,3],
  permanentFamilies:[[1,2,3],[21,22],[52,53],[66,67,68],[54,55],[147,148,149]],acquisitions:[],utilityAcquisitions:[]};
const CENTER='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
const world={maps:[{id:CENTER,objectEvents:[{script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}],backgroundEvents:[],warpEvents:[],coordEvents:[],connections:[]}]};
const identity=p=>JSON.stringify([p.personality,p.otId]);
const member=(o,species)=>o.playerMemory.trainer.party.find(p=>p.species===species);
const boxed=(o,species)=>o.playerMemory.trainer.storage.pokemon.find(p=>p.species===species);

// The Indigo Plateau Pokemon Center between rounds, healed and stocked.
function center({diglett=true}={}) {
  const o=observed('lorelei-room-after-battle'),m=o.playerMemory;
  m.map.id=CENTER;o.emulator={mode:'overworld',inBattle:false,inputReady:true};o.phase='stable';
  m.ui=Object.fromEntries(Object.keys(m.ui).map(key=>[key,null]));
  for(const flag of [1208,1209,1210,1211])m.storyState.flagIds[flag]=false;
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
// The agenda reads trainer parties as the extracted list (the fixture keys them by id).
const agendaMechanics={...mechanics,trainers:Object.values(mechanics.trainers)};
const resolve=(o,state,context={})=>resolvePostgameObjective('league-rematch',o,world,state,{mechanics:agendaMechanics,teamPlan,protectedFingerprints:[],...context});

test('the League composes five sweep-level battlers and a PC Dex evolution trainee with the Exp. Share',()=>{
  // The starter-family Venusaur cannot be deposited, so it battles (level 90+).
  const state={},o=center(),m=o.playerMemory;member(o,VENUSAUR).level=95;
  const first=resolve(o,state);
  assert.equal(first.expShareTrainee?.species,DIGLETT,'the boxed Diglett (Dugtrio missing from the Dex) is the trainee');
  assert.equal(state.leagueExpShare?.lastPlan?.reason,'dex-level-evolution');
  // The Exp. Share is on a boxed Raichu: it visits the party first, while the
  // starter-family Venusaur (which the roster never deposits) stays.
  assert.equal(first.target.kind,'party-roster');
  assert.ok(first.target.requiredFingerprints.includes(encounterFingerprint(boxed(o,RAICHU))));
  assert.ok(first.target.requiredFingerprints.includes(encounterFingerprint(member(o,VENUSAUR))));
  assert.equal(first.minimumBattlePartySize,undefined,'the established-six roster yields to the composition');
  // Native storage result: Fearow boxed, Raichu withdrawn with the Exp. Share.
  const raichu=boxed(o,RAICHU),fearow=member(o,FEAROW);
  m.trainer.storage.pokemon=m.trainer.storage.pokemon.filter(p=>p!==raichu).concat({...fearow,box:0,slot:11});
  m.trainer.party=[...m.trainer.party.filter(p=>p!==fearow),{...raichu,level:40,hp:100,maxHp:100,status1:0,stats:{attack:90,defense:60,speed:100,spAttack:90,spDefense:80}}]
    .map((p,slot)=>({...p,slot}));
  const take=resolve(o,state);
  assert.deepEqual(take.target,{kind:'take-held-item',fingerprint:encounterFingerprint(member(o,RAICHU)),map:CENTER,itemId:182});
  member(o,RAICHU).heldItem=0;m.trainer.bag.items.push({itemId:182,quantity:1});
  const compose=resolve(o,state);
  assert.equal(compose.target.kind,'party-roster');
  const wanted=[VENUSAUR,FEAROW,GOLDUCK,DRAGONITE,MACHAMP].map(s=>s===FEAROW?fearow:member(o,s)).map(encounterFingerprint);
  for(const fp of wanted)assert.ok(compose.target.requiredFingerprints.includes(fp));
  assert.ok(compose.target.requiredFingerprints.includes(encounterFingerprint(boxed(o,DIGLETT))));
  assert.equal(compose.target.requiredFingerprints.length,6);
  // Native result: Persian and Raichu boxed; Fearow and Diglett withdrawn.
  const diglett=boxed(o,DIGLETT);
  m.trainer.party=[...m.trainer.party.filter(p=>![PERSIAN,RAICHU].includes(p.species)),{...fearow},
    {...diglett,level:20,hp:50,maxHp:50,status1:0,stats:{attack:40,defense:30,speed:60,spAttack:30,spDefense:40}}].map((p,slot)=>({...p,slot}));
  const give=resolve(o,state);
  assert.deepEqual(give.target,{kind:'give-held-item',fingerprint:encounterFingerprint(member(o,DIGLETT)),map:CENTER,itemId:182});
  member(o,DIGLETT).heldItem=182;m.trainer.bag.items=m.trainer.bag.items.filter(i=>i.itemId!==182);
  const ready=resolve(o,state);
  assert.ok(['object','heal-with-items'].includes(ready.target.kind)||ready.id.endsWith('-interact'),'composition is complete');
  assert.equal(ready.expShareTrainee.species,DIGLETT);
  if(ready.id==='postgame-league-rematch-battle-0')assert.equal(state.leagueExpShare.active,true);
});

test('without a Dex candidate the lowest team member below 100 trains, and the trainee never leads',()=>{
  const state={},o=center({diglett:false}),m=o.playerMemory;
  const first=resolve(o,state);
  assert.equal(first.expShareTrainee?.species,VENUSAUR);
  assert.equal(state.leagueExpShare?.lastPlan?.reason,'team-below-max-level');
  // With the Exp. Share already on Venusaur and Venusaur leading, only the lead moves.
  m.trainer.storage.pokemon.find(p=>p.species===RAICHU).heldItem=0;
  const venusaur=member(o,VENUSAUR);venusaur.heldItem=182;
  m.trainer.party=[venusaur,...m.trainer.party.filter(p=>p!==venusaur)].map((p,slot)=>({...p,slot}));
  const lead=resolve(o,state);
  assert.equal(lead.target.kind,'lead-party-member');
  assert.notEqual(lead.target.fingerprint,encounterFingerprint(member(o,VENUSAUR)));
});

test('fewer than five sweep-level battlers keep the full battle team',()=>{
  // Persian at 85 leaves four battlers at the sweep level (Champion ace + 15).
  const state={},o=center();member(o,PERSIAN).level=85;
  const round=resolve(o,state);
  assert.equal(round.expShareTrainee,undefined);
  assert.equal(round.minimumBattlePartySize,6);
  assert.equal(state.leagueExpShare?.lastPlan?.reason,'fewer-than-five-sweep-level-battlers');
});

test('shinies, eggs, protected Pokemon and Everstone holders are never the trainee',()=>{
  const exclude={
    shiny:(o,p)=>{p.shiny=true;},
    egg:(o,p)=>{p.isEgg=true;},
    protected:(o,p)=>[encounterFingerprint(p)],
    everstone:(o,p)=>{p.heldItem=195;},
  };
  for(const [label,apply] of Object.entries(exclude)){
    // The Dex candidate is skipped; Persian (94, the team's lowest) trains instead.
    const state={},o=center();member(o,VENUSAUR).level=95;
    const round=resolve(o,state,{protectedFingerprints:apply(o,boxed(o,DIGLETT))??[]});
    assert.equal(round.expShareTrainee?.species,PERSIAN,label);
    assert.equal(state.leagueExpShare.lastPlan.reason,'team-below-max-level',label);
    if(label==='egg')continue;
    // The starter Venusaur (89) can neither battle nor train: the full team stays.
    const alone={},v=center({diglett:false});
    const full=resolve(v,alone,{protectedFingerprints:apply(v,member(v,VENUSAUR))??[]});
    assert.equal(full.expShareTrainee,undefined,label);
    assert.equal(full.minimumBattlePartySize,6,label);
    assert.equal(alone.leagueExpShare.lastPlan.reason,'no-eligible-trainee',label);
  }
});

test('the composition keeps the Exp. Share for its trainee through menus and transient reads',()=>{
  // Native sequence: Raichu (25) was withdrawn with the Exp. Share, Fearow
  // boxed, and the item taken into the Bag. The general held-item policy then
  // gave it back to Raichu, the lowest member, and the composition looped.
  const state={},o=center({diglett:false}),m=o.playerMemory;
  const raichu=boxed(o,RAICHU),fearow=member(o,FEAROW);
  m.trainer.storage.pokemon=m.trainer.storage.pokemon.filter(p=>p!==raichu).concat({...fearow,box:0,slot:11});
  m.trainer.party=[...m.trainer.party.filter(p=>p!==fearow),{...raichu,heldItem:0,level:25,hp:60,maxHp:60,status1:0,
    stats:{attack:40,defense:30,speed:60,spAttack:40,spDefense:40}}].map((p,slot)=>({...p,slot}));
  m.trainer.bag.items.push({itemId:182,quantity:1});
  const compose=resolve(o,state);
  assert.equal(compose.target.kind,'party-roster');
  assert.equal(compose.expShareTrainee?.species,VENUSAUR);
  const advisors=createPolicyAdvisors({mechanics,world,teamPlan,campaignPlanner:{select:()=>compose,selectTraining:()=>null}});
  for(const ui of [{},{party:{stage:'choose-pokemon',cursor:0}}]){
    const view=structuredClone(o);view.playerMemory.ui={...Object.fromEntries(Object.keys(m.ui).map(key=>[key,null])),...ui};
    for(const advisor of advisors){
      const r=advisor.advise(view)?.recommendation;
      assert.ok(!/^equip-held-item-182/.test(r?.objective??''),`${advisor.id} equips the reserved Exp. Share: ${JSON.stringify(r)}`);
    }
  }
  // An unreadable party entry in the party menu keeps the composition going
  // instead of briefly selecting the League battle without a trainee.
  const blink=structuredClone(o);blink.playerMemory.trainer.partyValidity='unknown';
  blink.playerMemory.trainer.party=blink.playerMemory.trainer.party.filter(p=>p.species!==DRAGONITE);
  const held=resolve(blink,state);
  assert.equal(held.id,compose.id);
  assert.equal(held.expShareTrainee?.species,VENUSAUR);
});

test('a passive trainee is never a switch, shift or replacement target while others can fight',()=>{
  const labels=fixture.observations.filter(x=>x.observation.emulator.inBattle).map(x=>x.label);
  const targets=r=>r?.targetCommand==='pokemon'||r?.kind==='choose-party-member'||r?.targetOption==='yes'?r.targetPartySlot:null;
  let checked=0;
  for(const species of [FEAROW,GOLDUCK,DRAGONITE,PERSIAN,MACHAMP,VENUSAUR]) for(const label of labels) for(const hp of [1,0.45,0.15]) {
    const o=observed(label),b=o.playerMemory.battle;
    const trainee=member(o,species);if(!trainee||trainee.slot===b.playerPartySlot)continue;
    const value=Math.max(1,Math.floor(b.player.maxHp*hp));b.player.hp=value;b.battlers[b.player.battler].hp=value;
    const objective={id:'postgame-league-rematch-battle-3',importantBattle:true,battleCategory:'elite-four',
      target:{kind:'object',map:o.playerMemory.map.id,index:0},
      expShareTrainee:{personality:trainee.personality,otId:trainee.otId,species:trainee.species}};
    const r=createPolicyAdvisors({mechanics,world:{maps:[]},campaignPlanner:{select:()=>objective,selectTraining:()=>null}})
      .find(a=>a.id==='battle').advise(o)?.recommendation;
    assert.notEqual(targets(r),trainee.slot,`${label} hp=${hp} trainee=${species}: ${JSON.stringify(r)}`);
    checked++;
  }
  assert.ok(checked>100);
});

test('a passive trainee is a forced replacement only when every other member has fainted',()=>{
  const objectiveFor=o=>({id:'postgame-league-rematch-battle-3',importantBattle:true,battleCategory:'elite-four',
    target:{kind:'object',map:o.playerMemory.map.id,index:0},
    expShareTrainee:(({personality,otId,species})=>({personality,otId,species}))(member(o,VENUSAUR))});
  const recommend=o=>createPolicyAdvisors({mechanics,world:{maps:[]},campaignPlanner:{select:()=>objectiveFor(o),selectTraining:()=>null}})
    .find(a=>a.id==='battle').advise(o)?.recommendation;
  const faint=(o,keep)=>{
    const b=o.playerMemory.battle;b.player.hp=0;b.battlers[b.player.battler].hp=0;
    for(const p of o.playerMemory.trainer.party)if(!keep.includes(p.species))p.hp=0;
    o.playerMemory.trainer.usablePartyCount=o.playerMemory.trainer.party.filter(p=>p.hp>0).length;
    o.playerMemory.ui={party:{stage:'choose-pokemon',cursor:0}};return o;
  };
  // Venusaur's Grass attacks win the race against Tyranitar and Persian's do
  // not, but Persian can still fight, so the passive Venusaur stays out.
  const o=faint(observed('tyranitar-machamp-turn1'),[PERSIAN,VENUSAUR]);
  assert.equal(recommend(o).targetSpecies,PERSIAN);
  const last=faint(observed('tyranitar-machamp-turn1'),[VENUSAUR]);
  assert.equal(recommend(last).targetSpecies,VENUSAUR,'the last member still enters');
});

// Owner decision (Sept 26): one fainted battler in a round that is still won is
// a strike, not a hold, and training continues; once a trainee round starts the
// trainee stays protected for the rest of that round. Build 106 held at the
// first faint and dropped the trainee mid-round, which these two tests pinned.
// A Center where the composition finished: Venusaur holds the Exp. Share, not
// leading, and Machamp faints in Lorelei's room after she is beaten.
function strikeRound(){
  const state={},o=center({diglett:false});
  resolve(o,state);
  o.playerMemory.trainer.storage.pokemon.find(p=>p.species===RAICHU).heldItem=0;
  member(o,VENUSAUR).heldItem=182;
  const start=resolve(o,state);
  assert.equal(start.expShareTrainee?.species,VENUSAUR);
  state.leagueExpShare.active=true;state.leagueExpShare.trainee=state.leagueExpShare.lastPlan.trainee;
  const room=structuredClone(o);room.playerMemory.map.id='MAP_POKEMON_LEAGUE_LORELEIS_ROOM';
  room.playerMemory.storyState.flagIds[1208]=true;member(room,MACHAMP).hp=0;
  resolve(room,state,{teamPlan:undefined,protectedFingerprints:undefined});
  const s=state.leagueExpShare;
  assert.equal(s.disabled,undefined,`one fainted battler is a strike, not a hold (${JSON.stringify(s.disabled??null)})`);
  assert.deepEqual(s.round.faints.map(f=>f.species),[MACHAMP]);
  assert.ok(s.round.conditions.includes('battler-fainted'));
  const inside=resolve(structuredClone(room),state);
  assert.equal(inside.expShareTrainee?.species,VENUSAUR,'the trainee stays protected for the rest of the round');
  return {state,s,o};
}

test('one fainted battler in a won round is a strike: the trainee stays protected and trains again next round',()=>{
  const {state,s,o}=strikeRound();
  // The round is won (a new Hall of Fame entry) and the trainee gained experience.
  const won=structuredClone(o);won.playerMemory.gameStats.leagueEntries=5;member(won,VENUSAUR).experience+=36009;
  const next=resolve(won,state);
  assert.equal(s.round,undefined,'the round is judged');
  const judged=s.history.filter(h=>h.kind==='round').at(-1);
  assert.deepEqual([judged.baseline,judged.leagueEntries,judged.won,judged.faints.map(f=>f.species)],[4,5,true,[MACHAMP]]);
  assert.equal(s.disabled,undefined,'a strike keeps training');
  assert.ok(!s.history.some(h=>h.kind==='hold'),'no hold was recorded');
  assert.deepEqual([s.lastPlan.active,s.lastPlan.reason],[true,'team-below-max-level']);
  assert.equal(next.id,'postgame-league-rematch-battle-0');
  assert.equal(next.expShareTrainee?.species,VENUSAUR,'the trainee trains again next round');
  assert.equal(s.active,true,'battle-0 arms the next trainee round');
});

test('the same fainted battler in a lost round holds as round-not-won and records the faint',()=>{
  const {state,s}=strikeRound();
  // A whiteout returns to the Center with the Hall of Fame count unchanged.
  const next=resolve(center({diglett:false}),state);
  assert.deepEqual([s.disabled.reason,s.disabled.class],['round-not-won','hold']);
  assert.ok(s.disabled.conditions.includes('battler-fainted'),JSON.stringify(s.disabled));
  assert.equal(next.expShareTrainee,undefined);
  assert.equal(next.minimumBattlePartySize,6);
  assert.deepEqual([s.lastPlan.active,s.lastPlan.reason],[false,'disabled:round-not-won'],'a held trainee is not re-planned');
});

// Round bookkeeping and holds. The composed Center has Venusaur holding the
// (boxed Raichu's) Exp. Share, not leading; battle-0 opens a round.
const ROOMS=['LORELEIS','BRUNOS','AGATHAS','LANCES','CHAMPIONS'].map(name=>`MAP_POKEMON_LEAGUE_${name}_ROOM`);
const GAIN=36009,T=Date.parse('2026-09-26T05:00:00.000Z'),at=ms=>new Date(T+ms).toISOString();
function composed({entries=4,gain=0}={}){
  const o=center({diglett:false});
  boxed(o,RAICHU).heldItem=0;member(o,VENUSAUR).heldItem=182;
  o.playerMemory.gameStats.leagueEntries=entries;member(o,VENUSAUR).experience+=gain;return o;
}
// A League room with the earlier members beaten; `beaten` sets this room's flag.
function inRoom(o,room,{beaten=false,apply=()=>{}}={}){
  const r=structuredClone(o),m=r.playerMemory;m.map.id=ROOMS[room];r.sram={sha256:'a'.repeat(64)};
  for(let i=0;i<4;i++)m.storyState.flagIds[1208+i]=i<room||i===room&&beaten;
  apply(r);return r;
}
const shape=s=>[s.lastPlan.active,s.lastPlan.reason];
const rounds=s=>(s.history??[]).filter(h=>h.kind==='round');
// One trainee round from the composed Center to the next Center visit.
function playRound(state,{faint=false,won=true,context={}}={}){
  const base=rounds(state.leagueExpShare??{}).at(-1)?.leagueEntries??4,o=composed({entries:base});
  assert.equal(resolve(o,state,context).id,'postgame-league-rematch-battle-0',JSON.stringify(state.leagueExpShare?.lastPlan));
  resolve(inRoom(o,0),state,context);
  resolve(inRoom(o,0,{beaten:true,apply:r=>{if(faint)member(r,MACHAMP).hp=0;}}),state,context);
  return resolve(composed({entries:won?base+1:base,gain:GAIN}),state,context);
}

// Owner decision (Sept 26): two distinct fainted battlers in one round hold at
// once (build 106 held at the first faint), and the trainee stays protected.
test('two fainted battlers in one round hold at once; the trainee stays protected, the round is still judged and winning it does not lift the hold',()=>{
  const state={},o=composed();
  assert.equal(resolve(o,state).id,'postgame-league-rematch-battle-0');const s=state.leagueExpShare;
  resolve(inRoom(o,0),state);
  const first=resolve(inRoom(o,0,{beaten:true,apply:r=>{member(r,MACHAMP).hp=0;}}),state,{now:T});
  assert.equal(s.disabled,undefined,'the first fainted battler is a strike');
  assert.equal(first.expShareTrainee?.species,VENUSAUR);
  const inside=resolve(inRoom(o,1,{beaten:true,apply:r=>{member(r,DRAGONITE).hp=0;}}),state,{now:T+1000});
  assert.deepEqual([s.disabled.reason,s.disabled.class,s.disabled.leagueEntries,s.disabled.heldAt],['battler-fainted:multiple','hold',4,at(1000)]);
  assert.deepEqual(s.disabled.conditions,['battler-fainted']);
  assert.equal(s.history.at(-1).kind,'hold');
  assert.deepEqual(s.round.faints.map(f=>[f.species,f.room]),[[MACHAMP,0],[DRAGONITE,1]],'the hold keeps the round for its judgement');
  assert.equal(inside.expShareTrainee?.species,VENUSAUR,'the trainee stays protected for the rest of the round');
  // A later faint in the same round is recorded; the first hold stands.
  const later=resolve(inRoom(o,2,{beaten:true,apply:r=>{member(r,FEAROW).hp=0;}}),state,{now:T+2000});
  assert.equal(s.disabled.heldAt,at(1000));
  assert.equal(later.expShareTrainee?.species,VENUSAUR);
  const next=resolve(composed({entries:5,gain:GAIN}),state);
  assert.equal(s.disabled.reason,'battler-fainted:multiple','a won round does not lift the hold');
  assert.equal(s.round,undefined);
  assert.equal(s.active,false);
  const judged=rounds(s).at(-1);
  assert.deepEqual([judged.baseline,judged.leagueEntries,judged.won,judged.faints.length,judged.expGain],[4,5,true,3,GAIN]);
  assert.deepEqual(shape(s),[false,'disabled:battler-fainted:multiple']);
  // The rule is two or more: several faints can be read in one observation.
  assert.match(leagueTrainingPaused(s.disabled),/^Paused after two or more battlers fainted in one League round at Hall of Fame entry 4\./);
  assert.deepEqual(next.target,{kind:'take-held-item',fingerprint:encounterFingerprint(member(o,VENUSAUR)),map:CENTER,itemId:182},'the Exp. Share returns');
});

test('the same battler fainting in two rooms of one won round is two faints: a hold',()=>{
  // Owner decision (Sept 26): "It pauses on 2 faints in one round" — faints, not distinct battlers.
  const state={},o=composed();resolve(o,state);const s=state.leagueExpShare;
  resolve(inRoom(o,0),state);
  resolve(inRoom(o,0,{beaten:true,apply:r=>{member(r,MACHAMP).hp=0;}}),state);
  assert.equal(s.disabled,undefined,'one faint is a strike');
  resolve(inRoom(o,1,{beaten:true,apply:r=>{member(r,MACHAMP).hp=0;}}),state);
  assert.deepEqual(s.round.faints.map(f=>[f.species,f.room]),[[MACHAMP,0],[MACHAMP,1]]);
  resolve(composed({entries:5,gain:GAIN}),state);
  assert.equal(s.disabled?.reason,'battler-fainted:multiple');
  assert.equal(rounds(s).at(-1).faints.length,2);
  assert.deepEqual(shape(s),[false,'disabled:battler-fainted:multiple']);
});

// Owner decision (Sept 26): a faint in two of the last five judged trainee rounds holds.
test('strikes in rounds 1 and 4 hold as battler-fainted:repeat; strikes in rounds 1 and 7 do not',()=>{
  const play=faintIn=>{
    const state={};
    for(let round=1;round<=Math.max(...faintIn);round++){
      playRound(state,{faint:faintIn.includes(round)});
      if(state.leagueExpShare.disabled)return {state,round};
    }
    return {state,round:null};
  };
  const held=play([1,4]),s=held.state.leagueExpShare;
  assert.equal(held.round,4);
  assert.deepEqual([s.disabled.reason,s.disabled.class,s.disabled.leagueEntries],['battler-fainted:repeat','hold',8]);
  assert.ok(s.disabled.conditions.includes('battler-fainted'));
  assert.deepEqual(rounds(s).map(r=>r.faints.length),[1,0,0,1]);
  assert.deepEqual(shape(s),[false,'disabled:battler-fainted:repeat']);
  assert.match(leagueTrainingPaused(s.disabled),/^Paused after battlers fainted in two of the last five League rounds at Hall of Fame entry 8\./);
  // The window is the last five judged rounds: rounds 1 and 5 share it, 1 and 6 do not.
  assert.equal(play([1,5]).state.leagueExpShare.disabled?.reason,'battler-fainted:repeat');
  for(const faints of [[1,6],[1,7]]){
    const {state,round}=play(faints),free=state.leagueExpShare;
    assert.equal(round,null,`${faints}: ${JSON.stringify(free.disabled??null)}`);
    assert.equal(free.disabled,undefined);
    assert.deepEqual(shape(free),[true,'team-below-max-level'],`${faints}`);
    assert.equal(playRound(state).id,'postgame-league-rematch-battle-0','training goes on');
  }
});

test('a round that ends without a new Hall of Fame entry holds as round-not-won',()=>{
  const state={},o=composed();resolve(o,state);
  resolve(inRoom(o,0,{beaten:true}),state);
  // A whiteout returns to the Center with the counter unchanged.
  const next=resolve(center({diglett:false}),state),s=state.leagueExpShare;
  assert.deepEqual([s.disabled.reason,s.disabled.class],['round-not-won','hold']);
  assert.equal(s.round,undefined);
  assert.equal(s.active,false);
  assert.equal(next.expShareTrainee,undefined);
  assert.equal(next.minimumBattlePartySize,6);
  assert.deepEqual(shape(s),[false,'disabled:round-not-won'],'a held trainee is not re-planned');
  // After an earlier hold (two fainted battlers) the lost round adds its condition to it.
  const lost={},l=composed();resolve(l,lost);
  resolve(inRoom(l,0,{beaten:true,apply:r=>{member(r,MACHAMP).hp=0;member(r,DRAGONITE).hp=0;}}),lost);
  resolve(center({diglett:false}),lost);
  assert.equal(lost.leagueExpShare.disabled.reason,'battler-fainted:multiple');
  assert.deepEqual(lost.leagueExpShare.disabled.conditions,['battler-fainted','round-not-won']);
});

test('trainee damage seen with a faint holds as trainee-entered-battle with both conditions',()=>{
  const state={},o=composed();resolve(o,state);const s=state.leagueExpShare;
  const room=inRoom(o,0,{beaten:true,apply:r=>{member(r,MACHAMP).hp=0;member(r,VENUSAUR).hp=member(r,VENUSAUR).maxHp-1;}});
  resolve(room,state);
  assert.equal(s.disabled.reason,'trainee-entered-battle');
  assert.ok(['trainee-entered-battle','battler-fainted'].every(c=>s.disabled.conditions.includes(c)),JSON.stringify(s.disabled));
  // Owner decision (Sept 26): the trainee stays protected for the whole round, even after a hold.
  assert.equal(resolve(room,state).expShareTrainee?.species,VENUSAUR,'the trainee stays protected for the rest of the round');
  assert.equal(resolve(inRoom(o,1),state).expShareTrainee?.species,VENUSAUR);
});

test('an unreadable party inside the League defers the verdict',()=>{
  const state={},o=composed();resolve(o,state);const s=state.leagueExpShare;
  resolve(inRoom(o,0),state);
  const round=structuredClone(s.round);
  const blink=inRoom(o,0,{apply:r=>{const t=r.playerMemory.trainer;t.partyValidity='unknown';t.party=t.party.filter(p=>p.species!==VENUSAUR);}});
  assert.equal(resolve(blink,state).expShareTrainee?.species,VENUSAUR);
  assert.equal(s.disabled,undefined);
  assert.deepEqual(s.round,round);
  resolve(inRoom(o,0),state);
  assert.equal(s.disabled,undefined);
  assert.deepEqual(s.round,round);
});

test('a trainee missing from a valid party read holds',()=>{
  const state={},o=composed();resolve(o,state);const s=state.leagueExpShare;
  resolve(inRoom(o,0,{apply:r=>{const t=r.playerMemory.trainer;t.party=t.party.filter(p=>p.species!==VENUSAUR);}}),state);
  assert.equal(s.disabled.reason,'trainee-left-party');
  assert.equal(s.disabled.class,'hold');
  assert.equal(typeof s.disabled.heldAt,'string');
  assert.ok(s.round,'the hold keeps the round for its judgement');
});

test('an unreadable Hall of Fame counter keeps the round open and the full team',()=>{
  const state={},o=composed();resolve(o,state);const s=state.leagueExpShare;
  resolve(inRoom(o,0,{beaten:true}),state);
  const blind=composed({gain:GAIN});delete blind.playerMemory.gameStats.leagueEntries;
  const full=resolve(blind,state);
  assert.ok(s.round,'the round stays open');
  assert.deepEqual(shape(s),[false,'round-unjudged']);
  assert.equal(full.expShareTrainee,undefined);
  assert.equal(full.minimumBattlePartySize,6);
  assert.equal(s.disabled,undefined);
  assert.equal(rounds(s).length,0,'never counted as a win');
  const next=resolve(composed({entries:5,gain:GAIN}),state);
  assert.equal(s.round,undefined);
  assert.deepEqual([rounds(s).at(-1).baseline,rounds(s).at(-1).leagueEntries],[4,5]);
  assert.equal(s.disabled,undefined);
  assert.equal(next.expShareTrainee?.species,VENUSAUR);
});

test('the Hall of Fame scene is never judged, whatever the map id',()=>{
  const state={},o=composed();resolve(o,state);const s=state.leagueExpShare;
  resolve(inRoom(o,0,{beaten:true}),state);
  const scene=composed({entries:4});scene.emulator.mode='hall-of-fame';
  resolve(scene,state);
  const walk=composed({entries:4});walk.playerMemory.map.id='MAP_POKEMON_LEAGUE_HALL_OF_FAME';
  resolve(walk,state);
  assert.ok(s.round);
  assert.equal(s.disabled,undefined);
});

// A won round from the composed Center, with its Exp. Share experience and payout.
function wonRound(){
  const state={},o=composed();o.playerMemory.trainer.money=100000;resolve(o,state);const s=state.leagueExpShare;
  resolve(inRoom(o,0),state);
  assert.deepEqual([s.round.traineeExperience,s.round.money],[member(o,VENUSAUR).experience,100000]);
  const after=composed({entries:5,gain:GAIN});after.playerMemory.trainer.money=112000;member(after,MACHAMP).hp=1;
  resolve(after,state);
  return {state,s,o};
}

test('a won round closes the round, clears active and records exp and money',()=>{
  const {s}=wonRound();
  assert.equal(s.round,undefined);
  assert.equal(s.active,false);
  const judged=s.history.at(-1);
  assert.deepEqual([judged.kind,judged.expGain,judged.moneyDelta,judged.trainee.species,judged.trainee.level],['round',GAIN,12000,VENUSAUR,89]);
  assert.equal(typeof judged.at,'string');
  assert.equal(s.disabled,undefined);
});

test('a stale active flag never starts a round',()=>{
  const {state,s,o}=wonRound();
  // Entering Lorelei's room without a battle-0 Center decision (Venusaur boxed).
  const room=inRoom(o,0,{apply:r=>{const t=r.playerMemory.trainer,v=member(r,VENUSAUR);t.party=t.party.filter(p=>p!==v);t.storage.pokemon.push({...v,box:0,slot:12});}});
  const inside=resolve(room,state);
  assert.equal(s.round,undefined);
  assert.equal(s.disabled,undefined);
  assert.equal(inside.expShareTrainee,undefined);
});

test('a blocked intermission holds, an unreadable party included; the League recovery still stops the bot',()=>{
  const state={},o=composed();resolve(o,state);const s=state.leagueExpShare;
  resolve(inRoom(o,0),state);
  const blink=inRoom(o,0,{beaten:true,apply:r=>{r.playerMemory.trainer.partyValidity='unknown';}});
  const unknown=resolve(blink,state);
  assert.deepEqual([unknown.target.kind,unknown.target.reason],['stop-for-review','league-party-state-unknown']);
  assert.deepEqual([s.disabled.reason,s.disabled.class],['league-recovery:league-party-state-unknown','hold']);
  assert.ok(s.round.conditions.includes('league-recovery:league-party-state-unknown'),JSON.stringify(s.round));
  // Owner decision (Sept 26): the hold stays, and the trainee stays protected for the whole round.
  assert.equal(resolve(blink,state).expShareTrainee?.species,VENUSAUR,'the trainee stays protected for the rest of the round');
  const dry={},d=composed();resolve(d,dry);resolve(inRoom(d,0),dry);
  const stop=resolve(inRoom(d,0,{beaten:true,apply:r=>{member(r,MACHAMP).hp=1;const bag=r.playerMemory.trainer.bag;
    for(const pocket of Object.keys(bag))if(pocket!=='keyItems')bag[pocket]=[];}}),dry);
  assert.deepEqual([stop.target.kind,stop.target.reason],['stop-for-review','league-recovery-supplies-exhausted']);
  assert.deepEqual([dry.leagueExpShare.disabled.reason,dry.leagueExpShare.disabled.class],['league-recovery:league-recovery-supplies-exhausted','hold']);
});

test('a Center visit that cannot compose the trainee holds and keeps the full team',()=>{
  const state={},o=center({diglett:false});
  for(const p of o.playerMemory.trainer.party)if(p.species!==VENUSAUR)p.heldItem=121;
  const full=resolve(o,state,{now:T}),s=state.leagueExpShare,reason='composition:No party member can make room for the boxed Exp. Share holder.';
  assert.deepEqual([s.disabled.reason,s.disabled.class,s.disabled.heldAt,s.disabled.map],[reason,'hold',at(0),CENTER]);
  assert.equal(full.expShareTrainee,undefined);
  assert.equal(full.minimumBattlePartySize,6);
  assert.equal(full.id,'postgame-league-rematch-battle-0');
  assert.equal(s.active,false);
  // Later visits keep the full team; the hold is recorded once.
  resolve(o,state);
  assert.deepEqual(shape(s),[false,`disabled:${reason}`]);
  assert.equal(s.history.filter(h=>h.kind==='hold').length,1);
});

test('a hold from an earlier engine stays held until an owner resume newer than its first sighting',()=>{
  const legacy={reason:'battler-fainted',leagueEntries:101,frame:16496570,map:'MAP_POKEMON_LEAGUE_AGATHAS_ROOM'};
  const state={leagueExpShare:{disabled:{...legacy}}},o=composed({entries:200}),s=state.leagueExpShare;
  const held=resolve(o,state,{now:T,leagueTraining:{enabled:true,resumedAt:null}});
  assert.deepEqual(shape(s),[false,'disabled:battler-fainted']);
  assert.deepEqual(s.disabled,{...legacy,firstSeenAt:at(0)},'this engine records when it first saw the record');
  assert.equal(held.expShareTrainee,undefined);
  // A resume stamped before that first sighting does not release it.
  resolve(o,state,{now:T+2000,leagueTraining:{enabled:true,resumedAt:at(-1000)}});
  assert.deepEqual(s.disabled,{...legacy,firstSeenAt:at(0)});
  const owner={enabled:true,resumedAt:at(1000)};
  const resumed=resolve(o,state,{now:T+2000,leagueTraining:owner});
  assert.equal(s.disabled,undefined);
  const entry=s.history.at(-1);
  assert.deepEqual([entry.kind,entry.hold.reason,entry.hold.leagueEntries,entry.resumedAt],['resumed','battler-fainted',101,owner.resumedAt]);
  assert.deepEqual(shape(s),[true,'team-below-max-level']);
  assert.equal(resumed.expShareTrainee?.species,VENUSAUR);
  // A later record from an earlier engine (after a rollback) waits for a newer resume, whatever the history holds.
  s.disabled={...legacy};s.active=false;s.history=Array.from({length:50},(_,i)=>({kind:'round',baseline:i,leagueEntries:i+1,faints:[]}));
  resolve(o,state,{now:T+3000,leagueTraining:owner});
  assert.deepEqual(s.disabled,{...legacy,firstSeenAt:at(3000)});
  resolve(o,state,{now:T+5000,leagueTraining:{enabled:true,resumedAt:at(4000)}});
  assert.equal(s.disabled,undefined);
});

test('resume waits for the outside and a judged round, never predates the hold, and keeps the strikes: a faint after it holds as repeat',()=>{
  // Owner decision (Sept 26): one faint is a strike, so the hold here comes from two.
  const state={},o=composed();resolve(o,state,{now:T});const s=state.leagueExpShare;
  resolve(inRoom(o,0,{beaten:true,apply:r=>{member(r,MACHAMP).hp=0;member(r,DRAGONITE).hp=0;}}),state,{now:T+1000});
  assert.deepEqual([s.disabled.reason,s.disabled.heldAt],['battler-fainted:multiple',at(1000)]);
  const later={enabled:true,resumedAt:at(2000)};
  resolve(inRoom(o,1),state,{now:T+3000,leagueTraining:later});
  assert.equal(s.disabled?.reason,'battler-fainted:multiple','never released inside the League');
  const blind=composed({gain:GAIN});delete blind.playerMemory.gameStats.leagueEntries;
  resolve(blind,state,{now:T+3000,leagueTraining:later});
  assert.equal(s.disabled?.reason,'battler-fainted:multiple','never released with the round unjudged');
  assert.ok(s.round);
  // A resume stamped before the hold does not release it, and off releases nothing.
  resolve(composed({entries:5,gain:GAIN}),state,{now:T+3000,leagueTraining:{enabled:true,resumedAt:at(500)}});
  assert.equal(s.round,undefined);
  assert.equal(s.disabled?.reason,'battler-fainted:multiple');
  resolve(composed({entries:5}),state,{now:T+3000,leagueTraining:{enabled:false,resumedAt:at(2000)}});
  assert.equal(s.disabled?.reason,'battler-fainted:multiple');
  const next=resolve(composed({entries:5}),state,{now:T+4000,leagueTraining:later});
  assert.equal(s.disabled,undefined);
  assert.deepEqual(s.history.slice(-2).map(h=>h.kind),['round','resumed']);
  assert.equal(next.expShareTrainee?.species,VENUSAUR);
  // The held round still counts in the strike window: one more faint holds.
  playRound(state,{faint:true,context:{now:T+5000,leagueTraining:later}});
  assert.deepEqual([s.disabled?.reason,s.disabled?.heldAt],['battler-fainted:repeat',at(5000)]);
});

test('after a battler-fainted:repeat hold and a resume, a clean round trains on; the next faint within the window holds again',()=>{
  // Strikes in rounds 1 and 2 hold as repeat.
  const state={};
  playRound(state,{faint:true,context:{now:T}});
  assert.equal(state.leagueExpShare.disabled,undefined,'the first strike keeps training');
  playRound(state,{faint:true,context:{now:T+1000}});
  const s=state.leagueExpShare;
  assert.deepEqual([s.disabled?.reason,s.disabled?.heldAt],['battler-fainted:repeat',at(1000)]);
  // The owner resumes. The next round is won with no faint: the two earlier
  // strikes stay in the window, but a round without a faint is no new strike.
  const owner={enabled:true,resumedAt:at(2000)};
  playRound(state,{context:{now:T+3000,leagueTraining:owner}});
  assert.equal(s.disabled,undefined,`a clean round after the resume trains on (${JSON.stringify(s.disabled??null)})`);
  assert.deepEqual(rounds(s).map(r=>r.faints.length),[1,1,0]);
  assert.equal(s.history.filter(h=>h.kind==='hold').length,1,'no second hold');
  assert.deepEqual(shape(s),[true,'team-below-max-level']);
  // One more faint within five rounds of the earlier ones holds again.
  playRound(state,{faint:true,context:{now:T+4000,leagueTraining:owner}});
  assert.deepEqual([s.disabled?.reason,s.disabled?.heldAt],['battler-fainted:repeat',at(4000)]);
  assert.deepEqual(rounds(s).map(r=>r.faints.length),[1,1,0,1]);
  assert.match(leagueTrainingPaused(s.disabled,owner),/^Paused after battlers fainted in two of the last five League rounds at Hall of Fame entry 8\./);
});

test('Bot settings off plans no trainee and returns the lent item',()=>{
  const LEFTOVERS=200,state={},o=composeVenusaur(state,LEFTOVERS);
  assert.equal(resolve(o,state).target.itemId,LEFTOVERS);moveItem(o,member(o,VENUSAUR),LEFTOVERS,{give:false});
  assert.equal(resolve(o,state).target.itemId,182);moveItem(o,member(o,VENUSAUR),182,{give:true});
  assert.equal(resolve(o,state).expShareTrainee?.species,VENUSAUR);
  const off={leagueTraining:{enabled:false,resumedAt:null}};
  const back=resolve(o,state,off);
  assert.deepEqual(shape(state.leagueExpShare),[false,'owner-off']);
  assert.deepEqual(back.target,{kind:'take-held-item',fingerprint:encounterFingerprint(member(o,VENUSAUR)),map:CENTER,itemId:182});
  moveItem(o,member(o,VENUSAUR),182,{give:false});
  const restore=resolve(o,state,off);
  assert.deepEqual(restore.target,{kind:'give-held-item',fingerprint:encounterFingerprint(member(o,VENUSAUR)),map:CENTER,itemId:LEFTOVERS});
  moveItem(o,member(o,VENUSAUR),LEFTOVERS,{give:true});
  const full=resolve(o,state,off);
  assert.equal(full.expShareTrainee,undefined);
  assert.equal(full.minimumBattlePartySize,6);
  assert.equal(state.leagueExpShare.disabled,undefined,'off is not a hold');
});

test('a filler current trainee yields to a team or Dex candidate after its item comes back',()=>{
  // Dugtrio is owned, so the boxed Diglett is no Dex candidate; it trained as filler.
  const state={},o=center(),m=o.playerMemory;member(o,VENUSAUR).level=95;m.trainer.pokedex.ownedSpecies.push(DUGTRIO);
  const diglett=boxed(o,DIGLETT);boxed(o,RAICHU).heldItem=0;diglett.heldItem=182;
  state.leagueExpShare={trainee:{personality:diglett.personality,otId:diglett.otId,species:DIGLETT,reason:'lowest-level-party-member',targetLevel:100},
    lent:{personality:diglett.personality,otId:diglett.otId,species:DIGLETT,ownItem:0},active:false};
  const first=resolve(o,state);
  assert.deepEqual([state.leagueExpShare.lastPlan.trainee?.species,state.leagueExpShare.lastPlan.reason],[PERSIAN,'team-below-max-level']);
  assert.equal(first.expShareTrainee?.species,DIGLETT,'the returning filler is shielded while its item comes back');
  assert.equal(first.target.kind,'party-roster');
  // Native result: Diglett withdrawn (Fearow boxed), then the Exp. Share taken back.
  const fearow=member(o,FEAROW);
  m.trainer.storage.pokemon=m.trainer.storage.pokemon.filter(p=>p!==diglett).concat({...fearow,box:0,slot:11});
  m.trainer.party=[...m.trainer.party.filter(p=>p!==fearow),{...diglett,level:20,hp:50,maxHp:50,status1:0,
    stats:{attack:40,defense:30,speed:60,spAttack:30,spDefense:40}}].map((p,slot)=>({...p,slot}));
  const take=resolve(o,state);
  assert.deepEqual(take.target,{kind:'take-held-item',fingerprint:encounterFingerprint(member(o,DIGLETT)),map:CENTER,itemId:182});
  moveItem(o,member(o,DIGLETT),182,{give:false});
  const next=resolve(o,state);
  assert.equal(state.leagueExpShare.lent,undefined);
  assert.equal(next.expShareTrainee?.species,PERSIAN);
  assert.equal(state.leagueExpShare.lastPlan.reason,'team-below-max-level');
});

test('the Dex tier tries every option and skips friendship-only and Shedinja rules',()=>{
  const KRABBY=98,CHANSEY=113,NINCADA=301,NINJASK=302;
  const add=(o,species,level,extra={})=>{
    const template=o.playerMemory.trainer.storage.pokemon.find(p=>p.species!==RAICHU&&!p.isEgg);
    o.playerMemory.trainer.storage.pokemon.push({...structuredClone(template),box:13,slot:20+species%9,species,personality:900000+species,
      otId:o.playerMemory.trainer.otId??template.otId,level,experience:level**3,heldItem:0,shiny:false,isEgg:false,moves:[10,0,0,0],pp:[35,0,0,0],...extra});
  };
  // The top-ranked source (Krabby, one level from Kingler) holds Mail; the Diglett option is planned.
  const state={},o=center();member(o,VENUSAUR).level=95;add(o,KRABBY,27,{heldItem:121});
  resolve(o,state);
  assert.deepEqual([state.leagueExpShare.lastPlan.trainee?.species,state.leagueExpShare.lastPlan.reason],[DIGLETT,'dex-level-evolution']);
  // A Nincada whose only missing entry is Shedinja and a friendship-only Chansey are no Dex candidates.
  const alone={},v=center({diglett:false});add(v,NINCADA,19);add(v,CHANSEY,40);v.playerMemory.trainer.pokedex.ownedSpecies.push(NINJASK);
  resolve(v,alone);
  assert.deepEqual([alone.leagueExpShare.lastPlan.trainee?.species,alone.leagueExpShare.lastPlan.reason],[VENUSAUR,'team-below-max-level']);
});

test('a round opened by an older engine ({leagueEntries} only) is judged without the gain check, and its faint is a strike',()=>{
  const older=o=>{const v=member(o,VENUSAUR);return {leagueExpShare:{trainee:{personality:v.personality,otId:v.otId,species:VENUSAUR,reason:'team-below-max-level',targetLevel:100},
    active:true,round:{leagueEntries:4}}};};
  const o=composed(),clean=older(o);
  assert.equal(resolve(inRoom(o,2),clean).expShareTrainee?.species,VENUSAUR,'the older round keeps its trainee');
  resolve(composed({entries:5}),clean);
  const c=clean.leagueExpShare;
  assert.deepEqual([rounds(c).at(-1).baseline,rounds(c).at(-1).faints.length,rounds(c).at(-1).expGain],[4,0,null]);
  assert.equal(c.disabled,undefined,'the missing experience baseline skips the gain check');
  assert.deepEqual(shape(c),[true,'team-below-max-level']);
  // Owner decision (Sept 26): the live incident's shape. Dragonite's faint in
  // Agatha's room is a strike (build 106 held here), the trainee stays protected.
  const state=older(o),s=state.leagueExpShare;
  const agatha=resolve(inRoom(o,2,{apply:r=>{member(r,DRAGONITE).hp=0;}}),state);
  assert.equal(s.disabled,undefined,'one fainted battler is a strike');
  assert.equal(agatha.expShareTrainee?.species,VENUSAUR);
  assert.deepEqual(s.round.faints.map(f=>[f.species,f.room]),[[DRAGONITE,2]]);
  // A JSON restart keeps the round and its faint; winning it keeps training.
  const restarted=JSON.parse(JSON.stringify(state));
  assert.equal(resolve(inRoom(o,3),restarted).expShareTrainee?.species,VENUSAUR);
  resolve(composed({entries:5}),restarted);
  const r=restarted.leagueExpShare;
  assert.deepEqual([rounds(r).at(-1).baseline,rounds(r).at(-1).faints.length],[4,1]);
  assert.equal(r.disabled,undefined);
  assert.deepEqual(shape(r),[true,'team-below-max-level']);
  // A second fainted battler in the older round holds at once.
  assert.equal(resolve(inRoom(o,3,{apply:r=>{member(r,PERSIAN).hp=0;}}),state).expShareTrainee?.species,VENUSAUR);
  assert.equal(s.disabled.reason,'battler-fainted:multiple');
});

test('no experience gain in a won trainee round holds as no-experience-gain',()=>{
  const state={},o=composed();resolve(o,state);const s=state.leagueExpShare;
  resolve(inRoom(o,0),state);
  resolve(composed({entries:5}),state);
  assert.equal(s.disabled?.reason,'no-experience-gain');
  assert.equal(rounds(s).at(-1).expGain,0);
  assert.deepEqual(shape(s),[false,'disabled:no-experience-gain']);
});

test('League rounds that run anyway train a boxed family member below 100; the driver keeps to one member per family',()=>{
  // A second, boxed Machop (Machamp's family) at level 40; the battle six are all 100.
  const o=center({diglett:false});for(const p of o.playerMemory.trainer.party)p.level=100;
  const template=boxed(o,RAICHU);
  o.playerMemory.trainer.storage.pokemon.push({...structuredClone(template),box:13,slot:28,species:66,personality:880066,
    otId:o.playerMemory.trainer.otId??template.otId,level:40,experience:40**3,heldItem:0,shiny:false,isEgg:false,moves:[10,0,0,0],pp:[35,0,0,0]});
  const state={};
  assert.deepEqual([resolve(o,state).expShareTrainee?.species,state.leagueExpShare.lastPlan.reason],[66,'team-below-max-level']);
  const driver={};resolve(o,driver,{requireTrainee:true});
  assert.deepEqual(shape(driver.leagueExpShare),[false,'no-eligible-trainee']);
});

test('a trainee that evolved rotates out for the next candidate at the next round',()=>{
  const state={},o=center();member(o,VENUSAUR).level=95;
  const first=resolve(o,state);
  assert.equal(first.expShareTrainee?.species,DIGLETT);
  state.leagueExpShare.trainee=state.leagueExpShare.lastPlan.trainee;state.leagueExpShare.active=true;
  // After the round the boxed trainee is a Dugtrio (the Dex entry is registered).
  const later=center(),digletts=later.playerMemory.trainer.storage.pokemon.filter(p=>p.species===DIGLETT);
  member(later,VENUSAUR).level=95;
  Object.assign(digletts[0],{species:DUGTRIO,experience:26**3});
  later.playerMemory.trainer.pokedex.ownedSpecies.push(DUGTRIO);
  const next=resolve(later,state);
  assert.ok(state.leagueExpShare.completed.includes(identity(digletts[0])));
  assert.deepEqual(state.leagueExpShare.history.filter(h=>h.kind==='completed').map(h=>[h.trainee.species,h.reason]),[[DIGLETT,'evolved']]);
  assert.equal(next.expShareTrainee?.species,PERSIAN,'the next candidate (the lowest team member below 100) trains');
  // With every candidate at its target the round keeps the full battle team.
  const done=center({diglett:false});
  for(const p of done.playerMemory.trainer.party)p.level=100;
  const full=resolve(done,state);
  assert.equal(full.expShareTrainee,undefined);
  assert.equal(full.minimumBattlePartySize,6);
});

// Held-item moves with the native results of the take/give steps.
const bagCount=(o,itemId)=>(o.playerMemory.trainer.bag.items??[]).filter(i=>i.itemId===itemId).reduce((n,i)=>n+i.quantity,0);
function moveItem(o,holder,itemId,{give}){
  const items=o.playerMemory.trainer.bag.items,entry=items.find(i=>i.itemId===itemId);
  if(give){assert.ok(entry?.quantity>0,`item ${itemId} is in the Bag`);entry.quantity--;if(!entry.quantity)items.splice(items.indexOf(entry),1);holder.heldItem=itemId;}
  else{assert.equal(holder.heldItem,itemId);holder.heldItem=0;if(entry)entry.quantity++;else items.push({itemId,quantity:1});}
}
// No advisor moves the Exp. Share or a reserved own item while a step is pending.
function assertReserved(o,objective,itemIds,label){
  const advisors=createPolicyAdvisors({mechanics,world,teamPlan,campaignPlanner:{select:()=>objective,selectTraining:()=>null}});
  for(const ui of [{},{party:{stage:'choose-pokemon',cursor:0}}]){
    const view=structuredClone(o);view.playerMemory.ui={...Object.fromEntries(Object.keys(o.playerMemory.ui).map(key=>[key,null])),...ui};
    for(const advisor of advisors){
      const r=advisor.advise(view)?.recommendation;
      for(const itemId of itemIds)assert.ok(!new RegExp(`^equip-held-item-${itemId}-`).test(r?.objective??''),`${label}: ${advisor.id} moves item ${itemId}: ${JSON.stringify(r)}`);
    }
  }
}
// Compose Venusaur as the trainee from the fixture's boxed Raichu Exp. Share.
function composeVenusaur(state,own){
  const o=center({diglett:false}),m=o.playerMemory;
  member(o,VENUSAUR).heldItem=own;
  assert.equal(resolve(o,state).target.kind,'party-roster');
  const raichu=boxed(o,RAICHU),fearow=member(o,FEAROW);
  m.trainer.storage.pokemon=m.trainer.storage.pokemon.filter(p=>p!==raichu).concat({...fearow,box:0,slot:11});
  m.trainer.party=[...m.trainer.party.filter(p=>p!==fearow),{...raichu,level:25,hp:60,maxHp:60,status1:0,
    stats:{attack:40,defense:30,speed:60,spAttack:40,spDefense:40}}].map((p,slot)=>({...p,slot}));
  assert.equal(resolve(o,state).target.kind,'take-held-item');moveItem(o,member(o,RAICHU),182,{give:false});
  assert.equal(resolve(o,state).target.kind,'party-roster');
  const back=boxed(o,FEAROW),leaving=member(o,RAICHU);
  m.trainer.storage.pokemon=m.trainer.storage.pokemon.filter(p=>p!==back).concat({...leaving,box:0,slot:11});
  m.trainer.party=[...m.trainer.party.filter(p=>p!==leaving),{...back}].map((p,slot)=>({...p,slot}));
  return o;
}

test('the trainee gets its own held item back and the Exp. Share returns when the passive setup ends',()=>{
  const LEFTOVERS=200,state={},o=composeVenusaur(state,LEFTOVERS);
  // The composition takes Venusaur's own Leftovers into the Bag and records them.
  const take=resolve(o,state);
  assert.deepEqual(take.target,{kind:'take-held-item',fingerprint:encounterFingerprint(member(o,VENUSAUR)),map:CENTER,itemId:LEFTOVERS});
  moveItem(o,member(o,VENUSAUR),LEFTOVERS,{give:false});
  const give=resolve(o,state);
  assert.deepEqual(give.target,{kind:'give-held-item',fingerprint:encounterFingerprint(member(o,VENUSAUR)),map:CENTER,itemId:182});
  // While lent out, the general held-item policy leaves the reserved Leftovers in the Bag.
  assertReserved(o,give,[182,LEFTOVERS],'composition');
  moveItem(o,member(o,VENUSAUR),182,{give:true});
  const ready=resolve(o,state);
  assert.equal(ready.expShareTrainee?.species,VENUSAUR);
  assertReserved(o,ready,[LEFTOVERS],'ready');
  state.leagueExpShare.active=true;state.leagueExpShare.trainee=state.leagueExpShare.lastPlan.trainee;
  // A battler faints in Lorelei's room. Owner decision (Sept 26): that alone is
  // a strike (build 106 held here); the lost round (the count stays at 4) holds.
  const room=structuredClone(o);room.playerMemory.map.id='MAP_POKEMON_LEAGUE_LORELEIS_ROOM';
  room.playerMemory.storyState.flagIds[1208]=true;member(room,MACHAMP).hp=0;
  resolve(room,state);
  assert.equal(state.leagueExpShare.disabled,undefined);
  assert.equal(state.leagueExpShare.round.faints.length,1);
  // Next visit: the Exp. Share goes back to the Bag, then Venusaur's own Leftovers.
  const back=resolve(o,state);
  assert.equal(state.leagueExpShare.disabled.reason,'round-not-won');
  assert.deepEqual(back.target,{kind:'take-held-item',fingerprint:encounterFingerprint(member(o,VENUSAUR)),map:CENTER,itemId:182});
  assert.equal(back.expShareTrainee?.species,VENUSAUR,'the returning member stays shielded from other item policies');
  assert.equal(back.minimumBattlePartySize,undefined,'no roster change before its items are restored');
  moveItem(o,member(o,VENUSAUR),182,{give:false});
  const restore=resolve(o,state);
  assert.deepEqual(restore.target,{kind:'give-held-item',fingerprint:encounterFingerprint(member(o,VENUSAUR)),map:CENTER,itemId:LEFTOVERS});
  assertReserved(o,restore,[LEFTOVERS,182],'restore');
  moveItem(o,member(o,VENUSAUR),LEFTOVERS,{give:true});
  // Restored: the full team plays on; the Exp. Share is in the Bag for the general policy.
  const full=resolve(o,state);
  assert.equal(full.expShareTrainee,undefined);
  assert.equal(full.minimumBattlePartySize,6);
  assert.equal(member(o,VENUSAUR).heldItem,LEFTOVERS);
  assert.equal(bagCount(o,182),1);
  assert.equal(state.leagueExpShare.lent,undefined);
  assert.equal(state.leagueExpShare.restored?.itemId,LEFTOVERS);
});

test('a rotating trainee gets its own held item back before the next trainee is composed',()=>{
  const LEFTOVERS=200,state={},o=center(),m=o.playerMemory;member(o,VENUSAUR).level=95;
  boxed(o,DIGLETT).heldItem=LEFTOVERS;
  assert.equal(resolve(o,state).expShareTrainee?.species,DIGLETT);
  // Native storage results as in the composition test above.
  const raichu=boxed(o,RAICHU),fearow=member(o,FEAROW);
  m.trainer.storage.pokemon=m.trainer.storage.pokemon.filter(p=>p!==raichu).concat({...fearow,box:0,slot:11});
  m.trainer.party=[...m.trainer.party.filter(p=>p!==fearow),{...raichu,level:40,hp:100,maxHp:100,status1:0,stats:{attack:90,defense:60,speed:100,spAttack:90,spDefense:80}}]
    .map((p,slot)=>({...p,slot}));
  assert.equal(resolve(o,state).target.kind,'take-held-item');moveItem(o,member(o,RAICHU),182,{give:false});
  assert.equal(resolve(o,state).target.kind,'party-roster');
  const diglett=boxed(o,DIGLETT),persian=member(o,PERSIAN),raichuHere=member(o,RAICHU),fearowBoxed=boxed(o,FEAROW);
  m.trainer.storage.pokemon=m.trainer.storage.pokemon.filter(p=>p!==diglett&&p!==fearowBoxed).concat({...persian,box:0,slot:12},{...raichuHere,box:0,slot:13});
  m.trainer.party=[...m.trainer.party.filter(p=>![PERSIAN,RAICHU].includes(p.species)),{...fearowBoxed},
    {...diglett,level:20,hp:50,maxHp:50,status1:0,stats:{attack:40,defense:30,speed:60,spAttack:30,spDefense:40}}].map((p,slot)=>({...p,slot}));
  const take=resolve(o,state);
  assert.deepEqual(take.target,{kind:'take-held-item',fingerprint:encounterFingerprint(member(o,DIGLETT)),map:CENTER,itemId:LEFTOVERS});
  moveItem(o,member(o,DIGLETT),LEFTOVERS,{give:false});
  assert.equal(resolve(o,state).target.kind,'give-held-item');moveItem(o,member(o,DIGLETT),182,{give:true});
  resolve(o,state);state.leagueExpShare.active=true;state.leagueExpShare.trainee=state.leagueExpShare.lastPlan.trainee;
  // After the round the trainee is a Dugtrio (its Dex entry registered): it rotates out.
  Object.assign(member(o,DIGLETT),{species:DUGTRIO,experience:26**3});m.trainer.pokedex.ownedSpecies.push(DUGTRIO);
  const dugtrio=member(o,DUGTRIO);
  const back=resolve(o,state);
  assert.ok(state.leagueExpShare.completed.includes(identity(dugtrio)));
  assert.deepEqual(back.target,{kind:'take-held-item',fingerprint:encounterFingerprint(dugtrio),map:CENTER,itemId:182});
  assert.equal(back.expShareTrainee?.species,DUGTRIO);
  moveItem(o,dugtrio,182,{give:false});
  const restore=resolve(o,state);
  assert.deepEqual(restore.target,{kind:'give-held-item',fingerprint:encounterFingerprint(dugtrio),map:CENTER,itemId:LEFTOVERS});
  assertReserved(o,restore,[182,LEFTOVERS],'rotation restore');
  moveItem(o,dugtrio,LEFTOVERS,{give:true});
  // Only then is the next trainee (the boxed Persian, lowest team member) composed.
  const next=resolve(o,state);
  assert.equal(next.expShareTrainee?.species,PERSIAN);
  assert.equal(next.target.kind,'party-roster');
  assert.ok(next.target.requiredFingerprints.includes(encounterFingerprint(boxed(o,PERSIAN))));
  assert.equal(member(o,DUGTRIO).heldItem,LEFTOVERS);
});

test('a returned trainee whose own item left the Bag keeps its empty slot and the League continues',()=>{
  const KINGS_ROCK=187,state={},o=composeVenusaur(state,KINGS_ROCK);
  assert.equal(resolve(o,state).target.itemId,KINGS_ROCK);moveItem(o,member(o,VENUSAUR),KINGS_ROCK,{give:false});
  assert.equal(resolve(o,state).target.itemId,182);moveItem(o,member(o,VENUSAUR),182,{give:true});
  resolve(o,state);state.leagueExpShare.active=true;state.leagueExpShare.trainee=state.leagueExpShare.lastPlan.trainee;
  state.leagueExpShare.disabled={reason:'league-recovery:shortage',leagueEntries:4,frame:1,map:'MAP_POKEMON_LEAGUE_LORELEIS_ROOM'};
  // The King's Rock was used elsewhere meanwhile.
  o.playerMemory.trainer.bag.items=o.playerMemory.trainer.bag.items.filter(i=>i.itemId!==KINGS_ROCK);
  assert.equal(resolve(o,state).target.itemId,182);moveItem(o,member(o,VENUSAUR),182,{give:false});
  const full=resolve(o,state);
  assert.notEqual(full.target.kind,'stop-for-review');
  assert.equal(full.expShareTrainee,undefined);
  assert.equal(full.minimumBattlePartySize,6);
  assert.equal(state.leagueExpShare.restored?.missing,true);
  assert.equal(member(o,VENUSAUR).heldItem,0);
});
