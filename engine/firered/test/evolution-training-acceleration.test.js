import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTrainingObjective} from '../src/player/campaign.js';
import {estimateTrainingCycle} from '../src/player/training-quality.js';
import {FireRedEvolutionTask} from '../src/suite/fire-red-evolution.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
import {campaignTaskFixture} from '../test-support/campaign-task-fixture.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';

// Postgame dex evolutions train one identified Pokémon. A strong escort may
// fight while the trainee switches in for a share, so high-level tables become
// safe; the switch-first rule and trainee protection are unchanged.
const cell=(grass,door)=>(x,y)=>({x,y,collision:door&&x===3&&y===2?1:0,elevation:3,encounterType:grass?1:0,
  behaviorName:door&&x===3&&y===2?'MB_WARP_DOOR':grass?'MB_TALL_GRASS':'MB_NORMAL'});
const map=(id,{connections=[],grass=false,door=false,warpEvents=[],objectEvents=[]}={})=>({id,connections,warpEvents,objectEvents,
  coordEvents:[],properties:{},layout:{width:8,height:6,blockDataSha256:id,cells:Array.from({length:48},(_,i)=>cell(grass,door)(i%8,Math.floor(i/8)))}});
const ivs={hp:10,attack:10,defense:10,speed:10,spAttack:10,spDefense:10};
const trainee={validity:'valid',slot:0,species:188,personality:1,otId:700,ivs,level:23,hp:60,maxHp:60,status1:0,heldItem:0,
  stats:{attack:30,spAttack:30},moves:[33],pp:[35],experience:10050,
  experienceProgress:{current:10050,levelStart:10000,nextLevel:11400,remaining:1350,ratio:0.04}};
const fearow={validity:'valid',slot:1,species:22,personality:2,otId:700,ivs,level:100,hp:300,maxHp:300,status1:0,heldItem:0,
  stats:{attack:250,spAttack:120},moves:[65],pp:[20]};
const seadra={validity:'valid',slot:2,species:117,personality:3,otId:700,ivs,level:32,hp:90,maxHp:90,status1:0,heldItem:0,
  stats:{attack:70,spAttack:80},moves:[33],pp:[35]};
function world(){
  const city=map('MAP_T_CITY',{connections:[{direction:'up',map:'MAP_T_ROUTE',offset:0}],door:true,
    warpEvents:[{x:3,y:2,dest_map:'MAP_T_CITY_POKEMON_CENTER_1F',dest_warp_id:'0'}]});
  const center=map('MAP_T_CITY_POKEMON_CENTER_1F',{warpEvents:[{x:3,y:5,dest_map:'MAP_T_CITY',dest_warp_id:'0'}],
    objectEvents:[{x:3,y:1,script:'TCity_PokemonCenter_1F_EventScript_Nurse'}]});
  const route=map('MAP_T_ROUTE',{grass:true,connections:[{direction:'down',map:'MAP_T_CITY',offset:0},{direction:'up',map:'MAP_T_PATH_A',offset:0}]});
  const pathA=map('MAP_T_PATH_A',{connections:[{direction:'down',map:'MAP_T_ROUTE',offset:0},{direction:'up',map:'MAP_T_PATH_B',offset:0}]});
  const pathB=map('MAP_T_PATH_B',{connections:[{direction:'down',map:'MAP_T_PATH_A',offset:0},{direction:'up',map:'MAP_T_CAVE',offset:0}]});
  const cave=map('MAP_T_CAVE',{grass:true,connections:[{direction:'down',map:'MAP_T_PATH_B',offset:0}]});
  const table=(species,min,max)=>({encounter_rate:21,mons:Array.from({length:12},()=>({species,min_level:min,max_level:max}))});
  return {maps:[city,center,route,pathA,pathB,cave],wildEncounters:[
    {map:'MAP_T_ROUTE',land_mons:table('SPECIES_DIGLETT',8,10)},{map:'MAP_T_CAVE',land_mons:table('SPECIES_KADABRA',55,60)}]};
}
const mechanics={species:[{id:50,name:'SPECIES_DIGLETT',expYield:81,baseHP:10,baseDefense:25,baseSpDefense:45,types:['TYPE_GROUND']},
  {id:64,name:'SPECIES_KADABRA',expYield:145,baseHP:40,baseDefense:30,baseSpDefense:70,types:['TYPE_PSYCHIC']}],
  moves:[{id:33,name:'MOVE_TACKLE',power:35,pp:35,type:'TYPE_NORMAL',accuracy:95,effect:'EFFECT_HIT'},
    {id:65,name:'MOVE_DRILL_PECK',power:80,pp:20,type:'TYPE_FLYING',accuracy:100,effect:'EFFECT_HIT'}],typeChart:[],trainers:[],rematches:[]};
