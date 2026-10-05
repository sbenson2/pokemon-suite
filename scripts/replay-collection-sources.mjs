import assert from 'node:assert/strict';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {readPostgameEvidence,resolvePostgameObjective,postgameChecklist} from '../engine/firered/src/suite/postgame-agenda.js';
import {nationalDexSources,nationalCollectionSummary,FIRERED_CATCHABLE} from '../engine/firered/src/suite/national-dex-agenda.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {nationalSpeciesId} from '../engine/firered/src/evidence/gen3-national-species.js';

// The owner's goal (September 28): every species FireRed itself can register.
// From the preserved live checkpoint (Lavender Pokémon Center 2F, 162 of those
// 189 registered), the real knowledge pack and the native observation must
// agree with the pinned goal list, count what this save can still do alone,
// and resolve each new National Dex route to its real first step: the Lax
// Incense before Wynaut's Egg, the Good Rod before Krabby, a plain Poliwhirl
// spare for the Cerulean trade, and the shiny-only Eevee and Omanyte bred
// before they evolve. Ruin Valley's Sun Stone and Sevault Canyon's King's Rock
// sit behind Strength boulders, so neither is an ordinary supply
// (gate-verification-124-01 stopped at Six Island's harbor chasing the Sun
// Stone). Since build 126 Bellossom takes the reviewed Ruin Valley boulder
// route (ruin-valley-route.js; executed by postgame-bellossom-sun-stone).
// Politoed is not started without a ready FireRed partner. Selection only; the
// fishing, breeding and stone cases execute.
export async function replayCollectionSources({session,saved,inputs}){
 const retained=structuredClone(saved.metadata.session.postgame),clock=Date.parse(saved.updatedAt);
 const controller=createPostgameController({...inputs,mechanics:inputs.battle,state:structuredClone(retained),clock:()=>clock});
 const observer=createFireRedObserver({session,...inputs,runId:'collection-sources',storyWatch:controller.storyWatch()});
 const raw=observer.capture(),o={...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};
 assert.equal(o.phase,'stable');
 // The knowledge pack's FireRed wild tables (outside the Altering Cave event
 // tables) are all inside the pinned goal.
 const goal=new Set(FIRERED_CATCHABLE),species=new Map(inputs.battle.data.species.map(s=>[s.name,s.id]));
 for(const table of inputs.world.data.wildEncounters)if(table.base_label?.endsWith('_FireRed')&&!/AlteringCave_\d+_FireRed$/.test(table.base_label))
  for(const key of ['land_mons','water_mons','fishing_mons','rock_smash_mons'])for(const slot of table[key]?.mons??[])
   assert.ok(goal.has(nationalSpeciesId(species.get(slot.species))),`${slot.species} on ${table.map} is in the FireRed goal`);
 const rows=nationalDexSources({o,world:inputs.world,mechanics:inputs.battle}),summary=nationalCollectionSummary(rows);
 assert.deepEqual(summary.fireRed,{total:189,owned:162,reachable:14,planned:13,partner:2,complete:false});
 assert.deepEqual(summary.localSpecies,[98,99,108,124,134,135,136,139,182,186,211,212,238,360]);
 assert.deepEqual(summary.plannedSpecies,[4,5,6,7,8,9,107,140,141,236,237,243,245]);
 assert.equal(summary.categories['other-games'],196);
 const castform=rows.find(r=>r.speciesId===351);assert.equal(castform.status,'complete','the registered Castform (#351) counts as itself');
 assert.equal(rows.find(r=>r.speciesId===325).status,'external','Spoink (#325) is not registered');
 const entry=postgameChecklist(o,retained.agenda.workflows,null,rows).find(e=>e.id==='national-collection');
 assert.equal(entry.label,'Catch every FireRed Pokémon (162 of 189)');assert.equal(entry.status,'pending');
 // Each route's first step, with the others deferred through ordinary retry records.
 const planner=createCampaignPlanner({campaign:{objectives:[]},...inputs,mechanics:inputs.battle});
 const context={mechanics:inputs.battle,planner,teamPlan:retained.fieldTeamPlan,protectedFingerprints:[],now:clock};
 const resolve=keep=>{
  const workflows=structuredClone(retained.agenda.workflows),failed=(workflows.dex??={}).failed??={};
  for(const id of [182,98,211,360,124,108,133,138,186,212].filter(id=>!keep.includes(id)))failed[id]={reason:'isolated',attempts:1,retryAt:clock+86400000};
  return resolvePostgameObjective('national-collection',o,inputs.world,workflows,context);
 };
 assert.equal(planner.selectItemPreparation(o,93),null,'the Sun Stone behind Ruin Valley’s Strength boulders is not a verified supply');
 assert.equal(planner.selectItemPreparation(o,187),null,'nor is the King’s Rock behind Sevault Canyon’s boulders');
 assert.equal(planner.selectItemPreparation(o,199)?.target.map,'MAP_FIVE_ISLAND_MEMORIAL_PILLAR','the Metal Coat is reachable across the ferry');
 const bellossom=resolve([182]);
 assert.deepEqual([bellossom.target.kind,bellossom.target.map],['map-arrival','MAP_SIX_ISLAND_RUIN_VALLEY'],'Bellossom starts the reviewed Ruin Valley boulder route for the Sun Stone');
 const krabby=resolve([98]);
 assert.deepEqual([krabby.target.kind,krabby.request.speciesId,krabby.route.rodItemId],['postgame-hunt',98,263]);
 const wynaut=resolve([360]);
 assert.equal(wynaut.acquisition?.kind,'breeding');assert.equal(wynaut.acquisition.speciesId,360);assert.equal(wynaut.acquisition.itemId,221,'Wynaut needs the Lax Incense');
 const jynx=resolve([124]);
 assert.equal(jynx.target.kind,'postgame-hunt');assert.equal(jynx.request.speciesId,61,'a plain Poliwhirl spare for the Cerulean trade');
 const eevee=resolve([133]);
 assert.equal(eevee.acquisition?.kind,'breeding');assert.equal(eevee.acquisition.speciesId,133);assert.ok(eevee.acquisition.protectedParent,'the shiny Eevee is the protected parent');
 const omanyte=resolve([138]);
 assert.equal(omanyte.acquisition?.speciesId,138);assert.equal(omanyte.acquisition.evolutionTarget,139);
 const finished=resolve([]);
 assert.equal(finished.target.kind,'stop-for-review','with every route deferred the collection is cooling down, not finished');
 console.log('# collection-sources verified '+JSON.stringify({fireRed:summary.fireRed,routes:{bellossom:bellossom.id,krabby:krabby.id,wynaut:wynaut.id,jynx:jynx.id,eevee:eevee.id,omanyte:omanyte.id}}));
 return {before:o,after:observer.capture()};
}
