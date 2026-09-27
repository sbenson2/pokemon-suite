import { pokemonIdentity } from "../evidence/pokemon-record.js";

export const FIRE_RED_RNG_METHOD = "bpre-rev1-land-generation-boundary-v1";
export const FIRE_RED_SOURCE_REVISION = "c75f352304d529f6ba92d4f74b9cf8b5c3810788";
const LAND_THRESHOLDS = [20, 40, 50, 60, 70, 80, 85, 90, 94, 98, 99, 100];
function uint32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new TypeError("RNG state must be uint32");
  return value;
}
// Math.imul implements the cartridge's modulo-2^32 multiply exactly. Ordinary
// Number multiplication loses low bits for many valid 32-bit seeds.
export const nextMainRng = (state) => (Math.imul(uint32(state), 0x41c64e6d) + 0x6073) >>> 0;
export const nextWildRng = (state) => (Math.imul(uint32(state), 0x41c64e6d) + 0x3039) >>> 0;

// Affine exponentiation advances the calculation, never the emulator or RAM.
export function advanceMainRng(state, advances){
 uint32(state);searchBudget(advances,Number.MAX_SAFE_INTEGER);
 let multiplier=0x41c64e6d,increment=0x6073;
 while(advances){
  if(advances%2)state=(Math.imul(state,multiplier)+increment)>>>0;
  increment=Math.imul(increment,(multiplier+1)>>>0)>>>0;
  multiplier=Math.imul(multiplier,multiplier)>>>0;advances=Math.floor(advances/2);
 }
 return state;
}

export function findLandDelays({state,otId,slots,pokemon,maxAdvances=2000}){
 uint32(state);searchBudget(maxAdvances,10000);const matches=[];
 for(let delay=0;delay<maxAdvances;delay++,state=nextMainRng(state)){
  const result=predictLandGeneration({state,otId,slots});
  if(result.pokemon?.species===pokemon.species&&result.pokemon?.personality===pokemon.personality&&result.pokemon?.level===pokemon.level)matches.push(delay);
 }
 return matches;
}

export function rankRngMethods(candidates){
 return candidates.map(candidate=>{
  const {setupFrames=0,waitFrames=0,calibrationFrames=0,preparationFrames=0,captureFrames=0,hitProbability=1,catchProbability=1}=candidate;
  if(![setupFrames,waitFrames,calibrationFrames,preparationFrames,captureFrames].every(n=>Number.isFinite(n)&&n>=0)||![hitProbability,catchProbability].every(n=>Number.isFinite(n)&&n>0&&n<=1))throw new TypeError('Invalid RNG method cost');
  return {...candidate,expectedFrames:calibrationFrames+preparationFrames+(setupFrames+waitFrames+captureFrames)/(hitProbability*catchProbability)};
 }).filter(c=>c.qualified===true).sort((a,b)=>a.expectedFrames-b.expectedFrames);
}

export function rngWaitFrames({remaining,callsPerFrame,reserve=0,maxFrames=600}){
 if(![remaining,reserve,maxFrames].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isSafeInteger(callsPerFrame)||callsPerFrame<1)throw new TypeError('Invalid RNG wait timing');
 return Math.min(maxFrames,Math.max(0,Math.floor((remaining-reserve)/callsPerFrame)));
}

// FireRed CreateBoxMon / Random32 for scripted static encounters. This predicts
// a generation boundary; the controller must calibrate the delay to that boundary.
export function predictStaticGeneration({state,otId}) {
  uint32(otId);
  const low=nextMainRng(state),high=nextMainRng(low);
  const first=nextMainRng(high),second=nextMainRng(first),a=first>>>16,b=second>>>16;
  return {...pokemonIdentity(((low>>>16)|(high&0xffff0000))>>>0,otId),ivs:{hp:a&31,attack:(a>>>5)&31,defense:(a>>>10)&31,speed:b&31,spAttack:(b>>>5)&31,spDefense:(b>>>10)&31}};
}
function searchBudget(value,maximum=1000000){
  if(!Number.isSafeInteger(value)||value<0||value>maximum)throw new TypeError('Invalid static RNG search budget');
  return value;
}
export function mainRngDistance(from,to,maxAdvances=10000){
  uint32(from);uint32(to);searchBudget(maxAdvances);
  for(let i=0;i<=maxAdvances;i++,from=nextMainRng(from))if(from===to)return i;
  return null;
}
export function findStaticDelay({state,personality,maxAdvances=10000}){
  uint32(state);uint32(personality);searchBudget(maxAdvances);
  for(let i=0;i<maxAdvances;i++,state=nextMainRng(state))
    if(predictStaticGeneration({state,otId:0}).personality===personality)return i;
  return null;
}
export function planStaticShiny({state,otId,delay,maxAdvances=100000,matches=()=>true}){
  uint32(state);uint32(otId);searchBudget(delay,10000);searchBudget(maxAdvances);
  let generationState=state;
  for(let i=0;i<delay;i++)generationState=nextMainRng(generationState);
  let fallback=null;
  for(let advances=0;advances<maxAdvances;advances++,state=nextMainRng(state),generationState=nextMainRng(generationState)){
    const pokemon=predictStaticGeneration({state:generationState,otId});
    if(pokemon.shiny){
     const result={advances,confirmationState:state,generationState,pokemon,traitsMatched:matches(pokemon)};
     if(result.traitsMatched)return result;
     fallback??=result;
    }
  }
  return fallback;
}

