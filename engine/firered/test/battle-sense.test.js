import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {partyMatchupPlan} from '../src/player/battle-model.js';
import {createCampaignPlanner} from '../src/player/campaign.js';
import {campaignTaskFixture} from '../test-support/campaign-task-fixture.js';

// Native observations from the retained live Champion rematch (Charmander
// variant, levels 72-75) against a level 89-100 team, replayed with the
// pre-change engine, plus the live Lorelei room after her rematch.
const fixture=JSON.parse(readFileSync(new URL('../test-support/champion-rematch-tactics.json',import.meta.url)));
const {mechanics}=fixture;
const FEAROW=22,GOLDUCK=55,DRAGONITE=149,MACHAMP=68;
const champion={id:'postgame-league-rematch-champion',importantBattle:true,battleCategory:'champion',
  target:{kind:'map-arrival',map:'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM',x:6,y:18}};
const observed=label=>structuredClone(fixture.observations.find(x=>x.label===label).observation);
const advise=(id,o,{objective=champion,training=null}={})=>createPolicyAdvisors({mechanics,world:{maps:[]},
  campaignPlanner:{select:()=>objective,selectTraining:()=>training}}).find(a=>a.id===id).advise(o)?.recommendation;
const battle=(o,options)=>advise('battle',o,options);
// Patch the active battler and, when the cartridge read it, its party entry.
function active(o,patch) {
  const b=o.playerMemory.battle;
  Object.assign(b.player,patch);Object.assign(b.battlers[b.player.battler],patch);
  const entry=o.playerMemory.trainer.party.find(p=>p.slot===b.playerPartySlot);
  if(entry)Object.assign(entry,patch);
}
const member=(o,species)=>o.playerMemory.trainer.party.find(p=>p.species===species);
const hydroPump=o=>active(o,{pp:o.playerMemory.battle.player.pp.map((pp,slot)=>slot===3?5:pp)});

test('a healthy level-100 Golduck keeps attacking the level-75 Champion Charizard',()=>{
  // The retained turn where the pre-change engine paid to switch Golduck out
  // for Fearow: the cartridge could not read Golduck's own party entry.
  for(const label of ['charizard-golduck-turn11-unreadable-entry','charizard-golduck-turn11']) {
    for(const withHydroPump of [true,false]) {
      const o=observed(label);if(withHydroPump)hydroPump(o);
      assert.deepEqual(battle(o),{kind:'choose-battle-command',targetCommand:'fight'},`${label} hydroPump=${withHydroPump}`);
    }
  }
  const o=observed('charizard-golduck-turn11-unreadable-entry');hydroPump(o);
  o.playerMemory.ui={battle:{stage:'move',cursor:0,battler:0}};
  assert.equal(battle(o).targetMoveId,56,'Hydro Pump is the knockout move');
});

test('a free-shift counter is not undone by the next paid turn',()=>{
  const shift=observed('charizard-shift-prompt');
  assert.deepEqual(battle(shift),{kind:'choose-menu-option',targetOption:'yes',targetPartySlot:1,
    targetSpecies:GOLDUCK,objective:'counter-announced-opponent'});
  shift.playerMemory.ui={party:{stage:'choose-pokemon',cursor:0}};
  assert.equal(battle(shift).targetSpecies,GOLDUCK,'the party menu keeps the same counter');
  // Charizard's opening hit, then the paid turn that previously switched out.
  for(const label of ['charizard-golduck-turn10','charizard-golduck-turn11-unreadable-entry'])
    assert.equal(battle(observed(label)).targetCommand,'fight',label);
});

test('no voluntary switch returns to a member withdrawn against the same opponent',()=>{
  // Participation mask 0b10100: Machamp (slot 4) already faced this Tyranitar.
  const recorded=observed('tyranitar-dragonite-bounce-turn2');
  assert.deepEqual(recorded.playerMemory.battle.sentPartyMasks,[20,0]);
  assert.equal(battle(recorded).targetCommand,'fight','a winning Dragonite stays');
  const hurt=observed('tyranitar-dragonite-bounce-turn2');active(hurt,{hp:93});
  assert.equal(battle(hurt).targetCommand,'fight','a narrow, hurt winner does not bounce back to Machamp');
  const doomed=observed('tyranitar-dragonite-bounce-turn2');active(doomed,{hp:62});
  const r=battle(doomed);
  assert.equal(r.targetCommand,'pokemon','an emergency may still leave');
  assert.equal(r.targetPartySlot,1,'but to Golduck, which wins after entry, not back to Machamp');
});