function observation({party=[trainee,fearow,seadra],items=[]}={}){
  return {captureId:'accel',frame:100,phase:'stable',phaseReasons:[],sram:{captureId:'accel',frame:100,sha256:'accel'},
    emulator:{captureId:'accel',frame:100,mode:'overworld',inputReady:true,callback2:'CB2_Overworld'},
    playerMemory:{captureId:'accel',frame:100,map:{id:'MAP_T_ROUTE'},position:{x:2,y:3},ui:{},storyState:{flagIds:{2092:true},variableIds:{}},
      trainer:{party:structuredClone(party),partyCount:party.length,partyValidity:'valid',usablePartyCount:party.length,bag:{keyItems:[],items}}}};
}
const evolution={id:'evolution-dex-700-1-189-train',target:{kind:'map',map:'MAP_T_ROUTE'},identityEvolution:true,
  minimumCoreLevel:27,coreSpecies:[188],trainingFingerprint:encounterFingerprint(trainee)};
const select=(objective,o=observation())=>selectTrainingObjective({world:world(),mechanics,observation:o,objective});

test('an evolution trainee switch-trains with the strongest healthy escort at the most productive safe table',()=>{
  const selected=select(evolution);
  assert.equal(selected?.target.map,'MAP_T_CAVE','the high-yield table is reachable with the strongest escort');
  assert.equal(selected.trainingMethod,'switch');
  assert.equal(selected.escortPartySlot,1,'the level 100 escort fights, not the weaker level 32 member');
  assert.equal(selected.trainingPartySlot,0);
});

test('story roster training keeps its existing direct-first choice and escort',()=>{
  const story={id:'train-carrier',target:{kind:'roster-training'},minimumCoreLevel:27,coreSpecies:[188]};
  const selected=select(story);
  assert.equal(selected?.target.map,'MAP_T_ROUTE');
  assert.notEqual(selected.trainingMethod,'switch');
});

test('an evolution trainee asks for the owned Exp. Share from the bag or another party member',()=>{
  assert.equal(select(evolution,observation({items:[{itemId:182,quantity:1}]}))?.expSharePartySlot,0);
  assert.equal(select(evolution,observation({party:[trainee,{...fearow,heldItem:182},seadra]}))?.expSharePartySlot,0);
  assert.equal(select(evolution)?.expSharePartySlot,undefined,'no Exp. Share is invented');
});

