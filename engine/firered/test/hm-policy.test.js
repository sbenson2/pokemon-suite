import assert from 'node:assert/strict';
import test from 'node:test';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {isHmUtilityCarrier} from '../src/player/campaign.js';
import {isReviveSupportCarrier} from '../src/player/battle-model.js';
import {createFireRedRosterContext} from '../src/player/fire-red-roster.js';
import {rosterContextFixture} from '../test-support/roster-context-fixture.js';
import {createCampaignRun, restoreCampaignRun, createCampaignController} from '../src/suite/campaign-run.js';
import {createMasterCampaign,createCampaignPlanner} from '../src/player/campaign.js';

const moves={15:{id:15,power:50,type:'TYPE_NORMAL',accuracy:95},19:{id:19,power:70,type:'TYPE_FLYING',accuracy:95},
  57:{id:57,power:95,type:'TYPE_WATER',accuracy:100},70:{id:70,power:80,type:'TYPE_NORMAL',accuracy:100},
  148:{id:148,power:0,type:'TYPE_NORMAL',accuracy:70,effect:'EFFECT_ACCURACY_DOWN'},249:{id:249,power:20,type:'TYPE_FIGHTING',accuracy:100},
  33:{id:33,power:35,type:'TYPE_NORMAL',accuracy:95},45:{id:45,power:0,type:'TYPE_NORMAL',accuracy:100,effect:'EFFECT_ATTACK_DOWN'}};
const mechanics={moves,species:{2:{id:2,types:['TYPE_GRASS','TYPE_POISON']},46:{id:46,types:['TYPE_BUG','TYPE_GRASS']}}};
const plan={starterFamily:[1,2,3],permanentFamilies:[[1,2,3]],acquisitions:[],
  utilityAcquisitions:[{family:[46,47],helperRole:'field'}],temporaryAcquisitions:[{family:[56,57],helperRole:'combat'}],
  fieldMoves:{cut:[1,2,3],flash:[1,2,3],rockSmash:[1,2,3]}};
const goal=moveId=>({id:'teach-'+moveId,target:{kind:'teach-move',moveId,itemId:moveId===15?339:340,partySpecies:[1,2,3,46,47],replaceMoveId:33}});
function observe(moveId,{species=2,stage='confirm-replace',picker=false,empty=false}={}) {
  return {captureId:'hm',frame:42,phase:'stable',emulator:{mode:picker?'party-menu':'overworld',inputReady:true},
    playerMemory:{map:{id:'MAP_VERMILION_CITY'},trainer:{partyCount:1,usablePartyCount:1,
      party:[{slot:0,species,level:24,hp:60,maxHp:60,moves:empty?[33,0,0,0]:[33,45,33,45],pp:[35,40,35,40]}]},
      ui:picker?{party:{stage:'choose-pokemon',itemId:goal(moveId).target.itemId,cursor:0}}:
        {moveLearning:{stage,partySlot:0,moveId,cursor:0}}}};
}
const recommend=(moveId,options={})=>createPolicyAdvisors({mechanics,teamPlan:plan,
  campaignPlanner:{select:()=>goal(moveId),selectTraining:()=>null}}).find(a=>a.id==='quest').advise(observe(moveId,options))?.recommendation;

