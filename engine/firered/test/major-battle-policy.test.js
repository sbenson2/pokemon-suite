import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {selectTrainingObjective} from '../src/player/campaign.js';

const fixture=JSON.parse(readFileSync(new URL('../test-support/misty-battle.json',import.meta.url)));
const {mechanics}=fixture;
const goal={id:'badge-cascade',importantBattle:true,battleCategory:'gym-leader',
  target:{kind:'object',map:'MAP_CERULEAN_CITY_GYM',index:2},
  starterBattleFamily:[1,2,3],starterBattleTargetLevel:23,supportBattleTargetLevel:23,
  minimumBattlePartySize:3,minimumReadyBattleMembers:2,enemyAceLevel:21};
const training={id:'train-battle-member-through-story',trainingMode:'passive',trainingSource:'story',
  trainingMethod:'switch',trainingPartySlot:0,trainingSpecies:2,forObjective:'badge-cascade',target:goal.target};
function observed({trainerId=415,flags=12,slot=0,hp,ui={battle:{stage:'action',cursor:0}},announcedOpponentName=null}={}) {
  const party=structuredClone(fixture.party);
  if(hp!==undefined)party[slot].hp=hp;
  return {captureId:'misty',frame:1587410,phase:'stable',phaseReasons:[],
    emulator:{mode:'battle',inputReady:true,inBattle:true},
    playerMemory:{map:{id:'MAP_CERULEAN_CITY_GYM'},position:{x:4,y:3},battleTypeFlags:flags,
      trainer:{partyCount:4,usablePartyCount:party.filter(p=>p.hp>0).length,party,bag:{items:[{itemId:22,quantity:4}]}},
      battle:{trainerId,playerPartySlot:slot,sentPartyMasks:[9,0],player:party[slot],
        opponent:structuredClone(fixture.opponent),enemyParty:structuredClone(fixture.enemyParty),announcedOpponentName},ui}};
}
// A retained planning result deliberately reproduces the policy conflict:
// actual opponent recognition must win even if training is stale on restart.
function recommend(o,{objective=goal,retainedTraining=training}={}) {
  const campaignPlanner={select:()=>objective,selectTraining:()=>retainedTraining};
  return createPolicyAdvisors({mechanics,world:{maps:[]},campaignPlanner})
    .find(a=>a.id==='battle').advise(o)?.recommendation;
}

test('Misty keeps her healthy Grass counter in battle despite its switch-training assignment',()=>{
  assert.equal(recommend(observed()).targetCommand,'fight');
});

test('Trainer Tower battles reject retained campaign switch-training assignments',()=>{
  const o=observed({flags:(1<<19)|8,trainerId:65535});
  o.playerMemory.map.id='MAP_TRAINER_TOWER_1F';
  assert.equal(recommend(o,{objective:{id:'postgame-trainer-tower'}}).targetCommand,'fight');
  assert.equal(selectTrainingObjective({mechanics,world:{maps:[]},observation:o,objective:goal}),null);
});

test('all major opponents override a stale unrelated training task',()=>{
  for(const trainer of Object.values(mechanics.trainers).filter(t=>t.name!=='TRAINER_SWIMMER_MALE_LUIS')) {
    assert.equal(recommend(observed({trainerId:trainer.id}),{objective:{id:'old-training-task'}}).targetCommand,
      'fight',trainer.name);
  }
});

// Mankey knocks the level-18 Staryu out with Low Kick before it can act, so it
// keeps attacking. The participation mask 0b1001 also records that the Grass
// counter was already withdrawn against this Staryu (a switch back would
// bounce). The counter stays available once Mankey is genuinely outmatched.
const outmatched=(o,patch)=>{o.playerMemory.battle.sentPartyMasks=[8,0];Object.assign(o.playerMemory.battle.player,patch);return o;};
test('a participating Grass counter remains available when a major-battle finisher is outmatched',()=>{
  assert.equal(recommend(observed({slot:3})).targetCommand,'fight','a winning finisher keeps attacking');
  const r=recommend(outmatched(observed({slot:3}),{pp:[0,0,0,0]}));
  assert.equal(r.targetCommand,'pokemon');assert.equal(r.targetPartySlot,0);
  const party=recommend(outmatched(observed({slot:3,ui:{party:{stage:'choose-pokemon',cursor:3}}}),{pp:[0,0,0,0]}));
  assert.equal(party.kind,'choose-party-member');assert.equal(party.targetSpecies,2);
});