test('travel is charged once across the battles still needed, not on every battle',()=>{
  const member={slot:0,species:1,personality:12,otId:34,level:25,experience:10000,hp:70,maxHp:70,stats:{attack:50,spAttack:50},moves:[1],pp:[30],heldItem:0};
  const data={species:[{id:1,name:'SPECIES_TEST',baseHP:40,baseDefense:40,baseSpDefense:40,types:['TYPE_NORMAL'],expYield:100}],
    moves:[{id:1,name:'MOVE_POUND',power:40,accuracy:100,type:'TYPE_NORMAL',effect:'EFFECT_HIT',pp:35}],typeChart:[]};
  const remote={riskTier:0,trainingMethod:'direct',metrics:{transitions:8,localSteps:100},healerTransitions:0,
    encounter:{map:'MAP_A',rate:21,expectedExperienceYield:700,mons:[{species:1,level:20,weight:1}]}};
  const once=estimateTrainingCycle(remote,{member,mechanics:data});
  const amortized=estimateTrainingCycle(remote,{member,mechanics:data,experienceNeeded:once.traineeExperience*30});
  assert.ok(amortized.xpPerGameMinute>once.xpPerGameMinute*1.5,'a long job spreads the trip across its battles');
  assert.equal(estimateTrainingCycle(remote,{member,mechanics:data,experienceNeeded:once.traineeExperience/2}).xpPerGameMinute,once.xpPerGameMinute);
});

// Rare Candy set experience to the next level's threshold, so progress inside
// the current level is lost. Limited candies go to expensive levels.
const mon=(species,extra={})=>({validity:'valid',species,personality:123,otId:456,shiny:true,level:20,friendship:70,heldItem:0,slot:0,hp:70,maxHp:70,status1:0,
  moves:[33],pp:[35],ivs:{hp:20,attack:20,defense:20,speed:20,spAttack:20,spDefense:20},evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},...extra});
const observe=(party,{items=[{itemId:68,quantity:2}],storage=[]}={})=>({phase:'stable',frame:100,emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'before'},
  playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},position:{x:7,y:8},ui:{},storyState:{flagIds:{2112:true}},gameStats:{savedGame:7},saveAttemptStatus:1,
    trainer:{money:10000,partyValidity:'valid',party,storage:{validity:'valid',pokemon:storage},bag:{items}}}});
const larvitar=(progress,extra={})=>mon(246,{experienceProgress:progress,experience:progress.current,...extra});
const evolveTask=p=>new FireRedEvolutionTask({requestId:'dex-456-123-247',sourceId:'owned-national-dex',pokemon:p,
  steps:[{kind:'evolve',game:'firered',fromSpecies:246,speciesId:247},{kind:'verify',game:'firered',speciesId:247}],request:{game:'firered',speciesId:247,shiny:'required',quantity:1}});
const cheapFresh={current:1000,levelStart:1000,nextLevel:1900,remaining:900};
const costlyFresh={current:60000,levelStart:60000,nextLevel:66000,remaining:6000};
const costlyMidway={current:63000,levelStart:60000,nextLevel:66000,remaining:3000};
const kind=r=>r.kind==='policy'?r.objective.target.kind:r.kind;

test('a limited Rare Candy stock is spent on an expensive level right after a natural level-up',()=>{
  assert.equal(kind(evolveTask(larvitar(cheapFresh)).inspect(observe([larvitar(cheapFresh)]))),'map','a cheap level keeps training');
  const fresh=evolveTask(larvitar(costlyFresh)).inspect(observe([larvitar(costlyFresh)]));
  assert.equal(fresh.objective.target.kind,'use-party-item');assert.equal(fresh.objective.target.itemId,68);
  assert.equal(kind(evolveTask(larvitar(costlyMidway)).inspect(observe([larvitar(costlyMidway)]))),'map','progress inside a level is not thrown away');
  assert.equal(evolveTask(larvitar(cheapFresh)).inspect(observe([larvitar(cheapFresh)]),{renewableCandies:true}).objective.target.itemId,68,'a renewable supply candies every level');
});

test('an expensive level fetches a reachable Rare Candy instead of training, and only when one is reachable',()=>{
  const p=larvitar(costlyFresh),o=observe([p],{items:[]});
  const supply=evolveTask(p).inspect(o,{canSupply:id=>id===68});
  assert.equal(supply.kind,'supply');assert.equal(supply.item.nativeId,68);
  assert.equal(kind(evolveTask(p).inspect(o,{canSupply:()=>false})),'map');
  assert.equal(kind(evolveTask(larvitar(cheapFresh)).inspect(observe([larvitar(cheapFresh)],{items:[]}),{canSupply:()=>true})),'map','cheap levels never detour for a candy');
});

