import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePostgameObjective,PostgameAgenda} from '../src/suite/postgame-agenda.js';
import {selectBattleRosterObjective,selectTrainingObjective} from '../src/player/campaign.js';
import {createPostgameController} from '../src/suite/postgame.js';
import {FireRedEvolutionTask} from '../src/suite/fire-red-evolution.js';

const families=[[1,2,3],[21,22],[52,53],[66,67,68],[54,55],[147,148,149]];
const teamPlan={schema:'master-red/permanent-team-plan/v1',starterFamily:families[0],permanentFamilies:families,
 acquisitions:families.slice(1).map(family=>({family})),utilityAcquisitions:[]};
const mon=(species,slot)=>({species,slot,personality:100+species,otId:10,validity:'valid',isEgg:false,
 level:species===22?93:70,hp:100,maxHp:100,status1:0,moves:[33],pp:[35]});
function scene(id){
 const map=id==='trainer-tower'?'MAP_SEVEN_ISLAND_POKEMON_CENTER_1F':'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
 const center={id:map,objectEvents:[],coordEvents:[],backgroundEvents:[],warpEvents:[],connections:[],
  layout:{id:'LAYOUT_TEST_CENTER',width:5,height:5,blockDataSha256:'fixture',cells:Array.from({length:25},(_,i)=>({
   x:i%5,y:Math.floor(i/5),collision:0,elevation:3,behaviorName:i===8?'MB_PC':'MB_NORMAL',encounterType:0}))}};
 const world={maps:[center]},mechanics={data:{moves:[{id:33,pp:35}]}};
 const o={phase:'stable',frame:100,emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'before'},playerMemory:{
  map:{id:map},position:{x:3,y:2},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{0x4082:0}},gameStats:{savedGame:10,leagueEntries:1},
  trainer:{partyValidity:'valid',party:[49,149,55,46,116,22].map(mon),storage:{validity:'valid',pokemon:[3,53,67].map(mon)},
   money:999999,bag:{items:[{itemId:24,quantity:24},{itemId:20,quantity:20},{itemId:23,quantity:8},{itemId:19,quantity:20}]}},
  postgameEvidence:{trainerTower:Array.from({length:4},(_,challenge)=>({challenge,receivedPrize:false,floorsCleared:0,hasLost:false}))}}};
 return {o,world,mechanics};
}

for(const id of ['trainer-tower','league-rematch'])test(`${id} restores the established six after an evolution or collection task`,()=>{
 const {o,world,mechanics}=scene(id),state={};
 const objective=resolvePostgameObjective(id,o,world,state,{mechanics});
 // This is the same objective-to-roster boundary used by the production quest,
 // navigation and battle advisors. HP alone must not admit a utility party.
 const preparation=selectBattleRosterObjective({world,observation:o,objective,teamPlan});
 assert.equal(preparation?.target.kind,'party-roster');
 assert.equal(preparation.target.map,o.playerMemory.map.id);
 assert.equal(preparation.target.minimumPartySize,6);
 assert.deepEqual(preparation.target.requiredFamilies,families);
 const restarted=JSON.parse(JSON.stringify(state));
 const next=resolvePostgameObjective(id,o,world,restarted,{mechanics});
 assert.deepEqual(selectBattleRosterObjective({world,observation:o,objective:next,teamPlan}).target,preparation.target);
 o.playerMemory.trainer.party=[3,22,53,67,55,149].map(mon);
 assert.equal(selectBattleRosterObjective({world,observation:o,objective:next,teamPlan}),null,'a ready roster proceeds without another PC detour');
});