export function predictLandGeneration({ state, otId, slots, maxNatureAttempts = 1024, ivGap = "none" } = {}) {
  uint32(state); uint32(otId);
  if (!Array.isArray(slots) || slots.length !== 12 || slots.some((slot) =>
    !Number.isInteger(slot.species) || slot.species < 1 || slot.species > 411 ||
    ![slot.minLevel, slot.maxLevel].every((level) => Number.isInteger(level) && level >= 1 && level <= 100))) {
    throw new TypeError("land generation needs twelve source-backed species/level slots");
  }
  if (!Number.isInteger(maxNatureAttempts) || maxNatureAttempts < 1 || maxNatureAttempts > 4096) throw new TypeError("invalid nature rejection budget");
  if (!["none", "between-ivs"].includes(ivGap)) throw new TypeError("unsupported conditional IV interruption");
  const initialState = state;
  let calls = 0;
  const draw = () => { calls++; state = nextMainRng(state); return state >>> 16; };
  const slotRoll = draw() % 100;
  const slot = LAND_THRESHOLDS.findIndex((threshold) => slotRoll < threshold);
  const species = slots[slot].species;
  const low = Math.min(slots[slot].minLevel, slots[slot].maxLevel);
  const high = Math.max(slots[slot].minLevel, slots[slot].maxLevel);
  const level = low + draw() % (high - low + 1);
  if (species === 201) return { validity: "unknown", reason: "unown-method-unsupported", initialState, calls };
  const nature = draw() % 25;
  let personality = null;
  for (let attempt = 0; attempt < maxNatureAttempts; attempt++) {
    const lo = draw();
    const candidate = (lo | (draw() << 16)) >>> 0;
    if (candidate % 25 === nature) { personality = candidate; break; }
  }
  if (personality === null) return { validity: "unknown", reason: "nature-rejection-budget", initialState, calls };
  const first = draw();
  // VBlankIntr also consumes Random(). A pinned-core replay crossed VBlank
  // between the two IV words. This variant models that one observed extra call;
  // selecting which variant a future frame will use remains unqualified.
  if (ivGap === "between-ivs") draw();
  const second = draw();
  return { validity: "conditional", method: FIRE_RED_RNG_METHOD, ivGap, initialState, nextState: state, calls, slot,
    condition: `at-land-slot-generation; IV gap ${ivGap}; no other intervening calls or rejected repel/roamer path`,
    pokemon: { species, level, ...pokemonIdentity(personality, otId),
      ivs: { hp: first & 31, attack: (first >>> 5) & 31, defense: (first >>> 10) & 31,
        speed: second & 31, spAttack: (second >>> 5) & 31, spDefense: (second >>> 10) & 31 } } };
}

// The ordinary land method does not model Unown's personality generation.
// Callers must use native encounter handling for that species.
export function supportsFireRedLandRngMethod(speciesId) {
  return Number.isInteger(speciesId) && speciesId >= 1 && speciesId <= 411 && speciesId !== 201;
}

export function landSpeciesProbability(slots,speciesId){
 if(!Array.isArray(slots)||slots.length!==12)throw new TypeError('Land probability requires twelve game-specific slots');
 return slots.reduce((sum,slot,i)=>sum+(slot.species===speciesId?LAND_THRESHOLDS[i]-(LAND_THRESHOLDS[i-1]??0):0),0)/100;
}

export async function searchLandCandidates({ state, otId, slots, maxAdvances = 1024, batchSize = 64,
  matches = () => true, signal, ivGaps = ["none"], yieldTask = () => new Promise((resolve) => setImmediate(resolve)) } = {}) {
  uint32(state);
  if (!Number.isSafeInteger(maxAdvances) || maxAdvances < 1 || maxAdvances > 1000000 ||
      !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new TypeError("invalid RNG search budget");
  if (!Array.isArray(ivGaps) || !ivGaps.length || ivGaps.length > 2 || new Set(ivGaps).size !== ivGaps.length ||
      ivGaps.some((gap) => !["none", "between-ivs"].includes(gap))) throw new TypeError("unsupported search IV variants");
  let searched = 0;
  for (; searched < maxAdvances; searched++, state = nextMainRng(state)) {
    if (signal?.aborted) return { status: "cancelled", searched };
    for (const ivGap of ivGaps) {
      const candidate = predictLandGeneration({ state, otId, slots, ivGap });
      if (candidate.validity === "conditional" && matches(candidate.pokemon,{advances:searched,ivGap})) {
        return { status: "candidate", searched: searched + 1, advances: searched, candidate };
      }
    }
    if ((searched + 1) % batchSize === 0) await yieldTask();
  }
  return { status: "exhausted", searched };
}
// Native field/dialog callbacks may consume several RNG calls per frame.
// Approach the confirmation seed conservatively and resample after each wait.
export const generationWaitFrames=distance=>Math.max(1,Math.min(600,Math.floor(distance/16)));