test('the owned Exp. Share is withdrawn from the PC with the trainee and returned to the bag before the evolution save',()=>{
  const p=larvitar(cheapFresh),raichu=mon(26,{slot:null,shiny:false,personality:999,heldItem:182});
  const e=evolveTask(p);
  const withdraw=e.inspect(observe([p],{items:[],storage:[raichu]}));
  assert.equal(withdraw.objective.target.kind,'party-roster');
  assert.deepEqual(new Set(withdraw.objective.target.requiredFingerprints),new Set([encounterFingerprint(p),encounterFingerprint(raichu)]));
  assert.equal(kind(e.inspect(observe([p],{items:[{itemId:182,quantity:1}]}))),'map','in the bag it is equipped by the training objective');
  const evolved={...p,species:247,heldItem:182};
  const o=observe([evolved],{items:[]});
  const back=e.inspect(o);
  assert.equal(back.objective.target.kind,'take-held-item');assert.equal(back.objective.target.itemId,182);
  o.playerMemory.trainer.party[0].heldItem=0;
  assert.equal(e.inspect(o).objective.target.kind,'save-game','the receipt still needs the fresh native save');
});

test('repeated training selections reuse identical inputs and recompute after any observation change',()=>{
  const f=campaignTaskFixture({training:true}),{planner}=f.open(),o=f.observation(100,{responses:false});
  const results=[1,2,3,4,5].map(()=>planner.selectTraining(o,f.objective));
  assert.deepEqual(results[4],results[3]);
  assert.notEqual(results[4],results[3],'callers receive independent copies');
  assert.deepEqual(planner.trainingSelectionStats(),{computed:2,reused:3},'the first commit changes the retained task once; later identical calls reuse it');
  o.playerMemory.trainer.party[0].hp=1;
  planner.selectTraining(o,f.objective);
  assert.equal(planner.trainingSelectionStats().computed,3,'an in-place change to the same observation object is a new input');
  planner.selectTraining(structuredClone(o),f.objective);
  assert.equal(planner.trainingSelectionStats().computed,3,'an equal observation reuses the result');
});

test('evolution training moves only the assigned Exp. Share, never another held item',()=>{
  const member={...trainee,slot:1},holder={...seadra,slot:2,species:26,personality:9,heldItem:182};
  const objective={...evolution,trainingFingerprint:encounterFingerprint(member)};
  const quest=training=>createPolicyAdvisors({mechanics,campaignPlanner:{select:()=>objective,selectCollection:()=>null,selectTraining:()=>training}})
    .find(a=>a.id==='quest');
  const o={captureId:'q',frame:1,phase:'stable',phaseReasons:[],emulator:{captureId:'q',frame:1,mode:'overworld',inputReady:true,callback2:'CB2_Overworld'},
    sram:{captureId:'q',frame:1,sha256:'s'},playerMemory:{captureId:'q',frame:1,sha256:'m',map:{id:'MAP_T_ROUTE'},position:{x:1,y:1},battle:null,ui:{},
      storyState:{flagIds:{},variableIds:{}},trainer:{partyCount:3,usablePartyCount:3,partyValidity:'valid',party:[{...fearow,slot:0},member,holder],
        bag:{items:[{itemId:195,quantity:1}]}}}};
  const training={id:'train-battle-member',target:{kind:'encounter-zone',map:'MAP_T_CAVE'},trainingPartySlot:1,forObjective:objective.id};
  assert.equal(quest({...training,expSharePartySlot:1}).advise(o)?.recommendation?.objective,'move-exp-share-to-slot-1');
  const unassigned=quest(training).advise(o)?.recommendation?.objective??'';
  assert.doesNotMatch(unassigned,/exp-share|equip-held-item/,'an evolution task never re-equips the party on its own');
});