test('Tower preparation restores the permanent team before considering a boxed reserve from a collection party',()=>{
 const {o,world,mechanics}=scene('trainer-tower'),state={};
 o.playerMemory.trainer.party=[
  [49,31,30234],[149,72,481065],[55,70,354271],[46,22,11080],[116,23,13328],[22,93,814254],
 ].map(([species,level,experience],slot)=>({...mon(species,slot),level,experience}));
 o.playerMemory.trainer.storage.pokemon=[
  [3,67,306249],[53,68,314432],[67,67,306249],[150,70,428750],
 ].map(([species,level,experience],slot)=>({...mon(species,slot),level,experience}));
 const objective=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics,teamPlan});
 assert.equal(objective.preferredFamilies,undefined,'utility members cannot become the balanced Tower core');
 assert.equal(objective.battleTeamTargetLevel,93);
 const preparation=selectBattleRosterObjective({world,observation:o,objective,teamPlan});
 assert.deepEqual(preparation.target.requiredFamilies,families);
 const restored=JSON.parse(JSON.stringify(state));
 const afterRestart=resolvePostgameObjective('trainer-tower',o,world,restored,{mechanics,teamPlan});
 assert.deepEqual(selectBattleRosterObjective({world,observation:o,objective:afterRestart,teamPlan}).target,preparation.target);
 assert.equal(restored.tower?.balancedRoster??null,null);
 o.playerMemory.trainer.party=[
  [3,67,306249],[22,93,814254],[53,66,287589],[67,64,264889],[55,70,354271],[149,72,481065],
 ].map(([species,level,experience],slot)=>({...mon(species,slot),level,experience}));
 const assembledState=JSON.parse(JSON.stringify(restored));
 const assembled=resolvePostgameObjective('trainer-tower',o,world,assembledState,{mechanics,teamPlan});
 assert.equal(assembled.preferredFamilies,undefined,'restoration must remain the chosen roster policy after the PC closes');
 assert.equal(selectBattleRosterObjective({world,observation:o,objective:assembled,teamPlan}),null);
 const again=resolvePostgameObjective('trainer-tower',o,world,JSON.parse(JSON.stringify(assembledState)),{mechanics,teamPlan});
 assert.equal(again.preferredFamilies,undefined,'a restart must retain the permanent roster choice');
});

test('an admitted balanced Tower party keeps its six through the lobby, first floor, and restart',()=>{
 const {o,world,mechanics}=scene('trainer-tower');
 world.maps.push({id:'MAP_TRAINER_TOWER_LOBBY',coordEvents:[{script:'TrainerTower_Lobby_EventScript_EntryTrigger',x:9,y:7}]});
 world.maps.push({id:'MAP_TRAINER_TOWER_1F',coordEvents:[{script:'TrainerTower_EventScript_SingleBattleTrigger',x:10,y:13}]});
 o.playerMemory.trainer.party=[67,149,53,3,55,150].map((species,slot)=>({...mon(species,slot),level:86}));
 o.playerMemory.trainer.storage.pokemon=[mon(22,0)];
 o.playerMemory.postgameEvidence.trainerTowerChallenge=0;
 const state={tower:{mode:0,balancedRoster:{preferredFamilies:[[67],[149],[53],[3],[55],[150]],targetLevel:86}}};
 o.playerMemory.map.id='MAP_TRAINER_TOWER_LOBBY';
 let objective=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics,teamPlan});
 assert.equal(objective.id,'postgame-trainer-tower-choose-mode');
 assert.equal(selectBattleRosterObjective({world,observation:o,objective,teamPlan}),null);
 o.playerMemory.storyState.variableIds[0x4082]=1;
 objective=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics,teamPlan});
 assert.equal(objective.target.map,'MAP_TRAINER_TOWER_1F');
 assert.equal(selectBattleRosterObjective({world,observation:o,objective,teamPlan}),null,'admission must not send the accepted party back to the PC');
 const restarted=JSON.parse(JSON.stringify(state));
 o.playerMemory.map.id='MAP_TRAINER_TOWER_1F';
 o.playerMemory.storyState.variableIds[0x400e]=0;
 o.playerMemory.storyState.variableIds[0x400f]=1;
 objective=resolvePostgameObjective('trainer-tower',o,world,restarted,{mechanics,teamPlan});
 assert.equal(objective.target.kind,'walk-to');
 assert.equal(selectBattleRosterObjective({world,observation:o,objective,teamPlan}),null,'first-floor battle must retain the admitted roster after restart');
});

