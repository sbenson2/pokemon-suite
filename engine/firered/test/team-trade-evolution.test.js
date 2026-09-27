import test from 'node:test';
import assert from 'node:assert/strict';
import * as tasks from '../src/suite/fire-red-evolution.js';
import * as agenda from '../src/suite/postgame-agenda.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// A permanent team member with a trade evolution (Machoke) travels to the
// partner and returns evolved, even when the evolved species is registered.
const mon=(species,id=100,extra={})=>({species,personality:id,otId:10,validity:'valid',shiny:false,isEgg:false,level:90,heldItem:0,moves:[19],friendship:255,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...extra});
const plan={permanentFamilies:[[1,2,3],[21,22],[52,53],[66,67,68],[54,55],[147,148,149],[74,75,76],[95,208]]};
const trainer=()=>({partyValidity:'valid',party:[mon(22,1),mon(67,2),mon(55,3),mon(149,4),mon(53,5),mon(3,6)],storage:{validity:'valid',pokemon:[mon(64,7)]},pokedex:{ownedSpecies:[3,22,53,55,64,67,68,149]},bag:{}});
const observation=t=>({frame:100,phase:'stable',sram:{sha256:'before'},emulator:{mode:'overworld',inBattle:false,inputReady:true},playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},position:{x:7,y:8},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true}},gameStats:{savedGame:312,leagueEntries:19,eggsHatched:3},postgameEvidence:{},trainer:t}});

test('a permanent teammate with a trade evolution is routed through the partner even when its evolution is registered',()=>{
 const t=trainer();
 assert.equal(tasks.selectTeamPartnerEvolution?.({trainer:t,partnerAvailable:false,teamPlan:plan}),null);
 const route=tasks.selectTeamPartnerEvolution?.({trainer:t,partnerAvailable:true,teamPlan:plan});
 assert.equal(route?.request.speciesId,68);assert.equal(route.pokemon.personality,2);
 assert.equal(route.automatic,true);assert.match(route.requestId,/^team-partner-/);
 assert.deepEqual(route.steps.map(s=>[s.kind,s.game??s.fromGame]),[['trade','firered'],['trade','emerald'],['verify','firered']]);
 // The Dex route still takes only PC spares.
 assert.equal(tasks.selectOwnedPartnerEvolution({trainer:t,partnerAvailable:true})?.pokemon.personality,7);
});

test('team routes keep shiny, Everstone, reserved and non-permanent members at home',()=>{
 const t=trainer();
 t.party[1].shiny=true;assert.equal(tasks.selectTeamPartnerEvolution({trainer:t,partnerAvailable:true,teamPlan:plan}),null);
 t.party[1].shiny=false;t.party[1].heldItem=195;assert.equal(tasks.selectTeamPartnerEvolution({trainer:t,partnerAvailable:true,teamPlan:plan}),null);
 t.party[1].heldItem=0;
 assert.equal(tasks.selectTeamPartnerEvolution({trainer:t,partnerAvailable:true,teamPlan:plan,protectedFingerprints:[encounterFingerprint(t.party[1])]}),null);
 // A temporary helper (Kadabra) is not a permanent family member.
 t.party[1]=mon(64,2);assert.equal(tasks.selectTeamPartnerEvolution({trainer:t,partnerAvailable:true,teamPlan:plan}),null);
 // Without a campaign plan the whole party is the team.
 assert.equal(tasks.selectTeamPartnerEvolution({trainer:t,partnerAvailable:true,teamPlan:null})?.request.speciesId,65);
});

test('a teammate that needs a held trade item is equipped from the bag first',()=>{
 const t=trainer();t.party[1]=mon(95,2);
 assert.equal(tasks.selectTeamPartnerEvolution({trainer:t,partnerAvailable:true,teamPlan:plan}),null,'no Metal Coat');
 t.bag.items=[{itemId:199,quantity:1}];
 const route=tasks.selectTeamPartnerEvolution({trainer:t,partnerAvailable:true,teamPlan:plan});
 assert.equal(route?.request.speciesId,208);assert.equal(route.steps[0].kind,'equip-evolution-item');assert.equal(route.steps[0].item.nativeId,199);
});

test('the postgame checklist evolves teammates through the partner right after keeping a Fly user',()=>{
 const t=trainer(),o=observation(t),entries=agenda.postgameChecklist(o,{},plan),ids=entries.map(e=>e.id);
 const entry=entries.find(e=>e.id==='team-evolution');
 assert.equal(entry?.status,'pending');assert.equal(entry.executable,true);
 assert.equal(ids.indexOf('team-evolution'),ids.indexOf('fly-carrier')+1);
 const objective=agenda.resolvePostgameObjective('team-evolution',o,{data:{maps:[]}},{},{partnerAvailable:true,teamPlan:plan});
 assert.equal(objective.target.kind,'postgame-evolve');assert.equal(objective.evolution.request.speciesId,68);
 assert.equal(objective.evolution.pokemon.personality,2);
 const waiting=agenda.resolvePostgameObjective('team-evolution',o,{data:{maps:[]}},{},{partnerAvailable:false,teamPlan:plan});
 assert.equal(waiting.target.kind,'stop-for-review');assert.match(waiting.target.reason,/partner/);
 t.party[1]=mon(68,2);
 assert.equal(agenda.postgameChecklist(observation(t),{},plan).find(e=>e.id==='team-evolution').status,'complete');
});