test('major battles choose a healthy counter before healing an inferior active matchup',()=>{
  const first=recommend(observed({slot:3,hp:1}));
  assert.equal(first.targetCommand,'fight');assert.equal(first.objective,'finish-current-opponent',
    'at 1 HP Mankey still knocks Staryu out first');
  const r=recommend(outmatched(observed({slot:3,hp:1}),{stats:{...fixture.party[3].stats,speed:1}}));
  assert.equal(r.targetCommand,'pokemon');assert.equal(r.targetPartySlot,0);
  const committed=recommend(observed({slot:3,hp:1,ui:{party:{stage:'choose-pokemon',itemId:22,cursor:3}}}));
  assert.equal(committed.kind,'choose-party-member');assert.equal(committed.targetPartySlot,3,
    'an item already committed in the cartridge must finish before reconsidering the matchup');
});

test('a major-battle forced replacement can select the previously protected trainee',()=>{
  const r=recommend(observed({slot:3,hp:0,ui:{party:{stage:'choose-pokemon',cursor:3}}}));
  assert.equal(r.kind,'choose-party-member');assert.equal(r.targetPartySlot,0);
  assert.equal(r.objective,'replace-fainted-pokemon');
});

test('major-battle free shifts use matchup instead of giving an exposed trainee more XP',()=>{
  const o=observed({slot:3,ui:{choiceMenu:{cursor:0}},announcedOpponentName:'STARMIE'});
  const r=recommend(o);
  assert.equal(r.targetOption,'yes');assert.equal(r.targetPartySlot,0);
  assert.equal(r.objective,'counter-announced-opponent');
});

test('wild and regular Gym trainers protect a weak trainee but keep a capable trainee after a boss',()=>{
  const regular=Object.values(mechanics.trainers).find(t=>t.name==='TRAINER_SWIMMER_MALE_LUIS').id;
  for(const params of [{flags:4},{trainerId:regular}]) {
    const weak=observed(params);weak.playerMemory.trainer.party[0].level=12;
    assert.equal(recommend(weak).objective,'protect-training-member');
    assert.equal(recommend(observed(params)).targetCommand,'fight');
    assert.equal(recommend(observed({...params,slot:3})).targetCommand,'fight');
  }
  assert.equal(recommend(observed()).targetCommand,'fight');
  assert.equal(recommend(observed({trainerId:regular})).targetCommand,'fight');
});

test('the campaign planner cannot reissue active training during an observed major battle',()=>{
  assert.equal(selectTrainingObjective({mechanics,world:{maps:[]},observation:observed(),objective:goal}),null);
  const field=observed();field.emulator={mode:'overworld',inBattle:false};
  assert.equal(selectTrainingObjective({mechanics,world:{maps:[]},observation:field,objective:goal})?.trainingMode,'passive');
});

test('ghost Marowak is a story battle while ordinary wild capture stays a capture',()=>{
  const o=observed({flags:4|(1<<15)|(1<<13)});o.playerMemory.battle.opponent.species=105;
  o.playerMemory.map.id='MAP_POKEMON_TOWER_6F';
  assert.equal(recommend(o).targetCommand,'fight');
  const wild=observed({flags:4});wild.playerMemory.trainer.bag.pokeBalls=[{itemId:2,quantity:30}];
  wild.playerMemory.battle.opponent.status1=0;
  const r=recommend(wild,{objective:{id:'catch-staryu',captureSpecies:[120]},retainedTraining:null});
  assert.equal(r.objective,'prepare-capture-catch-staryu');
});
