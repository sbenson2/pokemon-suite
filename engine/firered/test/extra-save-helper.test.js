import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStoryChoices,validateHelperGoal,inspectHelperGoal,HELPER_CENTERS} from '../src/suite/extra-save-helper.js';
import {MAIN_STORY_CAMPAIGN,createCampaignPlanner} from '../src/player/campaign.js';
import {validateRunSettings,DEFAULT_RUN_SETTINGS} from '../src/suite/campaign-run.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// A helper FireRed save is the ordinary story with one-per-save choices and a
// goal: it stops once the goal individual is saved in a linked Pokémon Center.
test('the default story is unchanged; the Dome Fossil changes only the Mt. Moon choice',()=>{
 assert.equal(applyStoryChoices(MAIN_STORY_CAMPAIGN,{}),MAIN_STORY_CAMPAIGN,'no choice returns the very same campaign');
 assert.equal(applyStoryChoices(MAIN_STORY_CAMPAIGN,{fossil:'helix'}),MAIN_STORY_CAMPAIGN);
 const dome=applyStoryChoices(MAIN_STORY_CAMPAIGN,{fossil:'dome'});
 const pick=c=>c.objectives.find(o=>o.id==='mt-moon-fossil');
 assert.deepEqual(pick(MAIN_STORY_CAMPAIGN).target,{kind:'object',map:'MAP_MT_MOON_B2F',index:1},'the campaign takes the Helix Fossil by default');
 assert.deepEqual(pick(dome).target,{kind:'object',map:'MAP_MT_MOON_B2F',index:0});
 assert.deepEqual(pick(dome).completion,{kind:'flag-set',id:626},'complete only when FLAG_GOT_DOME_FOSSIL is set');
 assert.equal(pick(dome).choice,'yes');
 assert.deepEqual(dome.objectives.map(o=>o.id),MAIN_STORY_CAMPAIGN.objectives.map(o=>o.id));
 assert.equal(dome.mandatoryInterludes,MAIN_STORY_CAMPAIGN.mandatoryInterludes);
 assert.throws(()=>applyStoryChoices(MAIN_STORY_CAMPAIGN,{fossil:'amber'}),/Helix|Dome/);
});

test('a fossil goal revives it at the Cinnabar Lab once Surf reaches Cinnabar, before the next badge',()=>{
 const campaign=applyStoryChoices(MAIN_STORY_CAMPAIGN,{fossil:'dome',helperGoal:{kind:'fossil',fossil:'dome'}});
 const ids=campaign.objectives.map(o=>o.id),at=ids.indexOf('badge-soul');
 assert.deepEqual(ids.slice(at,at+5),['badge-soul','helper-fossil-hand-in','helper-fossil-wait','helper-fossil-receive','badge-marsh']);
 const [handIn,wait,receive]=campaign.objectives.slice(at+1,at+4);
 assert.deepEqual([handIn.target,handIn.completion,handIn.choice],[{kind:'object',map:'MAP_CINNABAR_ISLAND_POKEMON_LAB_EXPERIMENT_ROOM',index:1},{kind:'variable-at-least',id:0x406A,value:1},'yes']);
 assert.deepEqual([wait.target,wait.completion],[{kind:'map-arrival',map:'MAP_CINNABAR_ISLAND_POKEMON_LAB_ENTRANCE'},{kind:'variable-at-least',id:0x406A,value:2}]);
 assert.deepEqual([receive.completion,receive.choice],[{kind:'flag-set',id:748},'no'],'decline the nickname');
 assert.throws(()=>applyStoryChoices(MAIN_STORY_CAMPAIGN,{fossil:'helix',helperGoal:{kind:'fossil',fossil:'dome'}}),/fossil this save takes/);
 assert.throws(()=>validateHelperGoal({kind:'roamer',species:243}),/starter|fossil/);
 const planner=createCampaignPlanner({storyChoices:{fossil:'dome',helperGoal:{kind:'fossil',fossil:'dome'}}});
 assert.ok(planner.storyWatch().flags.includes(748)&&planner.storyWatch().flags.includes(626),'the planner watches the helper objectives');
});

test('run settings accept the helper choices without changing a default record',()=>{
 assert.equal(Object.hasOwn(DEFAULT_RUN_SETTINGS,'fossil'),false,'the reviewed default settings are unchanged');
 const helper=validateRunSettings({label:'Helper save 1',starter:'squirtle',fossil:'dome',helperGoal:{kind:'fossil',fossil:'dome'},afterCampaign:'wait'});
 assert.equal(helper.fossil,'dome');assert.deepEqual(helper.helperGoal,{kind:'fossil',fossil:'dome'});
 const plain=validateRunSettings({label:'Adventure'});
 assert.equal(plain.fossil,undefined);assert.equal(plain.helperGoal,undefined);
 assert.throws(()=>validateRunSettings({label:'x',fossil:'amber'}),/Helix|Dome/);
 assert.throws(()=>validateRunSettings({label:'x',helperGoal:{kind:'starter',starter:'pikachu'}}),/helper/);
 assert.throws(()=>validateRunSettings({label:'x',afterCampaign:'postgame',helperGoal:{kind:'starter',starter:'squirtle'}}),/wait/);
});