test('an in-progress League room keeps its owned battle instead of scheduling an unreachable PC',()=>{
 const {o,world,mechanics}=scene('league-rematch');o.playerMemory.map.id='MAP_POKEMON_LEAGUE_BRUNOS_ROOM';
 const objective=resolvePostgameObjective('league-rematch',o,world,{}, {mechanics});
 assert.equal(objective.target.map,o.playerMemory.map.id);
 assert.equal(selectBattleRosterObjective({world,observation:o,objective,teamPlan}),null);
});

function leagueControllerScene(){
 const args=scene('league-rematch'),{o,world,mechanics}=args;
 mechanics.data.species=[];world.wildEncounters=[];
 Object.assign(mechanics.data.moves[0],{power:40,type:'TYPE_NORMAL',effect:'EFFECT_HIT'});
 const room=structuredClone(world.maps[0]);room.id='MAP_POKEMON_LEAGUE_LORELEIS_ROOM';
 room.objectEvents=[{x:2,y:2,script:'Lorelei'}];world.maps.push(room);
 world.maps[0].objectEvents=[{x:2,y:2,script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}];
 Object.assign(o.playerMemory,{map:{id:room.id},position:{x:2,y:3}});
 o.playerMemory.trainer.party=[3,22,53,67,55,149].map(mon);
 o.captureId='league-controller';o.phaseReasons=[];
 for(const evidence of [o.emulator,o.sram,o.playerMemory])Object.assign(evidence,{frame:o.frame,captureId:o.captureId});
 return {...args,story:{scripts:[]},state:{schema:'pokemon-suite/postgame/v1',
  preparation:{phase:'complete'},fieldTeamPlan:teamPlan,
  agenda:{schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:'league-rematch',entries:[],failures:{},workflows:{}}}};
}

test('a retained Tower save finishes before refreshing its legacy pending roster objective',()=>{
 const args=leagueControllerScene(),{o,world,state}=args;
 const lobby=structuredClone(world.maps[0]);lobby.id='MAP_TRAINER_TOWER_LOBBY';
 const floor=structuredClone(lobby);floor.id='MAP_TRAINER_TOWER_1F';
 world.maps.push(lobby,floor);
 o.playerMemory.map.id=lobby.id;o.playerMemory.storyState.variableIds[0x4082]=1;
 o.playerMemory.postgameEvidence.trainerTowerChallenge=0;
 o.playerMemory.trainer.party=[67,149,53,3,55,150].map((species,slot)=>({...mon(species,slot),level:86}));
 o.playerMemory.trainer.storage.pokemon=[mon(22,0)];
 const preferredFamilies=[[67],[149],[53],[3],[55],[150]];
 state.agenda.active='trainer-tower';
 state.agenda.workflows.league={receipt:{nativeSaveVerified:true,leagueEntries:1,savedGame:10}};
 state.agenda.workflows.tower={mode:0,balancedRoster:{preferredFamilies,targetLevel:86}};
 state.pendingObjective={id:'postgame-trainer-tower-travel',target:{kind:'map-arrival',map:floor.id},
  importantBattle:true,minimumBattlePartySize:6,minimumReadyBattleMembers:6,
  battleCategory:'trainer-tower',rosterPreparationFor:'postgame-trainer-tower'};
 state.save={count:10,sha256:'before',map:lobby.id};
 state.objective={id:'postgame-save',target:{kind:'save-game',map:lobby.id,saveVerified:true},dialogue:'advance'};
 o.playerMemory.gameStats.savedGame=11;o.playerMemory.saveAttemptStatus=1;o.sram.sha256='tower-saved';
 o.playerMemory.ui.saveDialog={stage:'success'};
 let controller=createPostgameController(args);
 const owned=controller.decide(o);
 assert.equal(owned.winner?.recommendation?.kind,'acknowledge-cartridge-prompt');
 assert.ok(controller.state().save,'the native success dialog must remain owned');
 controller=createPostgameController({...args,state:JSON.parse(JSON.stringify(controller.state()))});
 o.playerMemory.ui={};
 const handoff=controller.decide(o);
 assert.equal(handoff.kind,'resample','a pre-update pending objective cannot send the admitted team toward an outside PC');
 assert.equal(controller.state().save,null);
 controller=createPostgameController({...args,state:JSON.parse(JSON.stringify(controller.state()))});
 controller.decide(o);
 const objective=controller.state().pendingObjective??controller.state().objective;
 assert.deepEqual(objective.preferredFamilies,preferredFamilies,JSON.stringify({objective,active:controller.state().agenda.active}));
 assert.equal(selectBattleRosterObjective({world,observation:o,objective,teamPlan}),null);
 assert.equal(controller.state().agenda.active,'trainer-tower');
});

