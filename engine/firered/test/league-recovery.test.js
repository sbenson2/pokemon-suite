import assert from 'node:assert/strict';
import test from 'node:test';
import {createCampaignPlanner, MAIN_STORY_CAMPAIGN} from '../src/player/campaign.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {createCentralPlayer, mapRecommendation} from '../src/player/delegator.js';
import {nextRecoveryTreatment, recoveryTargetForItem} from '../src/player/recovery.js';
import {createLeagueRecovery} from '../src/player/league-recovery.js';

const mechanics={data:{moves:[{id:57,pp:15,power:95},{id:56,pp:5,power:120},{id:44,pp:25,power:60}]}};
const member={slot:0,species:9,level:65,hp:190,maxHp:190,status1:0,moves:[57,56,44,0],pp:[15,5,25,0]};
function observed({party=[member],items=[],berries=[],ui={},flags={1208:true},counter=0,sha='before',mode='overworld'}={}) {
 return {captureId:'league-frame',frame:100,phase:'stable',phaseReasons:[],emulator:{captureId:'league-frame',frame:100,mode,inputReady:true,inBattle:false},
  sram:{captureId:'league-frame',frame:100,sha256:sha},playerMemory:{captureId:'league-frame',frame:100,sha256:'memory',map:{id:'MAP_POKEMON_LEAGUE_LORELEIS_ROOM'},position:{x:5,y:5},
   trainer:{party,partyCount:party.length,partyValidity:'valid',usablePartyCount:party.filter(p=>p.hp>0).length,bag:{items,berries}},storyState:{flagIds:flags},gameStats:{savedGame:counter},saveAttemptStatus:counter>0?1:0,ui}};
}
function planner(initialState=null) {
 return createCampaignPlanner({mechanics,initialState,campaign:{objectives:MAIN_STORY_CAMPAIGN.objectives.filter(o=>['elite-four-lorelei','restore-after-lorelei','elite-four-bruno'].includes(o.id))}});
}
test('League recovery cannot call an injured or fainted party ready because medicine is absent',()=>{
 for(const hp of [0,80]) {
  const choice=planner().select(observed({party:[{...member,hp}]}));
  assert.equal(choice?.id,'restore-after-lorelei');
  assert.equal(choice?.target.kind,'stop-for-review');
  assert.equal(choice?.target.reason,'league-recovery-supplies-exhausted');
 }
});
test('a restored League party must perform a native save before the next opponent',()=>{
 const p=planner();
 assert.equal(p.select(observed())?.target.kind,'save-game');
 assert.equal(p.select(observed({counter:1}))?.target.kind,'save-game','counter alone is not a save');
 assert.equal(p.select(observed({sha:'after'}))?.target.kind,'save-game','SRAM alone is not a save');
 assert.equal(p.select(observed({counter:1,sha:'after',ui:{saveDialog:{stage:'success'}}}))?.target.kind,'save-game');
 assert.equal(p.select(observed({counter:1,sha:'after'}))?.id,'elite-four-bruno');
});
test('the native-save baseline survives a planner checkpoint and does not request a second save',()=>{
 const p=planner();assert.equal(p.select(observed())?.target.kind,'save-game');
 const resumed=planner(p.state());
 assert.equal(resumed.select(observed({counter:1,sha:'after'}))?.id,'elite-four-bruno');
});
test('a failed or unexpected native save stops instead of repeatedly overwriting it',()=>{
 for(const options of [{ui:{saveDialog:{stage:'error'}}},{counter:2,sha:'unexpected'}]) {
  const p=planner();p.select(observed());
  assert.equal(p.select(observed(options))?.target.kind,'stop-for-review');
 }
});
test('a verified League save stays complete while a later field menu is open',()=>{
 // Native (postgame-league-exp-share): after Lance's intermission save, the
 // Champion lead reorder opened the start menu; the intermission was judged
 // unsaved again, saved a second time and stopped on the changed counter.
 const recovery=createLeagueRecovery({mechanics}),objective={id:'postgame-league-rematch-intermission-3',target:{kind:'heal-with-items'}};
 assert.equal(recovery.inspect(objective,observed()).objective.target.kind,'save-game');
 assert.equal(recovery.inspect(objective,observed({counter:1,sha:'after'})).complete,true);
 for(const ui of [{startMenu:{order:['pokedex','pokemon']}},{party:{stage:'choose-pokemon'}},{party:{stage:'selection-menu'}}])
  assert.equal(recovery.inspect(objective,observed({counter:1,sha:'after',ui})).complete,true,JSON.stringify(ui));
 // Still stops on another save, and an injured party still heals first.
 assert.equal(recovery.inspect(objective,observed({counter:2,sha:'again'})).objective.target.reason,'league-save-counter-changed-unexpectedly');
 const hurt=createLeagueRecovery({mechanics});hurt.inspect(objective,observed());hurt.inspect(objective,observed({counter:1,sha:'after'}));
 assert.equal(hurt.inspect(objective,observed({counter:1,sha:'after',party:[{...member,hp:80}],items:[{itemId:19,quantity:3}]})).objective.target.kind,'heal-with-items');
});
test('a blocked League recovery stops central control instead of walking into the next battle',()=>{
 const p=planner(),player=createCentralPlayer({campaignPlanner:p,mechanics,advisors:createPolicyAdvisors({campaignPlanner:p,mechanics})});
 const d=player.decide(observed({party:[{...member,hp:0}]}));
 assert.equal(d.kind,'blocked');assert.equal(d.reason,'league-recovery-supplies-exhausted');assert.deepEqual(d.action.buttons,[]);
});
test('single-move PP medicine restores the exhausted move on its actual party member',()=>{
 for(const itemId of [34,35]) {
  const m=observed({party:[member,{...member,slot:1,species:117,pp:[15,0,25,0]}],items:[{itemId,quantity:1}]}).playerMemory;
  const treatment=nextRecoveryTreatment(m,mechanics);
  assert.equal(treatment?.itemId,itemId);assert.equal(treatment?.target.slot,1);assert.equal(treatment?.moveSlot,1);
  assert.equal(recoveryTargetForItem(m,itemId,mechanics)?.slot,1);
 }
});
test('PP policy does not enter the unimplemented Berry Pouch workflow',()=>{
 const m=observed({party:[{...member,pp:[0,5,25,0]}],berries:[{itemId:138,quantity:1}]}).playerMemory;
 assert.equal(nextRecoveryTreatment(m,mechanics),null);
});
test('PP restoration preserves scarce items when no move is running low',()=>{
 const m=observed({party:[{...member,pp:[14,5,25,0]}],items:[{itemId:37,quantity:1}]}).playerMemory;
 assert.equal(nextRecoveryTreatment(m,mechanics),null);
});

