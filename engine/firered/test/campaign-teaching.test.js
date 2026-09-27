import assert from 'node:assert/strict';
import test from 'node:test';
import {campaignTaskFixture} from '../test-support/campaign-task-fixture.js';

function fixture(moveId=19) {
  const f=campaignTaskFixture();
  f.objective.id='teach-move';
  f.objective.target={kind:'teach-move',moveId,itemId:340,partySpecies:[6]};
  Object.assign(f.mechanics,{moves:{
    33:{id:33,power:35,pp:35,type:'TYPE_NORMAL',accuracy:95},
    45:{id:45,power:0,pp:40,type:'TYPE_NORMAL',accuracy:100,effect:'EFFECT_ATTACK_DOWN'},
    19:{id:19,power:70,pp:15,type:'TYPE_FLYING',accuracy:95,effect:'EFFECT_SEMI_INVULNERABLE'}},
    items:{18:{id:18,healAmount:20}}});
  const diglett=f.mechanics.species[0];
  f.mechanics.species=Array.from({length:51},(_,id)=>({id,name:`SPECIES_TEST_${id}`,types:[]}));
  f.mechanics.species[50]=diglett;
  f.mechanics.species[6]={id:6,name:'SPECIES_CHARIZARD',types:['TYPE_FIRE','TYPE_FLYING']};
  const o=f.observation(1,{healed:true,mode:'start-menu'});
  o.playerMemory.trainer.party[0].species=6;
  o.playerMemory.trainer.party[0].moves=[33,45,33,45];
  o.playerMemory.trainer.party[0].pp=[35,40,35,40];
  o.playerMemory.ui={startMenu:{order:['pokedex','pokemon','bag','save'],cursor:1}};
  return {...f,o};
}

test('pending rematches wait for teaching, then remain available after planner restart',()=>{
  for(const moveId of [19,57,70,15,148,249,85]) {
    const f=fixture(moveId);let {planner,player}=f.open();
    assert.equal(planner.selectTraining(f.o,f.objective),null,String(moveId));
    ({planner}=f.open(JSON.parse(JSON.stringify(player.state()))));
    assert.equal(planner.selectTraining(f.o,f.objective),null);
    const batch=planner.selectTraining(f.o,{id:'continue-story',target:{kind:'object',map:f.route.id,index:0}});
    assert.equal(batch?.id,'finish-vs-seeker-response-batch','teaching defers rather than erases pending responses');
  }
});

test('Charizard teaching owns Start, recipient and move replacement despite a low teammate',()=>{
  const f=fixture();
  const teammate=f.o.playerMemory.trainer.party[1];teammate.hp=0;
  f.o.playerMemory.trainer.usablePartyCount=1;
  f.o.playerMemory.trainer.bag.items=[{itemId:18,quantity:5}];
  let {player}=f.open();
  let decision=player.decide(f.o);
  assert.equal(decision.winner?.recommendation?.targetItem,'bag');
  assert.equal(decision.winner?.recommendation?.objective,'teach-move','field recovery must not steal a teaching menu');
  const picker=structuredClone(f.o);picker.captureId='picker';picker.frame++;
  for(const key of ['emulator','sram','playerMemory'])Object.assign(picker[key],{captureId:picker.captureId,frame:picker.frame});
  picker.emulator.mode='party';picker.playerMemory.ui={party:{stage:'choose-pokemon',menuType:4,itemId:340,cursor:1}};
  ({player}=f.open(JSON.parse(JSON.stringify(player.state()))));
  decision=player.decide(picker);
  assert.equal(decision.winner?.recommendation?.targetSpecies,6);
  assert.equal(decision.winner?.recommendation?.targetPartySlot,0);
  const confirm=structuredClone(picker);confirm.captureId='confirm';confirm.frame++;
  for(const key of ['emulator','sram','playerMemory'])Object.assign(confirm[key],{captureId:confirm.captureId,frame:confirm.frame});
  confirm.playerMemory.ui={moveLearning:{stage:'confirm-replace',partySlot:0,moveId:19,itemId:340,cursor:0}};
  decision=player.decide(confirm);
  assert.equal(decision.winner?.recommendation?.targetOption,'yes',JSON.stringify(decision.winner));
  assert.equal(decision.winner?.recommendation?.objective,'learn-move-19');
});
