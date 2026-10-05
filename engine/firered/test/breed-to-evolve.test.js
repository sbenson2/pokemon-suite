import test from 'node:test';
import assert from 'node:assert/strict';
import * as acquisition from '../src/suite/native-acquisition.js';
import {moveSafeSteps} from '../src/suite/native-breeding.js';
import {encounterFingerprint as fingerprint} from '../src/player/encounter-tracker.js';

// Live September 28 (build 123): this save's only Eevee and only Omanyte are
// shiny. Shinies are never evolved, so Vaporeon, Jolteon, Flareon and Omastar
// had no usable source. The cartridge Day Care can breed a plain copy from the
// shiny and Ditto; the shiny must come back unchanged except for the Day Care's
// own experience (pokefirered src/daycare.c TakeSelectedPokemonFromDaycare adds
// one experience point per step on withdrawal and teaches level-up moves).
const pct=n=>({call:'PERCENT_FEMALE',args:[n]});
const facts=[[133,'EEVEE',['FIELD'],pct(12.5)],[134,'VAPOREON',['FIELD'],pct(12.5)],[138,'OMANYTE',['WATER_1','WATER_3'],pct(12.5)],[139,'OMASTAR',['WATER_1','WATER_3'],pct(12.5)],
 [132,'DITTO',['DITTO'],'MON_GENDERLESS'],[19,'RATTATA',['FIELD'],pct(50)],[52,'MEOWTH',['FIELD'],pct(50)],[150,'MEWTWO',['UNDISCOVERED'],'MON_GENDERLESS'],[172,'PICHU',['UNDISCOVERED'],pct(50)],[25,'PIKACHU',['FIELD','FAIRY'],pct(50)]];
const mechanics={data:{species:facts.map(([id,name,groups,genderRatio])=>({id,name:'SPECIES_'+name,eggGroups:groups.map(g=>'EGG_GROUP_'+g),genderRatio,growthRate:'GROWTH_MEDIUM_FAST'}))}};
const p=(species,personality,more={})=>({species,personality,otId:10,validity:'valid',isEgg:false,shiny:false,level:30,experience:27000,friendship:70,hp:50,maxHp:50,heldItem:0,moves:[33],
 evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},abilityNum:0,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...more});
// Eevee (FireRed level-up table): the next move after level 25 is Bite at 30.
const learnsets={133:[[1,33],[1,39],[1,270],[8,28],[16,45],[23,98],[30,44],[36,226],[42,36]],138:[[1,132],[1,110],[13,44],[19,55],[25,341]]};
// Personality 255 is male for a 12.5% female species (low byte >= 31).
const shinyEevee=()=>p(133,0x0000ff00|255,{shiny:true,level:25,experience:15625,moves:[270,28,45,98]});
const trainer=()=>({partyValidity:'valid',party:[p(22,1000,{slot:0,moves:[19]})],storage:{validity:'valid',pokemon:[shinyEevee(),p(132,50,{level:52,experience:140608,moves:[144]})],boxCounts:[2,...Array(13).fill(0)]},
 pokedex:{ownedSpecies:[22,133,132]},bag:{items:[]},money:500000});

test('the Day Care may add experience only below the next level that teaches a move',()=>{
 assert.equal(moveSafeSteps(shinyEevee(),learnsets[133],mechanics),27000-15625-1,'Bite at 30 bounds a level-25 Eevee');
 assert.equal(moveSafeSteps(p(138,3,{level:5,experience:125}),learnsets[138],mechanics),2197-125-1,'Bite at 13 bounds a level-5 Omanyte');
 assert.equal(moveSafeSteps(p(133,4,{level:100,experience:1000000}),learnsets[133],mechanics),Infinity,'level 100 gains nothing');
 assert.equal(moveSafeSteps(shinyEevee(),undefined,mechanics),null,'an unread learnset is never guessed');
});

test('a shiny-only base form breeds a plain copy for its missing evolution with Ditto',()=>{
 const t=trainer(),choice=acquisition.selectBreedToEvolve({trainer:t,mechanics,learnsets,canSupply:id=>id===97});
 assert.equal(choice?.speciesId,133);assert.equal(choice.evolutionTarget,134);
 assert.deepEqual(choice.parents.map(x=>x.species),[133,132]);
 assert.equal(choice.protectedParent,fingerprint(t.storage.pokemon[0]));assert.equal(choice.moveSafeSteps,11374);
 // Ordinary breeding for a missing species still never uses a shiny.
 assert.equal(acquisition.selectOwnedBreeding({trainer:t,mechanics}),null);
});

