import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {battleDecisionState,battleKoRace,estimatedTrainerParty,estimatedTrainerPokemon,planBattleCounters,
  raceIsComfortable,remainingBattleOpponents} from '../src/player/battle-model.js';
import {selectMajorBattleLead,upcomingMajorTrainer} from '../src/player/battle-foresight.js';

const fixture=JSON.parse(readFileSync(new URL('../test-support/champion-rematch-tactics.json',import.meta.url)));
const {mechanics}=fixture;
const observed=label=>structuredClone(fixture.observations.find(x=>x.label===label).observation);
const state=o=>battleDecisionState(o.playerMemory,o.playerMemory.ui);
const activeOf=o=>{const b=state(o);return {...(o.playerMemory.trainer.party.find(p=>p.slot===b.playerPartySlot)??{}),...b.player};};

test('a KO race uses the minimum roll times accuracy against the maximum credible reply',()=>{
  const o=observed('charizard-golduck-turn11');const b=state(o);
  const race=battleKoRace({mechanics,member:activeOf(o),opponent:b.opponent,weather:b.weather});
  // Hydro Pump is spent: Strength needs three conservative turns, Charizard's
  // Earthquake is its best reply, and Golduck moves first.
  assert.equal(race.wins,true);assert.equal(race.movesFirst,true);
  assert.equal(race.turnsToKo,3);assert.equal(race.moveId,70);assert.equal(race.incoming,59);
  const entry=battleKoRace({mechanics,member:activeOf(o),opponent:b.opponent,weather:b.weather,entry:true});
  assert.ok(entry.remainingHp<race.remainingHp,'a switch-in pays one free hit first');
  assert.equal(entry.entry,true);
});

test('a certain first-turn knockout is comfortable at any remaining HP',()=>{
  const o=observed('tyranitar-machamp-turn1');const b=state(o);
  const race=battleKoRace({mechanics,member:{...activeOf(o),hp:1},opponent:b.opponent,weather:b.weather});
  assert.equal(race.wins,true);assert.equal(race.certain,true);assert.equal(race.margin,0);
  assert.equal(raceIsComfortable(race),true);
  const slow=battleKoRace({mechanics,member:{...activeOf(o),hp:1,stats:{...activeOf(o).stats,speed:1}},opponent:b.opponent,weather:b.weather});
  assert.equal(slow.wins,false);assert.equal(slow.faintsBeforeActing,true,'a slower member faints before acting');
});

test('unknown speed assumes the opponent acts first and unknown damage is not guessed',()=>{
  const o=observed('charizard-golduck-turn11');const b=state(o);
  const unknownSpeed=battleKoRace({mechanics,member:{...activeOf(o),stats:{...activeOf(o).stats,speed:0}},opponent:b.opponent,weather:b.weather});
  assert.equal(unknownSpeed.movesFirst,false);
  assert.equal(battleKoRace({mechanics,member:activeOf(o),opponent:{...b.opponent,moves:undefined}}),null);
  assert.equal(battleKoRace({mechanics,member:{...activeOf(o),status1:32},opponent:b.opponent}),null,'a frozen member thaws at random');
  assert.equal(battleKoRace({mechanics,member:activeOf(o),opponent:{...b.opponent,item:65535}}),null,'an unknown held item');
});

test('Counter is bounded by the member own physical hit instead of making the race unknown',()=>{
  const o=observed('tyranitar-machamp-turn1');const b=state(o);
  const heracross=estimatedTrainerPokemon(mechanics,mechanics.trainers[741].party[0],0);
  assert.equal(heracross.species,214);assert.ok(heracross.moves.includes(68),'Heracross knows Counter');
  const fearow=o.playerMemory.trainer.party.find(p=>p.species===22);
  const race=battleKoRace({mechanics,member:fearow,opponent:heracross,weather:b.weather});
  assert.equal(race.wins,true);assert.equal(race.turnsToKo,1);
});