test('the League controller owns its room even with a retained outside care task',()=>{
 const args=leagueControllerScene(),{o,state}=args;
 state.fieldCare={active:{kind:'center',objective:{id:'restore-postgame-party',taskKind:'recovery',
  target:{kind:'object',map:'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F',index:0}}}};
 o.playerMemory.trainer.party[0].pp=[0];
 for(let restart=0;restart<2;restart++){
  const controller=createPostgameController({...args,state:restart?args.state:state});
  controller.decide(o);
  const retained=controller.state();
  assert.equal((retained.pendingObjective??retained.objective)?.target.map,o.playerMemory.map.id,
   'a one-way League room cannot yield to a center outside the challenge');
  assert.equal(retained.agenda.active,'league-rematch');
  args.state=JSON.parse(JSON.stringify(retained));
 }
});

test('exhausted League intermission supplies stop within the owned challenge after restart',()=>{
 const args=leagueControllerScene(),{o}=args;
 o.playerMemory.storyState.flagIds[1208]=true;
 o.playerMemory.trainer.party[0].hp=20;o.playerMemory.trainer.bag={items:[],pokeBalls:[]};
 for(let restart=0;restart<2;restart++){
  const controller=createPostgameController(args),decision=controller.decide(o);
  assert.equal(decision.kind,'blocked','unavailable recovery must not schedule unreachable outside work');
  assert.equal(decision.reason,'league-recovery-supplies-exhausted');
  assert.equal(controller.state().agenda.active,'league-rematch');
  assert.equal(controller.state().agenda.failures['league-rematch'],undefined,'a one-way challenge cannot be deferred to another route');
  args.state=JSON.parse(JSON.stringify(controller.state()));
 }
});

test('League item recovery retains its verified save dialog and hands off to the next room',()=>{
 const args=leagueControllerScene(),{o}=args;
 o.playerMemory.storyState.flagIds[1208]=true;
 o.playerMemory.trainer.party[0].hp=20;
 let controller=createPostgameController(args);controller.decide(o);
 assert.equal(controller.state().objective.target.kind,'heal-with-items');
 o.playerMemory.trainer.party[0].hp=o.playerMemory.trainer.party[0].maxHp;
 controller.decide(o);
 assert.equal(controller.state().objective.target.kind,'save-game');
 controller=createPostgameController({...args,state:JSON.parse(JSON.stringify(controller.state()))});
 o.playerMemory.ui.saveDialog={stage:'success'};o.playerMemory.gameStats.savedGame=11;
 o.playerMemory.saveAttemptStatus=1;o.sram.sha256='league-save-verified';
 const result=controller.decide(o);
 assert.equal(controller.state().objective.target.saveVerified,true,'the native success dialog must see fresh save evidence after restart');
 assert.equal(result.winner?.recommendation?.kind,'acknowledge-cartridge-prompt');
 o.playerMemory.ui={};controller.decide(o);
 assert.equal(controller.state().objective.target.map,'MAP_POKEMON_LEAGUE_BRUNOS_ROOM');
 assert.equal(controller.state().save,null,'the verified intermission must not schedule a second save');
});