test('a member below half health that still wins its race stays in',()=>{
  const golduck=observed('charizard-golduck-turn10');active(golduck,{hp:130});
  assert.deepEqual(battle(golduck),{kind:'choose-battle-command',targetCommand:'fight'});
  const machamp=observed('tyranitar-machamp-turn1');active(machamp,{hp:89});
  assert.equal(battle(machamp).targetCommand,'fight');
});

test('a losing member switches only to a member that wins after the entry hit',()=>{
  // Golduck (Hydro Pump spent) now loses to Charizard, but every reserve
  // would lose after taking Charizard's entry hit, so it keeps attacking.
  const golduck=observed('charizard-golduck-turn11');active(golduck,{hp:130});
  assert.deepEqual(battle(golduck),{kind:'choose-battle-command',targetCommand:'fight'});
  // Fearow loses to Gyarados; Dragonite still wins after its entry hit.
  const fearow=observed('gyarados-fearow-turn8');active(fearow,{hp:151});
  const r=battle(fearow);
  assert.equal(r.targetCommand,'pokemon');
  assert.equal(r.targetPartySlot,member(fearow,DRAGONITE).slot);
  fearow.playerMemory.ui={party:{stage:'choose-pokemon',cursor:0}};
  assert.equal(battle(fearow).targetSpecies,DRAGONITE,'the party menu keeps the same winner');
});

test('a forced replacement keeps the only answer to a later opponent in reserve',()=>{
  // Fearow and Golduck have fainted. Dragonite and Machamp both beat Gyarados,
  // but Dragonite is the only member left that beats the remaining Charizard.
  const o=observed('gyarados-fearow-turn8');
  active(o,{hp:0});member(o,GOLDUCK).hp=0;member(o,MACHAMP).hp=250;
  o.playerMemory.trainer.usablePartyCount=o.playerMemory.trainer.party.filter(p=>p.hp>0).length;
  o.playerMemory.ui={party:{stage:'choose-pokemon',cursor:0}};
  assert.deepEqual(battle(o),{kind:'choose-party-member',targetPartySlot:member(o,MACHAMP).slot,
    targetSpecies:MACHAMP,objective:'replace-fainted-pokemon'});
});

test('a fresh full-HP opponent that the active member knocks out first is finished',()=>{
  const full=observed('tyranitar-machamp-turn1');
  assert.deepEqual(battle(full),{kind:'choose-battle-command',targetCommand:'fight',objective:'finish-current-opponent'});
  // Healing would hand Tyranitar a free turn; Low Kick knocks it out first.
  const hurt=observed('tyranitar-machamp-turn1');active(hurt,{hp:59});
  assert.deepEqual(battle(hurt),{kind:'choose-battle-command',targetCommand:'fight',objective:'finish-current-opponent'});
  hurt.playerMemory.ui={battle:{stage:'move',cursor:0,battler:0}};
  assert.equal(battle(hurt).targetMoveId,67);
});

function leagueRoom({map='MAP_POKEMON_LEAGUE_BRUNOS_ROOM',flags={1209:false},order=null}={}) {
  const o=observed('lorelei-room-after-battle'),m=o.playerMemory;
  m.map.id=map;Object.assign(m.storyState.flagIds,flags);
  for(const p of m.trainer.party)p.hp=p.maxHp;
  if(order)m.trainer.party=order.map((species,slot)=>({...member(o,species),slot}));
  m.ui=Object.fromEntries(Object.keys(m.ui).map(key=>[key,null]));
  return o;
}
const bruno={id:'postgame-league-rematch-battle-1',importantBattle:true,battleCategory:'elite-four',
  target:{kind:'object',map:'MAP_POKEMON_LEAGUE_BRUNOS_ROOM',index:0}};
const lead=(o,objective=bruno,training=null)=>advise('inventory',o,{objective,training});

