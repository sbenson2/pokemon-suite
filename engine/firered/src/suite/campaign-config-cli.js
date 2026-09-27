#!/usr/bin/env node
import { loadSuiteCampaignContext } from "./campaign-context.js";
import { DEFAULT_RUN_SETTINGS, createCampaignRun, presentCampaignRun } from "./campaign-run.js";

try {
  let input="";for await (const chunk of process.stdin) { input+=chunk; if(input.length>16384)throw new Error("Run settings are too large."); }
  const request=JSON.parse(input);
  if(request.game!=="firered"||!["options","preview"].includes(request.action))throw new Error("Fresh campaign automation is currently available for FireRed.");
  const {rosterContext,facts,romSha1}=loadSuiteCampaignContext(process.argv[2]);
  const name=id=>facts.species[id]?.name?.replace(/^SPECIES_/,"").replaceAll("_"," ")??String(id);
  if(request.action==="options") {
    process.stdout.write(JSON.stringify({supported:true,defaults:DEFAULT_RUN_SETTINGS,
      starters:[1,4,7].map(species=>({species,name:name(species),id:({1:"bulbasaur",4:"charmander",7:"squirtle"})[species],sprite:`./assets/pokedex/firered/${species}.png`})),
      pool:rosterContext.candidates.map(c=>({id:c.id,species:c.captureSpecies,targetSpecies:c.targetSpecies,name:name(c.targetSpecies),family:c.family,afterObjectiveId:c.afterObjectiveId,method:c.steps[0]?.kind})),
      poolScope:"Verified FireRed story acquisitions before the first Hall of Fame. External trades and postgame-only Pokémon are excluded.",
      modes:[{id:"random",name:"Random Adventure"},{id:"balanced",name:"Balanced Adventure"}]}));
  } else {
    const record=createCampaignRun({settings:request.settings,rosterContext,romSha1});
    const preview=presentCampaignRun(record);
    preview.team=preview.team.map(p=>({...p,name:name(p.species),targetName:name(p.targetSpecies)}));
    preview.helpers=preview.helpers.map(p=>({...p,name:name(p.species)}));
    process.stdout.write(JSON.stringify({record,preview}));
  }
}catch(error){process.stderr.write(error.message+"\n");process.exitCode=1;}
