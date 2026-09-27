import assert from 'node:assert/strict';
import test from 'node:test';
import {createMasterCampaign,createCampaignPlanner} from '../src/player/campaign.js';
import {createMasterTeamPlan} from '../src/player/origins-team.js';

function safariTeam(species) {
  const plan=structuredClone(createMasterTeamPlan(1,0));
  const family=species===111?[111,112]:[species];
  const acquisition={id:`safari-${species}`,family,captureSpecies:species,targetSpecies:family.at(-1),
    afterObjectiveId:'hm-surf',steps:[{kind:'wild-capture',species,maps:['MAP_SAFARI_ZONE_CENTER'],safari:true}]};
  plan.acquisitions[4]=acquisition;
  plan.permanentFamilies=[plan.starterFamily,...plan.acquisitions.map(a=>a.family)];
  plan.surfAssemblyFamilies=[plan.starterFamily,family];
  plan.fieldMoves.surf=family;
  return plan;
}

test('Safari acquisitions happen before a same-milestone PC roster asks for them',()=>{
  for(const species of [111,128,115]) {
    const teamPlan=safariTeam(species),campaign=createMasterCampaign(teamPlan);
    const ids=campaign.objectives.map(o=>o.id);
    assert.ok(ids.indexOf(`master-safari-${species}-capture`)<ids.indexOf('assemble-permanent-roster'),
      `catch ${species} before trying to withdraw it`);
    assert.ok(ids.indexOf(`master-safari-${species}-capture`)>ids.indexOf('hm-surf'),
      'retain the acquisition’s story prerequisite');
    assert.deepEqual(teamPlan,safariTeam(species),'scheduling does not rewrite the chosen team');
  }
});

test('a resumed Surf milestone selects its missing capture before opening the PC',()=>{
  const teamPlan=safariTeam(111),campaign=createMasterCampaign(teamPlan);
  const open=state=>createCampaignPlanner({teamPlan,campaign,initialState:state});
  let planner=open({schema:'master-red/campaign-planner-state/v1',completedThroughObjectiveId:'hm-surf'});
  const o={frame:5,phase:'stable',emulator:{mode:'overworld',inputReady:true},playerMemory:{
    map:{id:'MAP_FUCHSIA_CITY_POKEMON_CENTER_1F'},position:{x:11,y:2},ui:{},
    storyState:{flagIds:{},variableIds:{}},trainer:{partyValidity:'valid',
      party:[{slot:0,species:3,level:45,hp:130,maxHp:130,moves:[22],pp:[25]}],
      pokedex:{ownedSpecies:[1,2,3]},bag:{keyItems:[{itemId:340,quantity:1}]},
      storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)}}}};
  assert.equal(planner.select(o).id,'master-safari-111-capture');
  planner=open(JSON.parse(JSON.stringify(planner.state())));
  assert.equal(planner.select(o).id,'master-safari-111-capture','restart retains the unfinished acquisition');
  o.playerMemory.trainer.storage.pokemon=[{box:0,slot:0,species:111,level:25}];
  o.playerMemory.trainer.pokedex.ownedSpecies.push(111);
  assert.equal(planner.select(o).id,'assemble-permanent-roster','only an owned capture permits assembly');
});

test('a field carrier level gate gives its missing access badge priority, then resumes the carrier',()=>{
  const teamPlan=safariTeam(111);teamPlan.fieldMoveMinimumLevels={surf:42};
  const campaign=createMasterCampaign(teamPlan);
  const open=state=>createCampaignPlanner({teamPlan,campaign,initialState:state});
  let planner=open({schema:'master-red/campaign-planner-state/v1',completedThroughObjectiveId:'prepare-surf-carrier'});
  const o={frame:10,phase:'stable',emulator:{mode:'overworld',inputReady:true},playerMemory:{
    map:{id:'MAP_ROUTE24'},position:{x:5,y:25},ui:{},storyState:{flagIds:{2084:false},variableIds:{}},
    trainer:{partyValidity:'valid',party:[{slot:0,species:111,level:32,hp:90,maxHp:90,moves:[33],pp:[35]}],
      bag:{items:[],keyItems:[]},storage:{validity:'valid',pokemon:[]}}}};
  assert.equal(planner.select(o).id,'badge-soul');
  assert.equal(planner.state().completedThroughObjectiveId,'prepare-surf-carrier','do not skip the unfinished carrier');
  planner=open(JSON.parse(JSON.stringify(planner.state())));
  assert.equal(planner.select(o).id,'badge-soul');
  o.playerMemory.storyState.flagIds[2084]=true;
  assert.equal(planner.select(o).id,'train-surf-carrier');
  o.playerMemory.trainer.party[0].level=42;o.playerMemory.trainer.party[0].species=112;
  assert.equal(planner.select(o).id,'teach-surf');
});