test('status PP alone cannot qualify a League attacker for the next battle',()=>{
 const recovery=createLeagueRecovery({mechanics:{data:{moves:[...mechanics.data.moves,{id:110,pp:40,power:0}]}}});
 const o=observed({party:[{...member,moves:[57,110,0,0],pp:[0,40,0,0]}]});
 const step=recovery.inspect({id:'intermission',target:{kind:'heal-with-items'}},o);
 assert.equal(step.complete,false);
 assert.equal(step.objective.target.reason,'league-pp-restoration-unavailable');
});

test('fixed damage counts as usable attacking PP in League recovery',()=>{
 const recovery=createLeagueRecovery({mechanics:{data:{moves:[{id:69,pp:20,power:1,effect:'EFFECT_LEVEL_DAMAGE'}]}}});
 const step=recovery.inspect({id:'intermission',target:{kind:'heal-with-items'}},
   observed({party:[{...member,moves:[69,0,0,0],pp:[20,0,0,0]}]}));
 assert.equal(step.objective.target.kind,'save-game');
});

test('a scarce Ether restores attacking PP before a depleted status move',()=>{
 const m={data:{moves:[...mechanics.data.moves,{id:110,pp:40,power:0}]}};
 const memory=observed({party:[{...member,moves:[110,57,0,0],pp:[0,0,0,0]}],items:[{itemId:34,quantity:1}]}).playerMemory;
 assert.equal(nextRecoveryTreatment(memory,m)?.moveSlot,1);
});
test('the PP move picker uses the observed vertical cursor without entering move-forgetting',()=>{
 const o=observed({mode:'party',ui:{party:{stage:'restore-pp-move',cursor:0,selectedPartySlot:0,itemId:34}}});
 assert.deepEqual(mapRecommendation({kind:'choose-pp-move',targetMoveSlot:1},o).buttons,['down']);
});

const leagueItems=[{itemId:24,quantity:24},{itemId:20,quantity:40},{itemId:23,quantity:8},{itemId:19,quantity:20}];
function entryPlanner() {
 return createCampaignPlanner({mechanics,campaign:{objectives:[{...MAIN_STORY_CAMPAIGN.objectives.find(o=>o.id==='elite-four-lorelei'),importantBattle:true,battleCategory:'elite-four',minimumTeamAnchorLevel:65,minimumBattlePartySize:1,minimumReadyBattleMembers:1,minimumBattleMemberLevel:65}]},
  initialState:{schema:'master-red/campaign-planner-state/v1',completedThroughObjectiveId:null,battleMedicineServicedForObjectiveId:'elite-four-lorelei'}});
}
function entrance(options={}) {
 const o=observed({...options,flags:{1208:false}});o.playerMemory.map.id='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';o.playerMemory.trainer.money=230000;return o;
}
test('League entry rechecks expedition supplies even when pre-training medicine was marked serviced',()=>{
 const choice=entryPlanner().select(entrance({items:[{itemId:24,quantity:6}]}));
 assert.equal(choice?.id,'league-entry-supplies');assert.equal(choice?.target.kind,'purchase-items');
 assert.deepEqual(choice.target.items.map(i=>[i.itemId,i.quantity]),[[24,24],[20,40],[23,8],[19,20]]);
});
test('League entry uses the nurse for depleted PP and saves only after stocking and restoring',()=>{
 const p=entryPlanner();
 assert.equal(p.select(entrance({items:leagueItems,party:[{...member,pp:[0,5,25,0]}]}))?.id,'league-entry-heal');
 assert.equal(p.select(entrance({items:leagueItems}))?.target.kind,'save-game');
 assert.equal(p.select(entrance({items:leagueItems,counter:1,sha:'after'}))?.id,'elite-four-lorelei');
});
test('the entry reserve does not interrupt unfinished level training',()=>{
 const choice=entryPlanner().select(entrance({party:[{...member,level:64}]}));
 assert.notEqual(choice?.id,'league-entry-supplies');
});
test('native save prompts are confirmed and a changed save is acknowledged through central control',()=>{
 const p=planner(),player=createCentralPlayer({campaignPlanner:p,mechanics,advisors:createPolicyAdvisors({campaignPlanner:p,mechanics})});
 assert.equal(player.decide(observed()).winner.recommendation.kind,'open-start-menu');
 assert.equal(player.decide(observed({ui:{startMenu:{order:['pokemon','bag','save'],cursor:0}}})).winner.recommendation.targetItem,'save');
 assert.equal(player.decide(observed({ui:{saveDialog:{stage:'confirm-save',cursor:1}}})).winner.recommendation.targetOption,'yes');
 assert.equal(player.decide(observed({counter:1,sha:'after',ui:{saveDialog:{stage:'success'}}})).winner.recommendation.kind,'acknowledge-cartridge-prompt');
});
