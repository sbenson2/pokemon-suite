import {createPostgameController,canYieldPostgame} from './postgame.js';
import {createPlannerClient} from './planner-client.js';
import {validLeagueTrainingOwner} from './league-exp-share.js';

// The existing supervised planner protocol owns all postgame mutations. The
// session reads acknowledged snapshots and remains the sole cartridge writer.
export function createPostgameClient(options){
 const initial=createPostgameController(options);
 const client=createPlannerClient({kind:'postgame',module:new URL('./postgame.js',import.meta.url).href,options,
  resumingCommands:['beginAdventure','beginAcquisition','beginPlayerTask','beginQmmSupply','beginEvolution','resumeVerifiedCapture','acceptEvolutionRoundTrip','deferPartnerEvolution'],
  snapshot:{state:initial.state(),storyWatch:initial.storyWatch()}});
 const commands=['setPartnerAvailability','beginAdventure','rejectHunt','beginAcquisition','acknowledgeAcquisition','beginPlayerTask','beginQmmSupply','preserveEvolutionSource','beginEvolution','prepareAcquisition','resumeVerifiedCapture','requestHandoff','acknowledgeEvolution','acceptEvolutionRoundTrip','acknowledgeDexEvolution','deferPartnerEvolution','recordHunt','completeHunt'];
 let availabilityKey=null;
 return {...client,...Object.fromEntries(commands.map(name=>[name,(...args)=>client.command(name,...args)])),
  publishPartnerAvailability(value){
   // Legacy `true` is the Emerald companion; a document lists ready partner owners.
   const available=value===true?true:value?.available===true&&Array.isArray(value.partners)?{available:true,partners:value.partners.map(p=>({owner:p?.owner,title:p?.title}))}:false;
   const key=JSON.stringify([available,client.metrics().restarts]);
   if(key===availabilityKey)return;
   availabilityKey=key;
   // The host command loop must remain available to pause a slow planner.
   // Republish after worker replacement, whose ephemeral availability is false.
   void client.command('setPartnerAvailability',available).catch(()=>{if(availabilityKey===key)availabilityKey=null;});
  },
  // A planner restart relaunches from these options, so the pushed setting stays.
  async setLeagueTraining(value){if(!validLeagueTrainingOwner(value))throw Error('Invalid League training setting.');options.leagueTraining=value;return client.command('setLeagueTraining',value);},
  canYield:o=>canYieldPostgame(client.state(),o)};
}
