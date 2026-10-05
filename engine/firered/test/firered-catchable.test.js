import test from 'node:test';
import assert from 'node:assert/strict';
import catchable from '../src/suite/firered-catchable.json' with {type:'json'};
import {FIRERED_CATCHABLE} from '../src/suite/national-dex-agenda.js';

// The owner's goal (September 28): "catch all the Pokémon" means every species
// a FireRed player can register without another game or an event. The list is
// derived from pret/pokefirered c75f3523 by scripts/derive-firered-catchable.py
// (wild FireRed tables except Altering Cave tables 2-9, the cartridge's gifts,
// statics, fossils, starters, roamers and FireRed in-game trades, then every
// evolution and Egg FireRed itself can make). Pinned here exactly.
const expand=ranges=>ranges.flatMap(r=>Array.isArray(r)?Array.from({length:r[1]-r[0]+1},(_,i)=>r[0]+i):[r]);
const PINNED=expand([[1,26],[29,36],[39,68],[72,78],[81,119],[122,125],[128,150],[161,162],[165,169],[172,178],182,[186,189],[193,195],198,
 [201,202],206,208,[211,212],214,[218,221],225,227,[230,233],[236,239],[242,248],360]);

test('the FireRed goal is exactly the 189 species FireRed can register by itself',()=>{
 assert.equal(catchable.schema,'pokemon-suite/firered-catchable/v1');
 assert.equal(catchable.source.commit,'c75f352304d529f6ba92d4f74b9cf8b5c3810788');
 assert.equal(catchable.total,189);assert.equal(PINNED.length,189);
 assert.deepEqual(catchable.species.map(x=>x.id),PINNED);
 assert.deepEqual([...FIRERED_CATCHABLE],PINNED);
});

test('the goal keeps one-per-save choices and FireRed-made evolutions, and leaves out other games and events',()=>{
 const byId=new Map(catchable.species.map(x=>[x.id,x]));
 for(const [id,kind] of [[1,'starter'],[4,'starter'],[7,'starter'],[138,'fossil'],[140,'fossil'],[243,'roamer'],[244,'roamer'],[245,'roamer'],[106,'dojo'],[107,'dojo']])
  assert.deepEqual(byId.get(id)?.onePerSave,[kind],`${id} is a one-per-save ${kind}`);
 // Item evolutions with cartridge items: Sun Stone (Ruin Valley), King's Rock
 // (Sevault Canyon), Metal Coat (Memorial Pillar), Dragon Scale (Water Path), Up-Grade (Rocket Warehouse).
 for(const id of [182,186,208,212,230,233,134,135,136])assert.ok(byId.get(id)?.via.includes('evolution'),`${id} evolves in FireRed`);
 // In-game trades (src/data/ingame_trades.h FIRERED) and the Eggs they make possible.
 for(const id of [108,124,122,83])assert.ok(byId.get(id)?.via.includes('trade'),`${id} is a FireRed in-game trade`);
 for(const id of [238,239,236,172,173,174,360])assert.ok(byId.get(id)?.via.includes('breeding'),`${id} hatches in FireRed`);
 // Outside the goal: LeafGreen exclusives, Altering Cave event tables, day/night
 // friendship (compiled out in src/pokemon.c), tickets, Mew/Celebi/Jirachi, other regions.
 for(const id of [27,37,69,79,120,126,127,179,190,204,196,197,199,240,249,250,151,251,385,386,252,298,183,351])
  assert.ok(!byId.has(id),`${id} is outside the FireRed goal`);
});