test('breed-to-evolve never replaces an ordinary evolution source and respects every guard',()=>{
 const t=trainer();
 t.storage.pokemon.push(p(133,77));assert.equal(acquisition.selectBreedToEvolve({trainer:t,mechanics,learnsets,canSupply:()=>true}),null,'a plain Eevee evolves directly');
 const reserved=trainer();assert.equal(acquisition.selectBreedToEvolve({trainer:reserved,mechanics,learnsets,canSupply:()=>true,protectedFingerprints:[fingerprint(reserved.storage.pokemon[0])]}),null,'a reserved shiny is never deposited');
 const noDitto=trainer();noDitto.storage.pokemon.pop();noDitto.storage.pokemon.push(p(19,60));
 assert.equal(acquisition.selectBreedToEvolve({trainer:noDitto,mechanics,learnsets,canSupply:()=>true}),null,'a male Eevee with a Rattata makes Rattata eggs');
 const female=trainer();female.storage.pokemon[0].personality=0x0000ff00|3;female.storage.pokemon.pop();female.storage.pokemon.push(p(52,60|0xff));
 assert.equal(acquisition.selectBreedToEvolve({trainer:female,mechanics,learnsets,canSupply:()=>true})?.parents[1].species,52,'a female Eevee with a male Field partner lays Eevee eggs');
 const unread=trainer();assert.equal(acquisition.selectBreedToEvolve({trainer:unread,mechanics,learnsets:{},canSupply:()=>true}),null,'no learnset, no deposit');
 const late=trainer();late.storage.pokemon[0].experience=27000-100;assert.equal(acquisition.selectBreedToEvolve({trainer:late,mechanics,learnsets,canSupply:()=>true}),null,'less than one Egg roll before a new move');
 const full=trainer();full.storage.boxCounts=Array(14).fill(30);assert.equal(acquisition.selectBreedToEvolve({trainer:full,mechanics,learnsets,canSupply:()=>true}),null,'the PC reserve is kept');
 const stone=trainer();assert.equal(acquisition.selectBreedToEvolve({trainer:stone,mechanics,learnsets,canSupply:()=>false}),null,'no Egg for an evolution whose stone is out of reach');
 const inParty=trainer();inParty.party.push({...inParty.storage.pokemon.shift(),slot:1});assert.equal(acquisition.selectBreedToEvolve({trainer:inParty,mechanics,learnsets,canSupply:()=>true}),null,'the travelling party is never used');
});

const world={data:{maps:[{id:'MAP_FOUR_ISLAND_POKEMON_DAY_CARE',objectEvents:[{script:'FourIsland_PokemonDayCare_EventScript_DaycareWoman'}]},{id:'MAP_FOUR_ISLAND',objectEvents:[{script:'FourIsland_EventScript_DaycareMan'}]}]}};
const observation=(counter=10)=>({phase:'stable',frame:100,emulator:{mode:'overworld',inputReady:true,inBattle:false},sram:{sha256:'a'.repeat(64)},playerMemory:{map:{id:'MAP_FOUR_ISLAND_POKEMON_CENTER_1F'},ui:{},gameStats:{savedGame:10},trainer:trainer(),
 postgameEvidence:{acquisition:{prompt:null,withdrawalCost:100,selectedParent:0,happinessStepCounter:counter,learnsets,daycare:{validity:'valid',parents:[],pendingEgg:false,offspringPersonality:0,menuCursor:null}}}}});
const plan=()=>acquisition.selectBreedToEvolve({trainer:trainer(),mechanics,learnsets,canSupply:()=>true});
const create=(state=null)=>{const c=plan();return acquisition.createPostgameAcquisition({kind:'breeding',requestId:'breed-eevee',...c,world,mechanics,state});};

test('a shiny parent is accepted only as the named protected parent of its own base-form Egg',()=>{
 const c=plan();
 assert.throws(()=>acquisition.createPostgameAcquisition({kind:'breeding',requestId:'x',speciesId:133,parents:c.parents,world,mechanics}),/Breeding requires/);
 assert.throws(()=>acquisition.createPostgameAcquisition({kind:'breeding',requestId:'x',speciesId:133,parents:c.parents,protectedParent:fingerprint(c.parents[1]),world,mechanics}),/Breeding requires/);
 const task=create();assert.equal(task.state.protectedParent.fingerprint,c.protectedParent);
 assert.deepEqual(task.state.protectedParent.before.moves,[270,28,45,98]);
});

test('the protected parent leaves the PC only early in the cartridge’s 128-step friendship cycle',()=>{
 let task=create();const late=observation(100);
 let next=task.inspect(late);
 assert.equal(next.objective?.target.kind,'friendship-walk','walk until the happiness step counter wraps');
 assert.notEqual(task.state.dirty,true);
 task=create(task.state);next=task.inspect(observation(10));
 assert.equal(next.objective?.target.kind,'party-roster');assert.ok(next.objective.target.requiredFingerprints.includes(plan().protectedParent));
});