test('combat Pokemon refuse restricted HMs even when the retained task explicitly asks to replace a move',()=>{
  for(const move of [15,148,249]) assert.equal(recommend(move).targetOption,'no',String(move));
});
test('HM recipient selection protects empty combat move slots before the game can learn automatically',()=>{
  for(const move of [15,148,249]) assert.equal(recommend(move,{picker:true,empty:true}).kind,'cancel-conflicting-menu');
});
test('a resumed forbidden HM forget-menu cancels instead of deleting a combat move',()=>{
  assert.equal(recommend(15,{stage:'forget-move'}).kind,'cancel-conflicting-menu');
});
test('missing move scoring data cannot bypass the HM rule in a resumed forget menu',()=>{
  const r=createPolicyAdvisors({mechanics:{},teamPlan:plan,campaignPlanner:{select:()=>goal(15),selectTraining:()=>null}})
    .find(a=>a.id==='quest').advise(observe(15,{stage:'forget-move'}))?.recommendation;
  assert.equal(r.kind,'cancel-conflicting-menu');
});
test('Fly Surf and Strength remain available to combat members',()=>{
  for(const move of [19,57,70]) assert.equal(recommend(move).targetOption,'yes',String(move));
});
test('designated utility Pokemon can learn restricted HMs and finish their picker',()=>{
  for(const move of [15,148,249]) {
    assert.equal(recommend(move,{species:46}).targetOption,'yes',String(move));
    assert.equal(recommend(move,{species:46,picker:true}).targetSpecies,46);
  }
});
test('a combat member never becomes utility or revive support merely because it already has bad HMs',()=>{
  const fighter={species:2,moves:[15,148,249,33]};
  assert.equal(isHmUtilityCarrier(fighter,plan),false);
  assert.equal(isReviveSupportCarrier(fighter,plan),false);
  assert.equal(isHmUtilityCarrier({species:56,moves:[15,148]},plan),false);
  assert.equal(isHmUtilityCarrier({species:46,moves:[33]},plan),true);
});

test('runtime HM planning adds native utility carriers without changing committed teams or seeds, and survives restart',()=>{
  const fixture=rosterContextFixture();
  for(const p of Object.values(fixture.facts.species)) if(p.fieldCapabilities.includes('cut')) p.fieldCapabilities.push('rockSmash','flash');
  const context=createFireRedRosterContext(fixture);
  assert.equal(typeof context.createFieldTeamPlan,'function');
  for(const starter of ['bulbasaur','charmander','squirtle']) {
    const record=createCampaignRun({rosterContext:context,settings:{starter,seedMode:'replay',seed:1,teamSeed:42}});
    const original=structuredClone(record);
    const fieldTeamPlan=context.createFieldTeamPlan(record.teamPlan);
    for(const move of ['cut','flash','rockSmash']) {
      assert.ok(fieldTeamPlan.fieldMoves[move].length, move);
      assert.ok(fieldTeamPlan.fieldMoves[move].every(species=>isHmUtilityCarrier({species},fieldTeamPlan)),move);
    }
    for(const move of ['fly','surf','strength']) assert.deepEqual(fieldTeamPlan.fieldMoves[move],record.teamPlan.fieldMoves[move]);
    assert.deepEqual(fieldTeamPlan.permanentFamilies,record.teamPlan.permanentFamilies);
    assert.deepEqual(fieldTeamPlan.hallOfFameSpecies,record.teamPlan.hallOfFameSpecies);
    const campaign=createMasterCampaign(fieldTeamPlan);
    const prep=campaign.objectives.find(o=>o.id==='prepare-cut-carrier');
    assert.equal(prep.permanentRoster,false);
    assert.ok(fieldTeamPlan.fieldMoves.cut.every(id=>prep.target.requiredFamilies[0].includes(id)));
    assert.ok(prep.target.requiredFamilies[0].every(species=>isHmUtilityCarrier({species},fieldTeamPlan)));
    assert.ok(campaign.objectives.some(o=>o.helperRole==='field'&&o.captureFamily?.some(id=>fieldTeamPlan.fieldMoves.cut.includes(id))));
    const first=createCampaignController({...fixture,record,fieldTeamPlan});
    const saved=JSON.parse(JSON.stringify(first.state()));
    const resumed=createCampaignController({...fixture,record,state:saved});
    assert.deepEqual(resumed.state().fieldTeamPlan,fieldTeamPlan);
    assert.deepEqual(restoreCampaignRun(record,context),original);
  }
});