const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
const mon=(species,personality,extra={})=>({slot:0,validity:'valid',species,personality,otId:4242,shiny:false,isEgg:false,heldItem:0,level:12,hp:30,maxHp:30,status1:0,moves:[33],pp:[35],ivs,...extra});
const world={data:{maps:[
 {id:HELPER_CENTERS.starter,objectEvents:[{script:'ViridianCity_PokemonCenter_1F_EventScript_Nurse'}]},
 {id:'MAP_VIRIDIAN_CITY_POKEMON_CENTER_2F',objectEvents:[{script:'Common_EventScript_DirectCornerAttendant'}]},
 {id:HELPER_CENTERS.fossil,objectEvents:[{script:'CinnabarIsland_PokemonCenter_1F_EventScript_Nurse'}]},
 {id:'MAP_CINNABAR_ISLAND_POKEMON_CENTER_2F',objectEvents:[{script:'Common_EventScript_DirectCornerAttendant'}]},
]}};
const mechanics={data:{moves:[{id:33,pp:35}]}};
const o=({map='MAP_VIRIDIAN_CITY',party,storage=[],flags={},variables={},saved=5,sha='a'})=>({phase:'stable',frame:10,emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:sha.repeat(64)},
 playerMemory:{map:{id:map},ui:{},saveAttemptStatus:1,gameStats:{savedGame:saved},storyState:{flagIds:flags,variableIds:variables},trainer:{trainerId:4242,otId:4242,partyValidity:'valid',party,storage:{validity:'valid',pokemon:storage}}}});

test('a starter helper plays until its Pokédex, then saves its starter in the Viridian Center and stops',()=>{
 const charmander=mon(4,7),goal={kind:'starter',starter:'charmander'},state={};
 assert.equal(inspectHelperGoal({observation:o({party:[charmander],variables:{0x4031:2}}),goal,state,world,mechanics}).kind,'continue','no Pokédex yet: keep playing');
 const next=inspectHelperGoal({observation:o({party:[charmander],flags:{2089:true},variables:{0x4031:2}}),goal,state,world,mechanics});
 assert.equal(next.kind,'policy');assert.equal(next.objective.target.map,HELPER_CENTERS.starter);
 assert.equal(state.target,encounterFingerprint(charmander));
 const healed={...charmander,hp:30},atCenter=o({map:HELPER_CENTERS.starter,party:[healed],flags:{2089:true},variables:{0x4031:2}});
 assert.equal(inspectHelperGoal({observation:atCenter,goal,state,world,mechanics}).objective.target.kind,'save-game');
 const done=inspectHelperGoal({observation:o({map:HELPER_CENTERS.starter,party:[healed],flags:{2089:true},variables:{0x4031:2},saved:6,sha:'b'}),goal,state,world,mechanics});
 assert.equal(done.kind,'reached');assert.deepEqual(done.receipt.grants,[encounterFingerprint(charmander)]);
 assert.equal(done.receipt.species,4);assert.equal(done.receipt.center,HELPER_CENTERS.starter);assert.equal(done.receipt.lineage,'4242');
 assert.equal(inspectHelperGoal({observation:o({party:[mon(1,8)],flags:{2089:true},variables:{0x4031:0}}),goal,state:{},world,mechanics}).kind,'stop','another starter was chosen');
 assert.equal(inspectHelperGoal({observation:o({party:[mon(4,9,{shiny:true})],flags:{2089:true},variables:{0x4031:2}}),goal,state:{},world,mechanics}).kind,'stop','a shiny is never offered');
});

test('a fossil helper stops for the other fossil and parks its revived Pokémon at the Cinnabar Center',()=>{
 const goal={kind:'fossil',fossil:'dome'};
 assert.match(inspectHelperGoal({observation:o({party:[mon(7,1)],flags:{627:true,562:true}}),goal,state:{},world,mechanics}).reason,/Helix Fossil/);
 assert.equal(inspectHelperGoal({observation:o({party:[mon(7,1)],flags:{626:true,562:true}}),goal,state:{},world,mechanics}).kind,'continue','the fossil is not revived yet');
 const kabuto=mon(140,2,{level:5}),state={};
 const next=inspectHelperGoal({observation:o({map:'MAP_CINNABAR_ISLAND_POKEMON_LAB_EXPERIMENT_ROOM',party:[mon(7,1),mon(16,3),mon(19,4),mon(21,5),mon(23,6),mon(25,7)],storage:[kabuto],flags:{626:true,562:true,748:true}}),goal,state,world,mechanics});
 assert.equal(next.kind,'policy');assert.equal(next.objective.target.kind,'party-roster','withdraw the revived Kabuto from the PC');
 assert.deepEqual(next.objective.target.requiredFingerprints,[encounterFingerprint(kabuto)]);
 assert.equal(next.objective.target.map,HELPER_CENTERS.fossil);
});