test('a League progress timeout retains the one-way challenge instead of restarting its agenda retry',()=>{
 const args=leagueControllerScene(),{o}=args;
 args.state.objective=resolvePostgameObjective('league-rematch',o,args.world,{}, {mechanics:args.mechanics});
 args.state.watchdog={idleMs:300001};
 const controller=createPostgameController(args),decision=controller.decide(o);
 assert.equal(decision.kind,'blocked');
 assert.match(decision.reason,/progress/i);
 assert.equal(controller.state().agenda.active,'league-rematch');
 assert.equal(controller.state().agenda.failures['league-rematch'],undefined);
});

test('a deferred evolution waits until the one-way League challenge has ended',()=>{
 const args=leagueControllerScene(),{o}=args;
 const pokemon={...mon(13,0),level:5,ivs:{hp:20,attack:20,defense:20,speed:20,spAttack:20,spDefense:20}};
 o.playerMemory.trainer.storage.pokemon.push(pokemon);
 const deferred={state:new FireRedEvolutionTask({requestId:'retained-weedle',sourceId:'owned-national-dex',pokemon,
  steps:[{kind:'evolve',game:'firered',fromSpecies:13,speciesId:14}],request:{speciesId:14,shiny:'any'}}).state,retryAt:0};
 args.state.deferredEvolutions=[deferred];
 for(let restart=0;restart<2;restart++){
  const controller=createPostgameController(args);controller.decide(o);
  assert.equal(controller.state().dexEvolution,null,'an elapsed collection cooldown cannot interrupt the League');
  assert.deepEqual(controller.state().deferredEvolutions,[deferred]);
  assert.equal((controller.state().pendingObjective??controller.state().objective).target.map,o.playerMemory.map.id);
  args.state=JSON.parse(JSON.stringify(controller.state()));
 }
});

for(const id of ['league-rematch','trainer-tower'])test(`${id} preparation keeps its supply budget while allowing necessary field healing`,()=>{
 const args=leagueControllerScene(),{o,world}=args;
 o.playerMemory.map.id='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
 args.state.agenda.active=id;
 world.maps[0].objectEvents.push({x:1,y:1,script:'Shop'});
 args.story={scripts:[{label:'Shop',instructions:[{op:'pokemart',args:['Stock']}]},
  {label:'Stock',instructions:[{op:'.2byte',args:['ITEM_ULTRA_BALL']}]}],symbols:{items:{ITEM_ULTRA_BALL:{value:2}}}};
 let controller=createPostgameController(args);controller.decide(o);
 assert.notEqual(controller.state().fieldCare.active?.kind,'shop','generic restocking cannot spend the challenge preparation budget');
 assert.notEqual((controller.state().pendingObjective??controller.state().objective)?.id,'stock-postgame-supplies');
 o.playerMemory.trainer.party[0].hp=20;
 controller=createPostgameController(args);controller.decide(o);
 assert.equal(controller.state().objective.target.kind,'heal-with-items','necessary field healing still owns its native transaction');
});