test('a retained HM objective obtains a missing utility, withdraws it, teaches, and hands back after restart',()=>{
  const helper={id:'hm-utility-46',captureSpecies:46,targetSpecies:46,family:[46,47],afterObjectiveId:'badge-boulder',
    steps:[{kind:'wild-capture',species:46,maps:['MAP_MT_MOON_B1F']}],helperRole:'field'};
  const teamPlan={...plan,fieldPolicy:'utility-hms-v1',utilityAcquisitions:[helper],fieldMoves:{cut:[46,47]},pokedexPolicy:{enabled:false}};
  const prep={id:'prepare-cut-carrier',target:{kind:'party-roster',map:'MAP_VERMILION_CITY_POKEMON_CENTER_1F',requiredFamilies:[[46,47]]},
    completion:{kind:'party-has-families',families:[[46,47]]}};
  const teach={...goal(15),completion:{kind:'party-knows-move',moveId:15}};
  const next={id:'next-road',target:{kind:'warp',map:'MAP_VERMILION_CITY',index:0},completion:{kind:'flag-set',id:1}};
  const campaign={objectives:[prep,teach,next]};
  const open=state=>createCampaignPlanner({campaign,teamPlan,mechanics,initialState:state});
  let planner=open({schema:'master-red/campaign-planner-state/v1',completedThroughObjectiveId:prep.id});
  const o=observe(15);o.playerMemory.ui={};
  o.playerMemory.trainer.pokedex={ownedSpecies:[46]}; // A prior catch could have been traded away.
  o.playerMemory.trainer.storage={pokemon:[]};
  planner.select(o);
  assert.equal(planner.campaignStatus().activeObjective.id,'master-hm-utility-46-capture');
  const state=JSON.parse(JSON.stringify(planner.state()));
  planner=open(state);planner.select(o);
  assert.equal(planner.campaignStatus().activeObjective.id,'master-hm-utility-46-capture');
  assert.equal(planner.campaignStatus().completedThroughObjectiveId,prep.id,'retain the original progress marker');
  o.playerMemory.trainer.storage.pokemon=[{species:46}];planner.select(o);
  assert.equal(planner.campaignStatus().activeObjective.id,prep.id);
  o.playerMemory.trainer.party.push({species:46,slot:1,moves:[33],hp:30,maxHp:30,level:8});
  o.playerMemory.trainer.storage.pokemon=[];planner.select(o);
  assert.equal(planner.campaignStatus().activeObjective.id,teach.id);
  o.playerMemory.trainer.party[1].moves.push(15);planner.select(o);
  assert.equal(planner.campaignStatus().activeObjective.id,next.id);
});

test('an inaccessible preferred HM habitat falls back to a reachable native utility without claiming a combat family',()=>{
  const helper=(id,species,map)=>({id,captureSpecies:species,targetSpecies:species,family:[species],afterObjectiveId:'badge-boulder',
    steps:[{kind:'wild-capture',species,maps:[map]}],helperRole:'field',fieldCapabilities:['cut']});
  const primary=helper('preferred-paras',46,'MAP_MT_MOON_B1F');
  const backup=helper('backup-rattata',19,'MAP_ROUTE1');
  const teamPlan={...plan,fieldPolicy:'utility-hms-v1',utilityAcquisitions:[primary],fieldUtilityAlternatives:[backup],
    fieldMoves:{cut:[46]},pokedexPolicy:{enabled:false}};
  const fixture=rosterContextFixture();
  const prep={id:'prepare-cut-carrier',target:{kind:'party-roster',map:'MAP_VERMILION_CITY_POKEMON_CENTER_1F',requiredFamilies:[[46,19]]},
    completion:{kind:'party-has-families',families:[[46,19]]}};
  const planner=createCampaignPlanner({campaign:{objectives:[prep]},teamPlan,world:fixture.world,mechanics:fixture.mechanics});
  const o=observe(15);o.playerMemory.ui={};o.playerMemory.map={id:'MAP_ROUTE1'};o.playerMemory.position={x:0,y:0};
  o.playerMemory.trainer.storage={pokemon:[]};
  planner.select(o);
  assert.equal(planner.campaignStatus().activeObjective.id,'master-backup-rattata-capture');
  assert.equal(planner.campaignStatus().activeObjective.target.map,'MAP_ROUTE1');
  assert.equal(isHmUtilityCarrier({species:19},teamPlan),true);
  assert.equal(isHmUtilityCarrier({species:2}, {...teamPlan,fieldUtilityAlternatives:[helper('bad',2,'MAP_ROUTE1')]}),false);
  o.playerMemory.trainer.storage.pokemon=[{species:19}];planner.select(o);
  assert.equal(planner.campaignStatus().activeObjective.id,prep.id,'withdraw the captured backup');
});