test('the League orders a winning lead for the room first opponent from its trainer party',()=>{
  // FLAG_SYS_CAN_LINK_WITH_RS selects Bruno's rematch party: Steelix leads,
  // and the current Fearow lead loses that race while Dragonite wins it.
  const o=leagueRoom();
  assert.equal(o.playerMemory.trainer.party[0].species,FEAROW);
  assert.deepEqual(lead(o),{kind:'open-start-menu',objective:'lead-for-major-battle'});
  o.playerMemory.ui.startMenu={order:['pokedex','pokemon','bag','player','save','option','exit'],cursor:0};
  assert.deepEqual(lead(o),{kind:'choose-start-menu-item',targetItem:'pokemon',targetIndex:1,objective:'lead-for-major-battle'});
  o.playerMemory.ui.startMenu=null;o.playerMemory.ui.party={stage:'choose-pokemon',cursor:0};
  assert.deepEqual(lead(o),{kind:'choose-party-member',targetPartySlot:2,targetSpecies:DRAGONITE,objective:'lead-for-major-battle'});
  o.playerMemory.ui.party={stage:'selection-menu',cursor:2,selectedPartySlot:2,actions:['summary','switch','item','cancel']};
  assert.deepEqual(lead(o),{kind:'choose-party-action',targetAction:'switch',targetIndex:1,objective:'lead-for-major-battle'});
  o.playerMemory.ui.party={stage:'choose-switch-target',cursor:2,selectedPartySlot:2};
  assert.deepEqual(lead(o),{kind:'choose-party-member',targetPartySlot:0,targetSpecies:FEAROW,objective:'lead-for-major-battle'});
  // After the native swap the menu closes, and nothing is reordered again.
  const ordered=leagueRoom({order:[DRAGONITE,GOLDUCK,FEAROW,53,MACHAMP,3]});
  ordered.playerMemory.ui.party={stage:'choose-pokemon',cursor:0};
  assert.deepEqual(lead(ordered),{kind:'close-menu',objective:'lead-for-major-battle'});
  ordered.playerMemory.ui.party=null;
  assert.notEqual(lead(ordered)?.objective,'lead-for-major-battle');
});

test('League lead ordering keeps a winning lead, an unknown party and a training-owned lead',()=>{
  // Lorelei's rematch Dewgong loses to the Fearow lead.
  const lorelei=leagueRoom({map:'MAP_POKEMON_LEAGUE_LORELEIS_ROOM',flags:{1208:false}});
  assert.notEqual(lead(lorelei,{...bruno,id:'postgame-league-rematch-battle-0',
    target:{kind:'object',map:'MAP_POKEMON_LEAGUE_LORELEIS_ROOM',index:0}})?.objective,'lead-for-major-battle');
  const unknown=leagueRoom();delete unknown.playerMemory.storyState.flagIds[2116];
  assert.notEqual(lead(unknown)?.objective,'lead-for-major-battle','the rematch flag selects the party');
  const trained=leagueRoom();
  const training={id:'train-battle-member-through-story',trainingMode:'passive',trainingSource:'story',
    trainingMethod:'switch',trainingPartySlot:5,trainingSpecies:3,forObjective:bruno.id,target:bruno.target};
  assert.notEqual(lead(trained,bruno,training)?.objective,'lead-for-major-battle');
  assert.equal(lead(trained,bruno,training)?.objective,'lead-with-training-member');
});

test('VS Seeker cleanup never makes a level-100 member its experience trainee',()=>{
  const f=campaignTaskFixture();
  const teamPlan={permanentFamilies:[[4,5,6],[129,130]]};
  const planner=()=>createCampaignPlanner({world:f.world,story:f.story,mechanics:f.mechanics,
    campaign:structuredClone(f.campaign),teamPlan});
  const capped=f.observation(1,{healed:true,members:f.party.map(p=>({...p,level:100}))});
  const batch=planner().selectTraining(capped,f.objective);
  assert.equal(batch?.id,'finish-vs-seeker-response-batch','the activated responses are still finished');
  assert.equal(batch.trainingPartySlot,undefined,'no member can gain experience');
  assert.equal(batch.responseBatchRemaining,1);
  const fainted=f.observation(1,{members:[{...f.party[0],level:100,hp:87},{...f.party[1],level:60,hp:0}]});
  const next=planner().selectTraining(fainted,f.objective);
  assert.equal(next?.id,'finish-vs-seeker-response-batch');
  assert.equal(next.trainingPartySlot,undefined,'the healthy level-100 member is not the trainee');
  const growing=f.observation(1,{healed:true,members:[{...f.party[0],level:100},{...f.party[1],level:60}]});
  assert.equal(planner().selectTraining(growing,f.objective)?.trainingSpecies,130,'a member below 100 still trains');
});

test('balanced experience never selects a level-100 member as its recipient',()=>{
  const small={species:{1:{id:1,types:['TYPE_NORMAL'],baseAttack:70,baseDefense:70,baseSpAttack:70,baseSpDefense:70}},
    moves:{33:{id:33,power:35,pp:35,accuracy:100,type:'TYPE_NORMAL'}}};
  const one=(slot,level)=>({slot,level,otId:77,species:1,hp:200,maxHp:200,moves:[33],pp:[35]});
  const plan=partyMatchupPlan({mechanics:small,party:[one(0,98),one(1,100)],opponentSpecies:1,
    opponentBattle:{species:1,level:60,hp:60,maxHp:60,moves:[33],pp:[35]},balanceExperience:true,
    observation:{playerMemory:{trainer:{otId:77}}}});
  assert.equal(plan.best.member.slot,0);
});