test('static trainer parties estimate Gen III stats from IVs, level and base stats',()=>{
  const lorelei=estimatedTrainerParty(mechanics,735);
  assert.equal(lorelei.length,5);
  const dewgong=lorelei[0];
  // iv 255 is 31 in every stat: HP floor((2*90+31)*64/100)+64+10.
  assert.equal(dewgong.level,64);assert.equal(dewgong.maxHp,Math.floor((2*90+31)*64/100)+74);
  assert.equal(dewgong.stats.speed,Math.floor((2*70+31)*64/100)+5);
  assert.deepEqual(dewgong.moves.length,4);assert.equal(dewgong.heldItem,0);
  const charizard=estimatedTrainerParty(mechanics,741)[5];
  assert.equal(charizard.heldItem,142,'Sitrus Berry resolves through the item catalog');
});

test('remaining opponents come from the live enemy party, never the current or fainted members',()=>{
  const b=state(observed('tyranitar-machamp-turn1'));
  assert.deepEqual(remainingBattleOpponents({mechanics,battle:b}).map(p=>p.species),[65,103,130,6]);
  const staticOnly={...b,enemyParty:[]};
  assert.deepEqual(remainingBattleOpponents({mechanics,battle:staticOnly}).map(p=>p.species),[103,130,6],
    'static data only assumes the unseen members after the current one');
});

test('counter planning prefers comfortable unreserved winners and never depends on slot order',()=>{
  const o=observed('gyarados-fearow-turn8');const b=state(o);const party=o.playerMemory.trainer.party;
  const alive=party.filter(p=>![22,55].includes(p.species)).map(p=>p.species===68?{...p,hp:250}:p);
  const plan=planBattleCounters({mechanics,members:alive,opponent:b.opponent,
    remaining:remainingBattleOpponents({mechanics,battle:b}),weather:b.weather});
  assert.equal(plan.reserved.get(2)?.species,6,'Dragonite is the only answer to Charizard');
  assert.equal(plan.ranked[0].member.species,68);
  const shuffled=planBattleCounters({mechanics,members:[...alive].reverse().map((p,slot)=>({...p,slot:(p.slot+3)%6})),
    opponent:b.opponent,remaining:remainingBattleOpponents({mechanics,battle:b}),weather:b.weather});
  assert.equal(shuffled.ranked[0].member.species,68);
});

test('League foresight resolves room, rematch flag and the shared Champion first Pokemon',()=>{
  const o=observed('lorelei-room-after-battle');
  const lorelei={id:'x',importantBattle:true,target:{kind:'object',map:'MAP_POKEMON_LEAGUE_LORELEIS_ROOM',index:0}};
  assert.deepEqual(upcomingMajorTrainer({mechanics,observation:o,objective:lorelei}).trainerNames,['TRAINER_ELITE_FOUR_LORELEI_2']);
  o.playerMemory.storyState.flagIds[2116]=false;
  assert.deepEqual(upcomingMajorTrainer({mechanics,observation:o,objective:lorelei}).trainerNames,['TRAINER_ELITE_FOUR_LORELEI']);
  o.playerMemory.storyState.flagIds[2116]=true;o.playerMemory.map.id='MAP_POKEMON_LEAGUE_LANCES_ROOM';
  const champion={id:'y',importantBattle:true,target:{kind:'map-arrival',map:'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM',x:6,y:18}};
  const upcoming=upcomingMajorTrainer({mechanics,observation:o,objective:champion});
  assert.equal(upcoming.first.species,214);assert.equal(upcoming.trainerNames.length,3);
  assert.deepEqual(upcoming.remaining,[],'the starter variants disagree after Heracross');
  assert.equal(upcomingMajorTrainer({mechanics,observation:o,objective:{...champion,importantBattle:false}}),null);
  assert.equal(selectMajorBattleLead({mechanics,observation:o,objective:champion,party:o.playerMemory.trainer.party}).member,
    null,'Fearow already beats Heracross');
});