for(const [id,target] of [['trainer-tower',93],['league-rematch',77]])test(`${id} entry prepares every battle member before entering`,()=>{
 const {o,world,mechanics}=scene(id);
 mechanics.data.trainers=[{name:'TRAINER_CHAMPION_REMATCH_BULBASAUR',party:[{lvl:73},{lvl:75}]}];
 const route=structuredClone(world.maps[0]);route.id=id==='league-rematch'?'MAP_ROUTE23':'MAP_SEVEN_ISLAND_SEVAULT_CANYON';
 for(const i of [6,7]){route.layout.cells[i].behaviorName='MB_TALL_GRASS';route.layout.cells[i].encounterType=1;}
 world.maps.push(route);world.wildEncounters=[{map:route.id,land_mons:{encounter_rate:21,mons:[{min_level:50,max_level:55,species:'SPECIES_PIDGEY'}]}}];
 o.playerMemory.map.id=route.id;o.playerMemory.position={x:1,y:1};
 o.playerMemory.trainer.party=[3,22,53,67,55,149].map(mon);o.playerMemory.trainer.party[3].level=64;
 const objective=resolvePostgameObjective(id,o,world,{}, {mechanics});
 const training=selectTrainingObjective({world,observation:o,objective,teamPlan});
 assert.equal(training?.trainingSpecies,67,JSON.stringify({objective,training}));
 assert.equal(training.minimumTeamAnchorLevel,target);
 o.playerMemory.trainer.party.forEach(p=>{p.level=target;});
 const ready=resolvePostgameObjective(id,o,world,{}, {mechanics});
 assert.equal(selectTrainingObjective({world,observation:o,objective:ready,teamPlan}),null,'a prepared team can enter the challenge');
});

test('an active Tower challenge keeps battle ownership while its party needs recovery',()=>{
 const {o,world,mechanics}=scene('trainer-tower');
 o.playerMemory.map.id='MAP_TRAINER_TOWER_LOBBY';o.playerMemory.storyState.variableIds[0x4082]=1;
 o.playerMemory.postgameEvidence.trainerTowerChallenge=0;
 o.playerMemory.trainer.party=[3,22,53,67,55,149].map(mon);
 const objective=resolvePostgameObjective('trainer-tower',o,world,{}, {mechanics});
 assert.equal(objective.target.map,'MAP_TRAINER_TOWER_1F');
 assert.equal(selectTrainingObjective({world,observation:o,objective,teamPlan}),null,'training cannot replace an active challenge');
});

test('postgame battle preparation fights an owned ordinary encounter and retains shiny protection after restart',()=>{
 const {o,world,mechanics}=scene('trainer-tower');
 const route=structuredClone(world.maps[0]);route.id='MAP_SEVEN_ISLAND_SEVAULT_CANYON';
 for(const i of [6,7]){route.layout.cells[i].behaviorName='MB_TALL_GRASS';route.layout.cells[i].encounterType=1;}
 world.maps.push(route);world.wildEncounters=[{map:route.id,land_mons:{encounter_rate:21,mons:[{min_level:50,max_level:55,species:'SPECIES_RATTATA'}]}}];
 o.playerMemory.map.id=route.id;o.playerMemory.position={x:1,y:1};
 o.playerMemory.trainer.party=[3,22,53,67,55,149].map(mon);
 o.playerMemory.trainer.pokedex={ownedSpecies:[19,3,22,53,67,55,149]};
 o.playerMemory.trainer.bag.pokeBalls=[{itemId:4,quantity:30}];
 const enemy={...mon(19,0),personality:800,shiny:false,level:50,hp:30,maxHp:30,
  nature:{id:0},ivs:{hp:10,attack:10,defense:10,spAttack:10,spDefense:10,speed:10}};
 mechanics.data.species=Array.from({length:150},(_,id)=>({id,constant:`SPECIES_TEST_${id}`,types:['TYPE_NORMAL']}));
 mechanics.data.species[19]={id:19,types:['TYPE_NORMAL']};mechanics.data.species[3]={id:3,types:['TYPE_GRASS']};
 mechanics.data.moves[33]={id:33,pp:35,power:35,accuracy:100,type:'TYPE_NORMAL',effect:'EFFECT_HIT'};
 Object.assign(o,{captureId:'training-battle',phaseReasons:[]});
 Object.assign(o.emulator,{mode:'battle',inBattle:true});
 Object.assign(o.playerMemory,{battleTypeFlags:4,battleOutcome:0,ui:{battle:{stage:'action',cursor:0}},
  encounter:{kind:'wild',validity:'valid',pokemon:enemy},battle:{player:o.playerMemory.trainer.party[0],opponent:enemy,opponents:[enemy],turn:0}});
 for(const evidence of [o.emulator,o.sram,o.playerMemory])Object.assign(evidence,{frame:o.frame,captureId:o.captureId});
 const objective=resolvePostgameObjective('trainer-tower',o,world,{}, {mechanics});
 const state={schema:'pokemon-suite/postgame/v1',objective,fieldTeamPlan:teamPlan,preparation:{phase:'complete'}};
 const args={world,story:{data:{scripts:[]}},mechanics};
 let controller=createPostgameController({...args,state});
 for(let i=0;i<2;i++){
  const d=controller.decide(o);
  assert.equal(d.winner?.recommendation?.targetCommand,'fight',JSON.stringify(d));
  controller=createPostgameController({...args,state:JSON.parse(JSON.stringify(controller.state()))});
 }
 const ready=structuredClone(o);ready.playerMemory.trainer.party.forEach(p=>{p.level=93;});
 const finished=createPostgameController({...args,state});
 assert.equal(finished.decide(ready).winner?.recommendation?.targetCommand,'run','training permission ends when its level requirement is met');
 const shiny=structuredClone(o);shiny.playerMemory.encounter.pokemon.shiny=true;
 controller.decide(shiny);
 assert.equal(controller.state().player.encounterSafety.capture?.pokemon.shiny,true);
});