test('battle participation never targets a level-100 experience trainee',()=>{
  const small={
    moves:{33:{id:33,name:'MOVE_TACKLE',power:35,accuracy:95,type:'TYPE_NORMAL',effect:'EFFECT_HIT'},
      55:{id:55,name:'MOVE_WATER_GUN',power:40,accuracy:100,type:'TYPE_WATER',effect:'EFFECT_HIT'}},
    species:{104:{id:104,types:['TYPE_GROUND']},8:{id:8,types:['TYPE_WATER']},16:{id:16,types:['TYPE_NORMAL','TYPE_FLYING']}},
    typeChart:[]};
  const party=[{slot:0,species:104,level:100,hp:200,maxHp:200,moves:[33],pp:[35],stats:{attack:150,defense:150,spAttack:100,spDefense:100}},
    {slot:1,species:8,level:34,hp:89,maxHp:89,moves:[55],pp:[25],stats:{attack:55,defense:65,spAttack:55,spDefense:65}}];
  const o={captureId:'participation',frame:1,phase:'stable',emulator:{mode:'battle',inputReady:true},
    playerMemory:{map:{id:'MAP_ROUTE6'},battleTypeFlags:12,
      trainer:{party,partyCount:2,usablePartyCount:2,bag:{items:[]}},
      battle:{playerPartySlot:1,player:{...party[1]},sentPartyMasks:[2,0],
        opponent:{species:16,level:18,hp:42,maxHp:42,moves:[33],pp:[35],stats:{attack:30,defense:25,spAttack:25,spDefense:25}}},
      ui:{battle:{stage:'action',cursor:0}}}};
  const story={id:'story',importantBattle:true,target:{kind:'map-arrival',map:'MAP_SILPH_CO_11F'}};
  const training={id:'finish-vs-seeker-response-batch',trainingSource:'vs-seeker',trainingPartySlot:0,trainingSpecies:104,
    forObjective:story.id,target:{kind:'object',map:'MAP_ROUTE6',index:1},trainer:{id:630,maximumLevel:40}};
  const r=createPolicyAdvisors({mechanics:small,campaignPlanner:{select:()=>story,selectTraining:()=>training}})
    .find(a=>a.id==='battle').advise(o)?.recommendation;
  assert.notEqual(r?.objective,'train-team-anchor');
  assert.equal(r?.targetCommand,'fight');
});

test('an unreadable active party entry cannot make every reserve look like an upgrade',()=>{
  // Without enemy moves no race is known, so the established score rule
  // decides; it needs the active member's own score to compare against.
  const small={species:{131:{id:131,types:['TYPE_WATER','TYPE_ICE'],baseAttack:85,baseSpAttack:85},
      1:{id:1,types:['TYPE_GRASS','TYPE_POISON'],baseAttack:49,baseSpAttack:65},
      4:{id:4,types:['TYPE_FIRE'],baseDefense:43,baseSpDefense:50}},
    moves:{57:{id:57,name:'MOVE_SURF',power:95,accuracy:100,pp:15,type:'TYPE_WATER',effect:'EFFECT_HIT'},
      33:{id:33,name:'MOVE_TACKLE',power:35,accuracy:95,pp:35,type:'TYPE_NORMAL',effect:'EFFECT_HIT'}},
    typeChart:[{attackingType:'TYPE_WATER',defendingType:'TYPE_FIRE',multiplier:20}]};
  const lapras={slot:0,species:131,level:50,hp:200,maxHp:200,moves:[57],pp:[15],stats:{attack:85,spAttack:90}};
  const bulbasaur={slot:1,species:1,level:50,hp:140,maxHp:140,moves:[33],pp:[35],stats:{attack:60,spAttack:70}};
  const recommend=party=>createPolicyAdvisors({mechanics:small}).find(a=>a.id==='battle').advise({
    captureId:'unreadable',frame:1,phase:'stable',emulator:{mode:'battle'},
    playerMemory:{battleTypeFlags:12,trainer:{usablePartyCount:2,partyCount:party.length,party},
      battle:{playerPartySlot:0,player:{...lapras},opponent:{species:4,level:48,hp:100,maxHp:100,stats:{defense:43,spDefense:50}}},
      ui:{battle:{stage:'action',cursor:0}}}})?.recommendation;
  assert.equal(recommend([lapras,bulbasaur]).targetCommand,'fight');
  assert.equal(recommend([bulbasaur]).targetCommand,'fight','a missing active entry is not a score of zero');
});