function deposited(steps,counter=10){
 const o=observation(counter),m=o.playerMemory,a=m.postgameEvidence.acquisition,[shiny,ditto]=m.trainer.storage.pokemon;
 m.trainer.storage.pokemon=[];a.daycare.parents=[{...shiny,slot:0,steps},{...ditto,slot:1,steps}];m.map.id='MAP_FOUR_ISLAND';
 return o;
}
test('the Egg wait retrieves both parents before the shiny’s move-safe budget runs out',()=>{
 let task=create(),o=observation();task.inspect(o);
 o=deposited(1000);task=create({...task.state,deposited:true,dirty:true,preparationGoal:null,initial:task.state.initial??[]});
 assert.equal(task.inspect(o).objective?.target.kind,'friendship-walk','an Egg-less pair keeps walking');
 o=deposited(11374-100);const next=task.inspect(o);
 assert.equal(task.state.noEgg,true,'the budget ends the Egg wait');
 assert.equal(next.objective?.target.map,'MAP_FOUR_ISLAND_POKEMON_DAY_CARE','go back to the Day Care woman');
 assert.equal(task.inspect(deposited(11374-100,100)).objective?.target.kind,'friendship-walk','align the friendship counter before withdrawing the shiny');
});

test('after the Egg, the shiny returns to the PC before hatching and the receipt proves it unchanged',()=>{
 let task=create();const o=observation(),m=o.playerMemory,base=task.inspect(o);assert.ok(base);
 const [shiny,ditto]=m.trainer.storage.pokemon,egg=p(133,999,{isEgg:true,slot:1,level:5,experience:125});
 const back={...shiny,experience:shiny.experience+1200,slot:2},dittoBack={...ditto,experience:ditto.experience+1200,slot:3};
 const state={...task.state,deposited:true,dirty:true,egg:fingerprint(egg),phase:'returning-parents',parentsReturned:[fingerprint(shiny),fingerprint(ditto)],preparationGoal:null,
  protectedParent:{...task.state.protectedParent,daycareSteps:1200}};
 m.trainer.storage.pokemon=[];m.trainer.party.push(egg,back,dittoBack);
 task=create(state);let next=task.inspect(o);
 assert.equal(next.objective?.target.kind,'party-roster');assert.deepEqual(next.objective.target.excludedFingerprints,[fingerprint(shiny)]);
 m.trainer.party=m.trainer.party.filter(x=>fingerprint(x)!==fingerprint(shiny));m.trainer.storage.pokemon=[{...back,box:0,slot:0}];
 task=create(task.state);next=task.inspect(o);
 assert.equal(next.objective?.target.kind,'friendship-walk','hatch only after the shiny is stored');assert.equal(next.objective.target.fingerprint,fingerprint(egg));
 m.trainer.party[1]={...egg,isEgg:false,friendship:120};m.trainer.pokedex.ownedSpecies.push(133);
 m.trainer.party=[m.trainer.party[0]];m.trainer.storage.pokemon.push({...egg,isEgg:false,box:0,slot:1},{...dittoBack,box:0,slot:2});
 task=create(task.state);next=task.inspect(o);assert.equal(next.objective?.target.kind,'save-game');
 m.gameStats.savedGame=11;m.saveAttemptStatus=1;o.sram.sha256='b'.repeat(64);
 const done=task.inspect(o);assert.equal(done.kind,'complete');
 const r=done.receipt.protectedParent;
 assert.equal(r.fingerprint,fingerprint(shiny));assert.deepEqual(r.after.moves,r.before.moves);
 assert.equal(r.after.experience-r.before.experience,1200);assert.equal(r.after.friendship,r.before.friendship);assert.equal(r.after.location,'pc');
});

test('a protected parent whose moves, item or shininess changed stops for review',()=>{
 for(const change of [{moves:[44,28,45,98]},{heldItem:5},{shiny:false}]){
  let task=create();const o=observation(),m=o.playerMemory;task.inspect(o);
  const [shiny,ditto]=m.trainer.storage.pokemon,egg=p(133,999,{isEgg:true,slot:1});
  const state={...task.state,deposited:true,dirty:true,egg:fingerprint(egg),parentsReturned:[fingerprint(shiny),fingerprint(ditto)],preparationGoal:null};
  m.trainer.storage.pokemon=[];m.trainer.party.push(egg,{...shiny,...change,slot:2},{...ditto,slot:3});
  task=create(state);assert.equal(task.inspect(o).kind,'stop',JSON.stringify(change));
 }
});