test('a Tower defeat survives its cleared cartridge loss flag and cannot immediately repeat the same prepared team',()=>{
 const {o,world,mechanics}=scene('trainer-tower');
 o.playerMemory.postgameEvidence.trainerTower.slice(1).forEach(record=>{record.receivedPrize=true;});
 o.playerMemory.trainer.party=[3,22,53,67,55,149].map(mon).map(p=>({...p,level:93}));
 o.playerMemory.map.id='MAP_TRAINER_TOWER_1F';o.playerMemory.storyState.variableIds[0x4082]=1;
 o.playerMemory.postgameEvidence.trainerTowerChallenge=0;
 Object.assign(o.emulator,{mode:'battle',inBattle:true});o.playerMemory.battleOutcome=0;
 let agenda=new PostgameAgenda();agenda.state.workflows={tower:{mode:0}};
 agenda.observe(o);agenda=new PostgameAgenda(JSON.parse(JSON.stringify(agenda.state)));
 o.playerMemory.battleOutcome=2;agenda.observe(o);
 Object.assign(o.emulator,{mode:'overworld',inBattle:false});o.playerMemory.map.id='MAP_TRAINER_TOWER_LOBBY';
 o.playerMemory.storyState.variableIds[0x4082]=0;
 // The cartridge heals the party and clears hasLost in the lobby script.
 agenda.observe(o);agenda=new PostgameAgenda(JSON.parse(JSON.stringify(agenda.state)));
 let objective=resolvePostgameObjective('trainer-tower',o,world,agenda.state.workflows,{mechanics});
 assert.equal(objective.target.kind,'stop-for-review');
 assert.match(objective.target.reason,/same.*team|team.*unchanged/i);
 o.playerMemory.trainer.party.reverse().forEach((p,slot)=>{p.slot=slot;});
 objective=resolvePostgameObjective('trainer-tower',o,world,agenda.state.workflows,{mechanics});
 assert.match(objective.target.reason,/same.*team|team.*unchanged/i,'party ordering is not battle preparation');
 o.playerMemory.trainer.party[0].moves=[89];
 objective=resolvePostgameObjective('trainer-tower',o,world,agenda.state.workflows,{mechanics});
 assert.doesNotMatch(objective.target.reason??'',/same.*team|team.*unchanged/i,'a changed move set permits a new attempt');
});
