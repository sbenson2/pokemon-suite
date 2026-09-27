// Campaign objectives for Pokémon Emerald, each proven by cartridge flags/vars
// and planned as one concrete field intent. Evidence: data/maps/*/scripts.inc,
// data/scripts/players_house.inc, data/maps/*/map.json at pokeemerald 5eff786.
import {inLeague,leaguePpStock,leagueRecovery} from './league.mjs';
const MAPS = Object.freeze({
  truck: 'MAP_INSIDE_OF_TRUCK',
  littleroot: 'MAP_LITTLEROOT_TOWN',
  brendan1F: 'MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_1F',
  brendan2F: 'MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_2F',
  may1F: 'MAP_LITTLEROOT_TOWN_MAYS_HOUSE_1F',
  may2F: 'MAP_LITTLEROOT_TOWN_MAYS_HOUSE_2F',
  lab: 'MAP_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB',
  route101: 'MAP_ROUTE101',
  oldale: 'MAP_OLDALE_TOWN',
  route103: 'MAP_ROUTE103',
  route102: 'MAP_ROUTE102',
  petalburg: 'MAP_PETALBURG_CITY',
  petalburgGym: 'MAP_PETALBURG_CITY_GYM',
  route104: 'MAP_ROUTE104',
  woods: 'MAP_PETALBURG_WOODS',
  rustboro: 'MAP_RUSTBORO_CITY',
  rustboroGym: 'MAP_RUSTBORO_CITY_GYM',
  route116: 'MAP_ROUTE116',
  rusturf: 'MAP_RUSTURF_TUNNEL',
  devon3F: 'MAP_RUSTBORO_CITY_DEVON_CORP_3F',
  brineyHouse: 'MAP_ROUTE104_MR_BRINEYS_HOUSE',
  dewford: 'MAP_DEWFORD_TOWN',
  dewfordGym: 'MAP_DEWFORD_TOWN_GYM',
  dewfordCenter: 'MAP_DEWFORD_TOWN_POKEMON_CENTER_1F',
  route106: 'MAP_ROUTE106',
  stevensRoom: 'MAP_GRANITE_CAVE_STEVENS_ROOM',
  route109: 'MAP_ROUTE109',
  slateport: 'MAP_SLATEPORT_CITY',
  oldaleCenter: 'MAP_OLDALE_TOWN_POKEMON_CENTER_1F',
  petalburgCenter: 'MAP_PETALBURG_CITY_POKEMON_CENTER_1F',
  rustboroCenter: 'MAP_RUSTBORO_CITY_POKEMON_CENTER_1F',
  slateportMart: 'MAP_SLATEPORT_CITY_MART',
  slateportCenter: 'MAP_SLATEPORT_CITY_POKEMON_CENTER_1F',
  shipyard: 'MAP_SLATEPORT_CITY_STERNS_SHIPYARD_1F',
  museum1F: 'MAP_SLATEPORT_CITY_OCEANIC_MUSEUM_1F',
  museum2F: 'MAP_SLATEPORT_CITY_OCEANIC_MUSEUM_2F',
  route110: 'MAP_ROUTE110',
  mauville: 'MAP_MAUVILLE_CITY',
  mauvilleGym: 'MAP_MAUVILLE_CITY_GYM',
  mauvilleHouse1: 'MAP_MAUVILLE_CITY_HOUSE1',
  mauvilleCenter: 'MAP_MAUVILLE_CITY_POKEMON_CENTER_1F',
  mauvilleMart: 'MAP_MAUVILLE_CITY_MART',
});

/** Pokémon Center nurses stand at (7,2) behind the counter; the player talks from (7,4) facing up. */
const HEAL_SPOTS = Object.freeze([
  Object.freeze({ id: 'mom', kind: 'mom', near: ['MAP_LITTLEROOT_TOWN', 'MAP_ROUTE101', 'MAP_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB', 'MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_1F', 'MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_2F', 'MAP_LITTLEROOT_TOWN_MAYS_HOUSE_1F', 'MAP_LITTLEROOT_TOWN_MAYS_HOUSE_2F'] }),
  Object.freeze({ id: 'oldale-center', kind: 'nurse', map: MAPS.oldaleCenter, near: ['MAP_OLDALE_TOWN', 'MAP_ROUTE102', 'MAP_ROUTE103', 'MAP_OLDALE_TOWN_POKEMON_CENTER_1F', 'MAP_OLDALE_TOWN_MART'] }),
  Object.freeze({ id: 'petalburg-center', kind: 'nurse', map: MAPS.petalburgCenter, near: ['MAP_PETALBURG_CITY', 'MAP_ROUTE104', 'MAP_PETALBURG_WOODS', 'MAP_PETALBURG_CITY_GYM', 'MAP_PETALBURG_CITY_POKEMON_CENTER_1F', 'MAP_PETALBURG_CITY_MART', 'MAP_PETALBURG_CITY_WALLYS_HOUSE'] }),
  Object.freeze({ id: 'rustboro-center', kind: 'nurse', map: MAPS.rustboroCenter, near: ['MAP_RUSTBORO_CITY', 'MAP_ROUTE115', 'MAP_ROUTE116', 'MAP_RUSTURF_TUNNEL', 'MAP_RUSTBORO_CITY_GYM', 'MAP_RUSTBORO_CITY_POKEMON_CENTER_1F', 'MAP_RUSTBORO_CITY_MART', 'MAP_RUSTBORO_CITY_DEVON_CORP_1F'] }),
  Object.freeze({ id: 'dewford-center', kind: 'nurse', map: MAPS.dewfordCenter, near: ['MAP_DEWFORD_TOWN', 'MAP_DEWFORD_TOWN_GYM', 'MAP_DEWFORD_TOWN_HALL', 'MAP_DEWFORD_TOWN_POKEMON_CENTER_1F', 'MAP_ROUTE106', 'MAP_GRANITE_CAVE_1F', 'MAP_GRANITE_CAVE_B1F', 'MAP_GRANITE_CAVE_B2F', 'MAP_GRANITE_CAVE_STEVENS_ROOM'] }),
  Object.freeze({ id: 'slateport-center', kind: 'nurse', map: MAPS.slateportCenter, near: ['MAP_SLATEPORT_CITY', 'MAP_ROUTE109', 'MAP_ROUTE110', 'MAP_ROUTE134', 'MAP_SLATEPORT_CITY_POKEMON_CENTER_1F', 'MAP_SLATEPORT_CITY_MART', 'MAP_SLATEPORT_CITY_OCEANIC_MUSEUM_1F', 'MAP_SLATEPORT_CITY_OCEANIC_MUSEUM_2F', 'MAP_SLATEPORT_CITY_STERNS_SHIPYARD_1F'] }),
  Object.freeze({ id: 'mauville-center', kind: 'nurse', map: MAPS.mauvilleCenter, near: ['MAP_MAUVILLE_CITY', 'MAP_ROUTE111', 'MAP_ROUTE117', 'MAP_ROUTE118', 'MAP_MAUVILLE_CITY_GYM', 'MAP_MAUVILLE_CITY_POKEMON_CENTER_1F', 'MAP_MAUVILLE_CITY_MART', 'MAP_MAUVILLE_CITY_HOUSE1'] }),
  Object.freeze({id:'fallarbor-center',kind:'nurse',map:'MAP_FALLARBOR_TOWN_POKEMON_CENTER_1F',near:['MAP_FALLARBOR_TOWN','MAP_FALLARBOR_TOWN_POKEMON_CENTER_1F','MAP_ROUTE113','MAP_ROUTE114','MAP_METEOR_FALLS_1F_1R','MAP_FIERY_PATH']}),
  Object.freeze({id:'lavaridge-center',kind:'nurse',map:'MAP_LAVARIDGE_TOWN_POKEMON_CENTER_1F',near:['MAP_LAVARIDGE_TOWN','MAP_LAVARIDGE_TOWN_POKEMON_CENTER_1F','MAP_LAVARIDGE_TOWN_GYM_1F','MAP_LAVARIDGE_TOWN_GYM_B1F','MAP_ROUTE112','MAP_MT_CHIMNEY','MAP_JAGGED_PASS']}),
  Object.freeze({id:'fortree-center',kind:'nurse',map:'MAP_FORTREE_CITY_POKEMON_CENTER_1F',near:['MAP_FORTREE_CITY','MAP_FORTREE_CITY_GYM','MAP_FORTREE_CITY_POKEMON_CENTER_1F','MAP_ROUTE120']}),
  Object.freeze({id:'lilycove-center',kind:'nurse',map:'MAP_LILYCOVE_CITY_POKEMON_CENTER_1F',near:['MAP_LILYCOVE_CITY','MAP_LILYCOVE_CITY_POKEMON_CENTER_1F','MAP_ROUTE121','MAP_ROUTE122','MAP_ROUTE123','MAP_MT_PYRE_1F','MAP_MT_PYRE_EXTERIOR','MAP_MT_PYRE_SUMMIT','MAP_AQUA_HIDEOUT_1F','MAP_AQUA_HIDEOUT_B1F','MAP_AQUA_HIDEOUT_B2F']}),
  Object.freeze({id:'mossdeep-center',kind:'nurse',map:'MAP_MOSSDEEP_CITY_POKEMON_CENTER_1F',near:['MAP_MOSSDEEP_CITY','MAP_MOSSDEEP_CITY_GYM','MAP_MOSSDEEP_CITY_POKEMON_CENTER_1F','MAP_MOSSDEEP_CITY_SPACE_CENTER_1F','MAP_MOSSDEEP_CITY_SPACE_CENTER_2F','MAP_MOSSDEEP_CITY_STEVENS_HOUSE','MAP_ROUTE124','MAP_ROUTE125','MAP_ROUTE127']}),
  Object.freeze({id:'sootopolis-center',kind:'nurse',map:'MAP_SOOTOPOLIS_CITY_POKEMON_CENTER_1F',near:['MAP_SOOTOPOLIS_CITY','MAP_SOOTOPOLIS_CITY_GYM_1F','MAP_SOOTOPOLIS_CITY_GYM_B1F','MAP_SOOTOPOLIS_CITY_POKEMON_CENTER_1F','MAP_CAVE_OF_ORIGIN_1F','MAP_CAVE_OF_ORIGIN_B1F']}),

]);

/** Shopping targets by mart: buy in this order while money allows. */
const SHOPPING = Object.freeze({
  MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F:Object.freeze([{item:'ITEM_FULL_RESTORE',pocket:'items',target:15},{item:'ITEM_REVIVE',pocket:'items',target:10},{item:'ITEM_HYPER_POTION',pocket:'items',target:10}]),
  [MAPS.slateportMart]: Object.freeze([{ item: 'ITEM_POKE_BALL', pocket: 'pokeBalls', target: 10 }, { item: 'ITEM_POTION', pocket: 'items', target: 5 }]),
  [MAPS.mauvilleMart]: Object.freeze([{ item: 'ITEM_SUPER_POTION', pocket: 'items', target: 5 }, { item: 'ITEM_POKE_BALL', pocket: 'pokeBalls', target: 10 }]),
});

export function partyHealth(observation) {
  const usable = observation.party.filter(member => member.hasSpecies && !member.isEgg);
  const lead = usable[0] ?? null;
  const fainted = usable.filter(member => member.hp === 0).length;
  const leadFraction = lead && lead.maxHp ? lead.hp / lead.maxHp : 1;
  const attackPp = (member) => member.moves.filter(move => (move.power ?? 1) > 0).reduce((sum, move) => sum + move.pp, 0);
  const leadAttackPp = lead ? attackPp(lead) : 0;
  const primary=lead?.moves.filter(m=>m.power>0).reduce((best,m)=>{const score=m.power*(lead.types?.includes(m.type)?1.5:1);return !best||score>best.score?{score,pp:m.pp}:best;},null);
  const fullPp = usable.every(member => member.moves.every(move => move.pp > 0&&(move.maxPp==null||move.pp>=move.maxPp)));
  return Object.freeze({ usable: usable.length, fainted, leadFraction, leadAttackPp,leadPrimaryPp:primary?.pp??leadAttackPp, full: usable.length > 0 && usable.every(member => member.hp === member.maxHp&&!member.status) && fullPp });
}

const HOUSES = Object.freeze({
  MALE: Object.freeze({ own1F: MAPS.brendan1F, own2F: MAPS.brendan2F, rival1F: MAPS.may1F, rival2F: MAPS.may2F, seeRoom: { x: 8, y: 8 }, stairs1F: { x: 8, y: 2 }, clock: { x: 5, y: 1 }, stairs2F: { x: 7, y: 1 }, rivalDoor: { x: 14, y: 8 }, rivalStairs1F: { x: 2, y: 2 }, rivalBall: { x: 5, y: 4 }, rivalHouseVar: 'VAR_LITTLEROOT_HOUSES_STATE_BRENDAN', ownDoor: { x: 5, y: 8 } }),
  FEMALE: Object.freeze({ own1F: MAPS.may1F, own2F: MAPS.may2F, rival1F: MAPS.brendan1F, rival2F: MAPS.brendan2F, seeRoom: { x: 2, y: 8 }, stairs1F: { x: 2, y: 2 }, clock: { x: 3, y: 1 }, stairs2F: { x: 1, y: 1 }, rivalDoor: { x: 5, y: 8 }, rivalStairs1F: { x: 8, y: 2 }, rivalBall: { x: 3, y: 4 }, rivalHouseVar: 'VAR_LITTLEROOT_HOUSES_STATE_MAY', ownDoor: { x: 14, y: 8 } }),
});

const goto = (map, x, y, extra = {}) => Object.freeze({ kind: 'goto', map, x, y, ...extra });
const interact = (map, x, y, extra = {}) => Object.freeze({ kind: 'interact', map, x, y, ...extra });
const interactAt = (map, x, y, facing, extra = {}) => Object.freeze({ kind: 'interact-at', map, x, y, facing, ...extra });
const train = (map, untilLevel, extra = {}) => Object.freeze({ kind: 'train', map, untilLevel, ...extra });
const wait = (reason) => Object.freeze({ kind: 'wait', reason });

export function createStory({ constants, tables = null, teamPlan = null }) {
  const house = (observation) => HOUSES[observation.player?.gender ?? 'MALE'];
  const at = (observation, map) => observation.player?.map.id === map;
  const speciesId = (name) => constants.species[`SPECIES_${name}`] ?? null;
  const partyHas = (observation, names) => observation.party.some(member => names.some(name => speciesId(name) === member.species));
  /** Readiness = highest level in the boss roster(s) + margin, from the cartridge trainer tables. */
  const readinessFor = (symbols, margin = 3, fallback = 20) => {
    if (!tables) return fallback;
    let best = 0;
    for (const symbol of symbols) {
      const id = constants.trainers[symbol];
      if (id === undefined) continue;
      for (const member of tables.trainer(id).party) best = Math.max(best, member.level);
    }
    return best ? best + margin : fallback;
  };
  /** Respawn objectives stay satisfied once the campaign has healed at that town or any later one. */
  const RESPAWN_ORDER = [MAPS.dewford, MAPS.slateport, MAPS.mauville];
  const respawnAtOrBeyond = (observation, townId) => {
    const heal = observation.player.lastHealLocation;
    const index = RESPAWN_ORDER.findIndex(id => { const town = constants.maps.get(id); return town && heal.group === town.group && heal.number === town.number; });
    return index >= RESPAWN_ORDER.indexOf(townId);
  };
  const bagCount = (observation, pocket, itemName) => (observation.bag?.[pocket] ?? []).filter(slot => slot.itemId === constants.items[itemName]).reduce((sum, slot) => sum + slot.quantity, 0);
  const shoppingRemaining = (observation, mapId) => {
    const list = SHOPPING[mapId] ?? [];
    let money = observation.player?.money ?? 0;
    const remaining = [];
    for (const entry of list) {
      const have = bagCount(observation, entry.pocket, entry.item);
      const price = tables ? tables.item(constants.items[entry.item]).price : 200;
      const want = Math.max(0, entry.target - have);
      const affordable = Math.floor(Math.max(0, money - 300) / Math.max(price, 1));
      const quantity = Math.min(want, affordable, 99);
      if (quantity > 0) { remaining.push({ ...entry, itemId: constants.items[entry.item], quantity, price }); money -= quantity * price; }
    }
    return remaining;
  };
  const hasWaterCarrier=o=>o.party.some(p=>p.validity==='valid'&&!p.isEgg&&[341,345,346].every(item=>tables?.canLearnTM(p.species,item)));
  const knows=(o,move)=>o.party.some(p=>p.moves.some(m=>m.id===move));
  const skyFloors=['OUTSIDE','1F','2F','3F','4F','5F','TOP'].map(f=>`MAP_SKY_PILLAR_${f}`);
  const skyStep=(o,ascending)=>{
    const here=o.player.map.id,index=skyFloors.indexOf(here);
    if(index<0)return goto('MAP_SKY_PILLAR_OUTSIDE',17,12);
    if(ascending&&index>0)return goto('MAP_SKY_PILLAR_TOP',14,9);
    const next=skyFloors[index+(ascending?1:-1)]??'MAP_SKY_PILLAR_ENTRANCE';
    const entry=constants.maps.get(next),arrival=entry.warps.find(w=>w.destMap===here);
    // The catalog names its cartridge destination explicitly; arrival is
    // read from the corresponding map, not from a guessed global layout.
    return arrival?goto(next,arrival.x,arrival.y):wait('The next Sky Pillar floor has no verified native arrival.');
  };
  const teach=(o,itemId,moveId)=>{
    const p=o.party.find(p=>p.validity==='valid'&&!p.isEgg&&tables?.canLearnTM(p.species,itemId));
    return p?{kind:'teach-move',itemId,moveId,personality:p.personality,otId:p.otId}:wait('The required HM needs a compatible Pokémon in the current party.');
  };
  const normanRoute=o=>{
    if(!at(o,MAPS.petalburgGym))return goto(MAPS.petalburgGym,4,109);
    if(o.var('VAR_PETALBURG_GYM_STATE')<6)return interact(MAPS.petalburgGym,4,107,{localId:1});
    const y=o.player.position.y;
    if(y>100)return interact(MAPS.petalburgGym,1,105);
    // Source room doors run scripts, ask Yes/No, and perform their own warp.
    // TRAINER_FLAGS_START is 0x500 in the pinned Emerald flags.h.
    const rooms=[
      {min:90,max:100,trainer:'TRAINER_MARY',localId:2,y:94,door:[1,92]},
      {min:77,max:89,trainer:'TRAINER_RANDALL',localId:3,y:81,door:[1,79]},
      {min:64,max:76,trainer:'TRAINER_GEORGE',localId:6,y:68,door:[1,66]},
      {min:51,max:63,trainer:'TRAINER_ALEXIA',localId:5,y:55,door:[1,53]},
      {min:38,max:50,trainer:'TRAINER_PARKER',localId:4,y:42,door:[7,40]},
      {min:25,max:37,trainer:'TRAINER_BERKE',localId:8,y:29,door:[1,27]},
      {min:12,max:24,trainer:'TRAINER_JODY',localId:7,y:16,door:[7,14]},
    ];
    const room=rooms.find(r=>y>=r.min&&y<=r.max);
    if(room)return o.flagById(0x500+constants.trainers[room.trainer])?interact(MAPS.petalburgGym,...room.door):interact(MAPS.petalburgGym,4,room.y,{localId:room.localId});
    return interact(MAPS.petalburgGym,4,2,{localId:1});
  };
  /** Team-plan members not yet owned whose source map is `mapId`. */
  const captureTargetsOn = (observation, mapId) => {
    if (!teamPlan) return [];
    return teamPlan.filter(member => member.sourceMap === mapId && !partyHas(observation, [member.sourceSpecies.replace('SPECIES_', ''), member.species, member.evolutionTarget].filter(Boolean)));
  };
  const objectives = Object.freeze([
    {
      id: 'leave-truck', chapter: 'intro',
      done: (o) => !at(o, MAPS.truck),
      plan: () => goto(MAPS.truck, 4, 2),
      evidence: 'data/maps/InsideOfTruck/map.json: x=3 triggers set VAR_LITTLEROOT_INTRO_STATE and the dynamic warp; x=4 warps to Littleroot',
    },
    {
      id: 'enter-house-with-mom', chapter: 'intro',
      done: (o) => o.var('VAR_LITTLEROOT_INTRO_STATE') >= 4,
      plan: () => wait('LittlerootTown_OnFrame StepOffTruck and PlayersHouse_1F EnterHouseMovingIn run automatically'),
      evidence: 'data/maps/LittlerootTown/scripts.inc OnFrame states 1/2; data/scripts/players_house.inc',
    },
    {
      id: 'go-see-room', chapter: 'intro',
      done: (o) => o.var('VAR_LITTLEROOT_INTRO_STATE') >= 5,
      plan: (o) => goto(house(o).own1F, house(o).stairs1F.x, house(o).stairs1F.y),
      evidence: 'PlayersHouse_2F OnTransition BlockStairsUntilClockIsSet sets VAR_LITTLEROOT_INTRO_STATE 5 when the player reaches 2F via the 1F stairs warp',
    },
    {
      id: 'set-wall-clock', chapter: 'intro',
      done: (o) => o.var('VAR_LITTLEROOT_INTRO_STATE') >= 6,
      plan: (o) => at(o, house(o).own2F) ? interact(house(o).own2F, house(o).clock.x, house(o).clock.y, { from: 'down' }) : wait('1F OnFrame state 5 pushes the player upstairs'),
      evidence: 'data/scripts/players_house.inc PlayersHouse_2F_EventScript_WallClock sets VAR_LITTLEROOT_INTRO_STATE 6',
    },
    {
      id: 'mom-gym-report', chapter: 'intro',
      done: (o) => o.var('VAR_LITTLEROOT_INTRO_STATE') >= 7,
      plan: (o) => at(o, house(o).own2F) ? goto(house(o).own2F, house(o).stairs2F.x, house(o).stairs2F.y) : wait('1F OnFrame state 6 PetalburgGymReport'),
      evidence: 'players house 1F OnFrame VAR_LITTLEROOT_INTRO_STATE 6 → PetalburgGymReport',
    },
    {
      id: 'meet-rival-mom', chapter: 'intro',
      done: (o) => o.var(house(o).rivalHouseVar) >= 2 || o.var('VAR_LITTLEROOT_RIVAL_STATE') >= 2,
      plan: (o) => goto(house(o).rival1F, house(o).rivalStairs1F.x, house(o).rivalStairs1F.y + 1),
      evidence: 'InsideOfTruck sets VAR_LITTLEROOT_HOUSES_STATE_<player house> 1; the rival house 1F OnFrame checks that same var and YoureNewNeighbor sets it to 2',
    },
    {
      id: 'meet-rival', chapter: 'intro',
      done: (o) => o.var('VAR_LITTLEROOT_RIVAL_STATE') >= 3,
      plan: (o) => at(o, house(o).rival2F) ? interact(house(o).rival2F, house(o).rivalBall.x, house(o).rivalBall.y) : goto(house(o).rival1F, house(o).rivalStairs1F.x, house(o).rivalStairs1F.y),
      evidence: 'rival house 2F RivalsPokeBall with VAR_LITTLEROOT_RIVAL_STATE 2 → MeetRival sets 3 and VAR_LITTLEROOT_TOWN_STATE 1',
    },
    {
      id: 'route-101-birch-rescue', chapter: 'intro',
      done: (o) => o.var('VAR_ROUTE101_STATE') >= 2,
      plan: () => goto(MAPS.route101, 10, 19),
      evidence: 'Route101 coord trigger (10,19)/(11,19) with VAR_ROUTE101_STATE 1 → StartBirchRescue sets 2',
    },
    {
      id: 'birchs-bag-starter', chapter: 'intro',
      done: (o) => o.flag('FLAG_SYS_POKEMON_GET') || o.var('VAR_BIRCH_LAB_STATE') >= 2,
      plan: () => interact(MAPS.route101, 7, 14),
      evidence: 'Route101_EventScript_BirchsBag: FLAG_SYS_POKEMON_GET, special ChooseStarter, first battle, warp to lab with VAR_BIRCH_LAB_STATE 2',
    },
    {
      id: 'lab-nickname-and-rival-advice', chapter: 'intro',
      done: (o) => o.var('VAR_BIRCH_LAB_STATE') >= 3,
      plan: () => wait('lab OnFrame GiveStarterEvent runs automatically; answer prompts'),
      evidence: 'LittlerootTown_ProfessorBirchsLab_EventScript_GiveStarterEvent → AgreeToSeeRival sets VAR_BIRCH_LAB_STATE 3',
    },
    {
      id: 'route-103-rival-battle', chapter: 'intro',
      done: (o) => o.var('VAR_BIRCH_LAB_STATE') >= 4 || o.flag('FLAG_DEFEATED_RIVAL_ROUTE103'),
      plan: () => interact(MAPS.route103, 10, 3, { localId: 2 }),
      evidence: 'Route103_EventScript_Rival at (10,3): trainerbattle_no_intro then RivalEnd sets VAR_BIRCH_LAB_STATE 4 and FLAG_DEFEATED_RIVAL_ROUTE103',
    },
    {
      id: 'lab-pokedex', chapter: 'intro',
      done: (o) => o.flag('FLAG_ADVENTURE_STARTED') || o.flag('FLAG_RECEIVED_POKEDEX_FROM_BIRCH') || o.var('VAR_BIRCH_LAB_STATE') >= 5,
      plan: () => goto(MAPS.lab, 6, 11),
      evidence: 'lab OnFrame VAR_BIRCH_LAB_STATE 4 → GivePokedexEvent',
    },
    {
      id: 'running-shoes', chapter: 'intro',
      done: (o) => o.flag('FLAG_RECEIVED_RUNNING_SHOES') || o.flag('FLAG_SYS_B_DASH') || o.var('VAR_LITTLEROOT_TOWN_STATE') >= 4,
      plan: () => goto(MAPS.littleroot, 10, 9),
      evidence: 'LittlerootTown coord triggers (8..11,9) with VAR_LITTLEROOT_TOWN_STATE 3 → GiveRunningShoes',
    },
    {
      id: 'petalburg-norman-wally', chapter: 'petalburg',
      done: (o) => o.var('VAR_PETALBURG_GYM_STATE') >= 2,
      plan: (o) => o.var('VAR_PETALBURG_GYM_STATE') === 1 ? wait('Wally tutorial and ReturnFromWallyTutorial run automatically') : interact(MAPS.petalburgGym, 4, 107, { localId: 1, from: 'down' }),
      evidence: 'PetalburgCity_Gym OnTransition MoveNormanToEntrance (4,107) while VAR_PETALBURG_GYM_STATE < 6; Norman → Wally tutorial sets GYM_STATE 1, ReturnFromWallyTutorial sets 2',
    },
    {
      id: 'petalburg-woods-devon', chapter: 'petalburg',
      done: (o) => o.var('VAR_PETALBURG_WOODS_STATE') >= 1,
      plan: () => goto(MAPS.woods, 26, 23),
      evidence: 'PetalburgWoods coord triggers (26,23)/(27,23) with VAR_PETALBURG_WOODS_STATE 0 → Devon researcher + Aqua grunt battle → state 1',
    },
    {
      id: 'train-for-roxanne', chapter: 'rustboro', readiness: 16,
      done: (o) => o.flag('FLAG_BADGE01_GET') || (o.party[0]?.level ?? 0) >= 16,
      plan: () => train(MAPS.route104, 16, { evidence: 'starter evolution level 16 (Combusken Double Kick / Grovyle / Marshtomp) before Roxanne L12/L12/L15' }),
      evidence: 'src/data/trainer_parties.h sParty_Roxanne1: Geodude L12, Geodude L12, Nosepass L15',
    },
    {
      id: 'rustboro-roxanne', chapter: 'rustboro',
      done: (o) => o.flag('FLAG_BADGE01_GET'),
      plan: () => interact(MAPS.rustboroGym, 5, 2, { localId: 1, from: 'down' }),
      evidence: 'RustboroCity_Gym_EventScript_Roxanne: trainerbattle_single TRAINER_ROXANNE_1 → FLAG_BADGE01_GET',
    },
    {
      id: 'rustboro-stolen-goods', chapter: 'rustboro',
      done: (o) => o.var('VAR_RUSTBORO_CITY_STATE') >= 2,
      plan: () => goto(MAPS.rustboro, 23, 22),
      evidence: 'RustboroCity coord triggers (23,20..24) with VAR_RUSTBORO_CITY_STATE 1 → StolenGoods sets 2, VAR_RUSTURF_TUNNEL_STATE 2, VAR_ROUTE116_STATE 1',
    },
    {
      id: 'rustboro-help-employee', chapter: 'rustboro',
      done: (o) => o.var('VAR_RUSTBORO_CITY_STATE') >= 3,
      plan: () => goto(MAPS.rustboro, 30, 11),
      evidence: 'RustboroCity coord triggers (30,9),(29,10),(30,11),(30,12) with state 2 → EmployeeAskToGetGoods sets 3',
    },
    {
      id: 'rusturf-recover-goods', chapter: 'rustboro',
      done: (o) => o.var('VAR_RUSTBORO_CITY_STATE') >= 4 || o.flag('FLAG_RECOVERED_DEVON_GOODS'),
      plan: (o) => (at(o, MAPS.rusturf) && o.var('VAR_RUSTURF_TUNNEL_STATE') >= 3) ? interact(MAPS.rusturf, 14, 5, { localId: 6, from: 'left' }) : goto(MAPS.rusturf, 9, 5),
      evidence: 'RusturfTunnel coord triggers (9,4)/(9,5) with VAR_RUSTURF_TUNNEL_STATE 2 → AquaGruntBackUp sets 3; Grunt (localId 6) trainerbattle_no_intro TRAINER_GRUNT_RUSTURF_TUNNEL → FLAG_RECOVERED_DEVON_GOODS, VAR_RUSTBORO_CITY_STATE 4',
    },
    {
      id: 'rustboro-return-goods', chapter: 'rustboro',
      done: (o) => o.var('VAR_RUSTBORO_CITY_STATE') >= 5 || o.flag('FLAG_RETURNED_DEVON_GOODS'),
      plan: () => goto(MAPS.rustboro, 30, 11),
      evidence: 'RustboroCity coord triggers (30,9..12) with state 4 → ReturnGoods sets 5 and warps to Devon Corp 3F',
    },
    {
      id: 'devon-president-letter', chapter: 'rustboro',
      done: (o) => o.var('VAR_DEVON_CORP_3F_STATE') >= 1 || o.flag('FLAG_RECEIVED_POKENAV'),
      plan: (o) => at(o, MAPS.devon3F) ? wait('Devon Corp 3F OnFrame MeetPresident runs with VAR_DEVON_CORP_3F_STATE 0') : goto(MAPS.devon3F, 3, 2),
      evidence: 'RustboroCity_DevonCorp_3F OnFrame state 0 → MeetPresident: letter, FLAG_RECEIVED_POKENAV, VAR_DEVON_CORP_3F_STATE 1, VAR_BRINEY_LOCATION 1',
    },
    {
      id: 'rustboro-pokenav-tutorial', chapter: 'rustboro',
      done: (o) => o.var('VAR_RUSTBORO_CITY_STATE') >= 7 || o.var('VAR_RUSTBORO_CITY_STATE') < 6,
      plan: () => wait('RustboroCity OnFrame state 6 → ScientistAddMatchCall: forced start menu (POKÉNAV) then the Mr. Stone call'),
      evidence: 'data/maps/RustboroCity/scripts.inc MatchCallTutorial: ScriptMenu_CreateStartMenuForPokenavTutorial (index 3) + OpenPokenavForTutorial → VAR_RUSTBORO_CITY_STATE 7',
      multichoice: 3,
    },
    {
      id: 'briney-sail-to-dewford', chapter: 'dewford',
      done: (o) => o.flag('FLAG_VISITED_DEWFORD_TOWN'),
      plan: () => interact(MAPS.brineyHouse, 5, 3, { localId: 1, from: 'down', note: 'Mr. Briney (localId 1) at his Route 104 house once VAR_BRINEY_LOCATION is 1' }),
      evidence: 'Route104_MrBrineysHouse_EventScript_SailToDewford: VAR_BOARD_BRINEY_BOAT_STATE 1, VAR_RUSTBORO_CITY_STATE 8, VAR_ROUTE104_STATE 2 → Route104 OnFrame StartSailToDewford',
    },
    {
      id: 'dewford-set-respawn', chapter: 'dewford',
      // Heal locations point at the town map outside the Center (HEAL_LOCATION_DEWFORD_TOWN → MAP_DEWFORD_TOWN), not the Center interior.
      done: (o) => respawnAtOrBeyond(o, MAPS.dewford) || o.flag('FLAG_DELIVERED_DEVON_GOODS'),
      plan: () => interactAt(MAPS.dewfordCenter, 7, 4, 'up', { note: 'heal once so a white-out on the island respawns at Dewford instead of the mainland' }),
      evidence: 'Sailing sets no respawn; SaveBlock1.lastHealLocation is updated by the Pokémon Center nurse (src/field_specials.c SetLastHealLocationWarp via pkmn_center_nurse.inc)',
    },
    {
      id: 'train-for-brawly', chapter: 'dewford', readiness: 22,
      done: (o) => o.flag('FLAG_BADGE02_GET') || (o.party[0]?.level ?? 0) >= 22,
      plan: () => train(MAPS.route106, 22),
      evidence: 'src/data/trainer_parties.h sParty_Brawly1: Machop L16, Meditite L16, Makuhita L19',
    },
    {
      id: 'dewford-brawly', chapter: 'dewford',
      done: (o) => o.flag('FLAG_BADGE02_GET'),
      plan: () => interact(MAPS.dewfordGym, 4, 3, { localId: 1, from: 'down' }),
      evidence: 'DewfordTown_Gym_EventScript_Brawly: trainerbattle_single TRAINER_BRAWLY_1 → FLAG_BADGE02_GET',
    },
    {
      id: 'granite-cave-steven', chapter: 'dewford',
      done: (o) => o.flag('FLAG_DELIVERED_STEVEN_LETTER'),
      plan: () => interact(MAPS.stevensRoom, 7, 8, { localId: 1, from: 'down' }),
      evidence: 'GraniteCave_StevensRoom_EventScript_Steven: ITEM_LETTER → FLAG_DELIVERED_STEVEN_LETTER (Route 106 (48,16) → Granite Cave 1F (5,10) → Steven room)',
    },
    {
      id: 'briney-sail-to-slateport', chapter: 'slateport',
      done: (o) => at(o, MAPS.route109) || at(o, MAPS.slateport) || o.var('VAR_BRINEY_LOCATION') >= 3 || o.flag('FLAG_DELIVERED_DEVON_GOODS'),
      plan: () => interact(MAPS.dewford, 12, 9, { localId: 2, from: 'down' }),
      evidence: 'DewfordTown_EventScript_Briney: after FLAG_DELIVERED_STEVEN_LETTER the destination multichoice (Petalburg / Slateport / Cancel) → ChooseSlateport',
      multichoice: 1,
    },
    {
      id: 'slateport-set-respawn', chapter: 'slateport',
      done: (o) => respawnAtOrBeyond(o, MAPS.slateport) || o.flag('FLAG_BADGE03_GET'),
      plan: () => interactAt(MAPS.slateportCenter, 7, 4, 'up'),
      evidence: 'Pokémon Center nurse updates SaveBlock1.lastHealLocation to HEAL_LOCATION_SLATEPORT_CITY',
    },
    {
      id: 'shop-slateport', chapter: 'slateport',
      done: (o) => o.flag('FLAG_DELIVERED_DEVON_GOODS') || shoppingRemaining(o, MAPS.slateportMart).length === 0,
      plan: () => interactAt(MAPS.slateportMart, 3, 3, 'left', { shop: MAPS.slateportMart }),
      evidence: 'data/maps/SlateportCity_Mart/scripts.inc pokemart: Poké Ball, Great Ball, Potion, Super Potion, …; clerk at (1,3) behind the counter column x=2',
    },
    {
      id: 'slateport-shipyard-dock', chapter: 'slateport',
      done: (o) => o.flag('FLAG_DOCK_REJECTED_DEVON_GOODS') || o.flag('FLAG_HIDE_SLATEPORT_CITY_TEAM_AQUA') || o.flag('FLAG_DELIVERED_DEVON_GOODS'),
      plan: () => interact(MAPS.shipyard, 5, 5, { localId: 1 }),
      evidence: 'SternsShipyard_1F_EventScript_Dock: sets FLAG_DOCK_REJECTED_DEVON_GOODS and FLAG_HIDE_SLATEPORT_CITY_TEAM_AQUA (the grunt line blocking the museum doors)',
    },
    {
      id: 'deliver-devon-goods', chapter: 'slateport',
      done: (o) => o.flag('FLAG_DELIVERED_DEVON_GOODS'),
      plan: (o) => at(o, MAPS.museum2F) ? interact(MAPS.museum2F, 13, 6, { localId: 1, from: 'down' }) : goto(MAPS.museum2F, 6, 2),
      evidence: 'OceanicMuseum_1F PayEntranceFee (yes/no, 50) → 2F CaptStern: two Aqua grunt battles → FLAG_DELIVERED_DEVON_GOODS, VAR_SLATEPORT_OUTSIDE_MUSEUM_STATE 1',
    },
    {
      id: 'capture-route-110', chapter: 'route-110',
      done: (o) => captureTargetsOn(o, MAPS.route110).length === 0 || (o.bag?.pokeBalls ?? []).length === 0 || o.party.length >= 6,
      plan: (o) => train(MAPS.route110, 99, { capture: captureTargetsOn(o, MAPS.route110).map(member => member.sourceSpecies) }),
      evidence: 'src/data/wild_encounters.json MAP_ROUTE110 land: Electrike (team plan member for every starter)',
    },
    {
      id: 'route-110-rival', chapter: 'route-110',
      done: (o) => o.var('VAR_ROUTE110_STATE') >= 1,
      plan: () => goto(MAPS.route110, 34, 56),
      evidence: 'Route110 coord triggers (33..35,56) with VAR_ROUTE110_STATE 0 → RivalScene → trainerbattle_no_intro → VAR_ROUTE110_STATE 1',
    },
    {
      id: 'mauville-set-respawn', chapter: 'mauville',
      done: (o) => respawnAtOrBeyond(o, MAPS.mauville) || o.flag('FLAG_BADGE03_GET'),
      plan: () => interactAt(MAPS.mauvilleCenter, 7, 4, 'up'),
      evidence: 'Pokémon Center nurse updates SaveBlock1.lastHealLocation to HEAL_LOCATION_MAUVILLE_CITY',
    },
    {
      id: 'mauville-wally', chapter: 'mauville',
      done: (o) => o.flag('FLAG_DEFEATED_WALLY_MAUVILLE'),
      plan: () => interact(MAPS.mauville, 8, 6, { localId: 6, from: 'down' }),
      evidence: 'MauvilleCity_EventScript_Wally: yes/no → trainerbattle_no_intro TRAINER_WALLY_MAUVILLE → FLAG_DEFEATED_WALLY_MAUVILLE',
    },
    {
      id: 'mauville-rock-smash', chapter: 'mauville',
      done: (o) => o.flag('FLAG_RECEIVED_HM_ROCK_SMASH'),
      plan: () => interact(MAPS.mauvilleHouse1, 4, 4, { localId: 1, from: 'down' }),
      evidence: 'MauvilleCity_House1_EventScript_RockSmashDude → FLAG_RECEIVED_HM_ROCK_SMASH',
    },
    {
      id: 'train-for-wattson', chapter: 'mauville',
      done: (o) => o.flag('FLAG_BADGE03_GET') || (o.party[0]?.level ?? 0) >= readinessFor(['TRAINER_WATTSON_1']),
      plan: () => train(MAPS.route110, readinessFor(['TRAINER_WATTSON_1'])),
      evidence: 'gTrainers[TRAINER_WATTSON_1] party levels from the cartridge + 3',
    },
    {
      id: 'mauville-wattson', chapter: 'mauville',
      done: (o) => o.flag('FLAG_BADGE03_GET'),
      plan: (o) => at(o, MAPS.mauvilleGym) ? interact(MAPS.mauvilleGym, 5, 2, { localId: 1, from: 'down', puzzle: true }) : goto(MAPS.mauvilleGym, 4, 19),
      evidence: 'MauvilleCity_Gym_EventScript_Wattson: trainerbattle_single TRAINER_WATTSON_1 → FLAG_BADGE03_GET; floor switches toggle the beam barriers',
    },
    {
      id:'mauville-teach-rock-smash',chapter:'fallarbor',
      done:o=>knows(o,249),plan:o=>teach(o,344,249),
      evidence:'ITEM_HM06 / MOVE_ROCK_SMASH; native gTMHMLearnsets and party_menu.c',
    },
    {
      id:'rusturf-strength',chapter:'fallarbor',
      done:o=>o.flag('FLAG_RECEIVED_HM_STRENGTH'),
      plan:()=>interact(MAPS.rusturf,24,5,{localId:2,from:'left'}),
      evidence:'RusturfTunnel EventScript_RockSmash → ClearTunnelScene gives HM04 and sets FLAG_RECEIVED_HM_STRENGTH',
    },
    {
      id:'teach-strength',chapter:'fallarbor',done:o=>knows(o,70),plan:o=>teach(o,342,70),
      evidence:'ITEM_HM04 / MOVE_STRENGTH; native gTMHMLearnsets and party_menu.c',
    },
    {
      id:'capture-water-carrier',chapter:'fallarbor',done:hasWaterCarrier,
      plan:o=>o.party.length>=6?wait('Free one party slot for a native water-HM carrier.'):(o.bag.pokeBalls??[]).some(i=>i.quantity>0)?train('MAP_ROUTE117',1):wait('The native water-HM capture needs Poké Balls.'),
      evidence:'Route117 grass includes Marill; verify Surf, Dive and Waterfall compatibility from gTMHMLearnsets',
    },
    {
      id:'route111-rocks',chapter:'fallarbor',
      done:o=>o.flag('FLAG_MET_ARCHIE_METEOR_FALLS')||o.flag('FLAG_VISITED_FALLARBOR_TOWN')||['MAP_ROUTE112','MAP_FIERY_PATH','MAP_ROUTE113','MAP_ROUTE114','MAP_METEOR_FALLS_1F_1R'].includes(o.player.map.id)||(at(o,'MAP_ROUTE111')&&o.player.position.y<100),
      plan:o=>at(o,'MAP_ROUTE111')&&o.flag('FLAG_TEMP_11')?goto('MAP_ROUTE111',18,99):interact('MAP_ROUTE111',18,101,{localId:15,from:'up'}),
      evidence:'Route111/map.json Rock Smash localId15 at18,101, FLAG_TEMP_11; native badge03 field-move check',
    },
    {
      id:'fiery-path-passage',chapter:'fallarbor',
      done:o=>o.flag('FLAG_MET_ARCHIE_METEOR_FALLS')||o.flag('FLAG_VISITED_FALLARBOR_TOWN')||['MAP_ROUTE113','MAP_ROUTE114','MAP_METEOR_FALLS_1F_1R'].includes(o.player.map.id)||(at(o,'MAP_ROUTE112')&&o.player.position.y<15)||(at(o,'MAP_ROUTE111')&&o.player.position.y<55),
      plan:o=>at(o,'MAP_FIERY_PATH')?goto('MAP_FIERY_PATH',26,4):goto('MAP_ROUTE112',11,36),
      evidence:'FieryPath north and south warps bypass Route111 ViciousSandstormTrigger before obtaining Go-Goggles',
    },
    {
      id:'meteor-falls-magma',chapter:'fallarbor',done:o=>o.flag('FLAG_MET_ARCHIE_METEOR_FALLS'),
      plan:()=>goto('MAP_METEOR_FALLS_1F_1R',14,18),
      evidence:'MeteorFalls_1F_1R MagmaStealsMeteoriteScene sets FLAG_MET_ARCHIE_METEOR_FALLS and clears the cable car blockade',
    },
    {
      id:'cable-car-mt-chimney',chapter:'lavaridge',
      done:o=>o.flag('FLAG_DEFEATED_EVIL_TEAM_MT_CHIMNEY')||at(o,'MAP_MT_CHIMNEY')||at(o,'MAP_MT_CHIMNEY_CABLE_CAR_STATION'),
      plan:()=>interact('MAP_ROUTE112_CABLE_CAR_STATION',6,6,{localId:1}),
      evidence:'Route112_CableCarStation Attendant starts the native cable-car transition',
    },
    {
      id:'mt-chimney-maxie',chapter:'lavaridge',done:o=>o.flag('FLAG_DEFEATED_EVIL_TEAM_MT_CHIMNEY'),
      plan:()=>interact('MAP_MT_CHIMNEY',13,6,{localId:2}),
      evidence:'MtChimney Maxie battle and departure set FLAG_DEFEATED_EVIL_TEAM_MT_CHIMNEY',
    },
    {
      id:'lavaridge-flannery',chapter:'lavaridge',done:o=>o.flag('FLAG_BADGE04_GET'),
      plan:o=>['MAP_MT_CHIMNEY','MAP_MT_CHIMNEY_CABLE_CAR_STATION','MAP_JAGGED_PASS'].includes(o.player.map.id)||o.player.map.id.startsWith('MAP_LAVARIDGE_TOWN')||(at(o,'MAP_ROUTE112')&&o.player.position.x<13&&o.player.position.y>40)?interact('MAP_LAVARIDGE_TOWN_GYM_1F',13,9,{localId:1}):interact('MAP_ROUTE112_CABLE_CAR_STATION',6,6,{localId:1}),
      evidence:'LavaridgeTown_Gym_1F Flannery battle sets FLAG_BADGE04_GET',
    },
    {
      id:'petalburg-norman',chapter:'petalburg-return',done:o=>o.flag('FLAG_BADGE05_GET'),
      plan:normanRoute,
      evidence:'PetalburgCity_Gym Norman checks four badges before opening the trainer rooms; badge05 on victory',
    },
    {
      id:'petalburg-surf',chapter:'petalburg-return',done:o=>o.flag('FLAG_RECEIVED_HM_SURF'),
      plan:()=>goto('MAP_PETALBURG_CITY_WALLYS_HOUSE',2,4),
      evidence:'PetalburgCity_WallysHouse OnFrame after Norman delivers native HM03 Surf',
    },
    {
      id:'teach-surf',chapter:'fortree',done:o=>knows(o,57),plan:o=>teach(o,341,57),
      evidence:'HM03 Surf, native gTMHMLearnsets; badge05 enables field Surf',
    },
    {
      id:'weather-institute',chapter:'fortree',done:o=>o.flag('FLAG_RECEIVED_CASTFORM'),
      plan:o=>o.var('VAR_WEATHER_INSTITUTE_STATE')>0?interact('MAP_ROUTE119_WEATHER_INSTITUTE_2F',18,6,{localId:5}):interact('MAP_ROUTE119_WEATHER_INSTITUTE_2F',4,6,{localId:3}),
      evidence:'Route119_WeatherInstitute_2F Shelly and native Castform gift unlock the Route119 bridge',
    },
    {
      id:'route119-fly',chapter:'fortree',done:o=>o.flag('FLAG_RECEIVED_HM_FLY'),plan:()=>goto('MAP_ROUTE119',25,31),
      evidence:'Route119 RivalTrigger1 gives HM02 and sets FLAG_RECEIVED_HM_FLY',
    },
    {
      id:'route120-devon-scope',chapter:'fortree',done:o=>o.flag('FLAG_RECEIVED_DEVON_SCOPE'),plan:()=>interact('MAP_ROUTE120',13,15,{localId:31}),
      evidence:'Route120 Steven Kecleon encounter gives the native Devon Scope',
    },
    {
      id:'fortree-winona',chapter:'fortree',done:o=>o.flag('FLAG_BADGE06_GET'),
      plan:o=>!o.flag('FLAG_KECLEON_FLED_FORTREE')?interact('MAP_FORTREE_CITY',25,8,{localId:7}):at(o,'MAP_FORTREE_CITY_GYM')?interact('MAP_FORTREE_CITY_GYM',15,2,{localId:1,puzzle:true}):goto('MAP_FORTREE_CITY_GYM',15,23),
      evidence:'FortreeCity_Gym Winona gives badge06 after the native rotating-gate puzzle',
    },
    {
      id:'mt-pyre-emblem',chapter:'mossdeep',done:o=>o.flag('FLAG_RECEIVED_RED_OR_BLUE_ORB'),plan:()=>goto('MAP_MT_PYRE_SUMMIT',23,7),
      evidence:'MtPyre_Summit TeamAquaTrigger1 gives the Magma Emblem and sets FLAG_RECEIVED_RED_OR_BLUE_ORB',
    },
    {
      id:'magma-hideout-open',chapter:'mossdeep',done:o=>o.var('VAR_JAGGED_PASS_STATE')>=2,
      plan:o=>['MAP_MT_CHIMNEY','MAP_MT_CHIMNEY_CABLE_CAR_STATION','MAP_JAGGED_PASS'].includes(o.player.map.id)?goto('MAP_JAGGED_PASS',14,15):interact('MAP_ROUTE112_CABLE_CAR_STATION',6,6,{localId:1}),
      evidence:'JaggedPass OpenMagmaHideout requires the native Magma Emblem and changes VAR_JAGGED_PASS_STATE to2',
    },
    {
      id:'magma-hideout-maxie',chapter:'mossdeep',done:o=>o.flag('FLAG_GROUDON_AWAKENED_MAGMA_HIDEOUT'),plan:()=>interact('MAP_MAGMA_HIDEOUT_4F',16,21,{localId:6}),
      evidence:'MagmaHideout_4F Maxie battle sets FLAG_GROUDON_AWAKENED_MAGMA_HIDEOUT and enables Stern interview',
    },
    {
      id:'slateport-submarine',chapter:'mossdeep',done:o=>o.flag('FLAG_MET_TEAM_AQUA_HARBOR'),
      plan:o=>o.var('VAR_SLATEPORT_CITY_STATE')<2?interact('MAP_SLATEPORT_CITY',28,13,{localId:11}):goto('MAP_SLATEPORT_CITY_HARBOR',8,13),
      evidence:'SlateportCity CaptStern interview and Harbor submarine scene clear the Aqua Hideout entrance',
    },
    {
      id:'aqua-hideout-matt',chapter:'mossdeep',done:o=>o.flag('FLAG_TEAM_AQUA_ESCAPED_IN_SUBMARINE'),plan:()=>interact('MAP_AQUA_HIDEOUT_B2F',23,19,{localId:1}),
      evidence:'AquaHideout_B2F Matt battle and SubmarineEscape clear the Lilycove sea blockade',
    },
    {
      id:'mossdeep-tate-liza',chapter:'mossdeep',done:o=>o.flag('FLAG_BADGE07_GET'),plan:()=>interact('MAP_MOSSDEEP_CITY_GYM',23,7,{localId:1,puzzle:true}),
      evidence:'MossdeepCity_Gym TateAndLiza native double battle gives badge07',
    },
    {
      id:'mossdeep-space-center',chapter:'mossdeep',done:o=>o.var('VAR_MOSSDEEP_SPACE_CENTER_STATE')>=3||o.flag('FLAG_DEFEATED_MAGMA_SPACE_CENTER'),
      plan:o=>!o.flag('FLAG_DEFEATED_GRUNT_SPACE_CENTER_1F')?interact('MAP_MOSSDEEP_CITY_SPACE_CENTER_1F',13,2,{localId:9,from:'up'}):o.var('VAR_MOSSDEEP_SPACE_CENTER_STATE')<2?goto('MAP_MOSSDEEP_CITY_SPACE_CENTER_2F',13,2):interact('MAP_MOSSDEEP_CITY_SPACE_CENTER_2F',1,8,{localId:4}),
      evidence:'MossdeepCity_SpaceCenter_2F Steven partner battle sets FLAG_DEFEATED_MAGMA_SPACE_CENTER',
    },
    {
      id:'mossdeep-dive',chapter:'mossdeep',done:o=>o.flag('FLAG_RECEIVED_HM_DIVE'),plan:()=>interact('MAP_MOSSDEEP_CITY_STEVENS_HOUSE',9,6,{localId:1}),
      evidence:'MossdeepCity_StevensHouse Steven gives native HM08 Dive after the Space Center',
    },
    {
      id:'teach-dive',chapter:'sootopolis',done:o=>knows(o,291),plan:o=>teach(o,346,291),
      evidence:'HM08 Dive and badge07 enable native underwater travel',
    },
    {
      id:'seafloor-archie',chapter:'sootopolis',done:o=>o.flag('FLAG_KYOGRE_ESCAPED_SEAFLOOR_CAVERN'),plan:()=>goto('MAP_SEAFLOOR_CAVERN_ROOM9',17,42),
      evidence:'SeafloorCavern_Room9 native ArchieAwakenKyogre coordinate trigger and completion flag',
    },
    {
      id:'sootopolis-steven',chapter:'sootopolis',done:o=>o.flag('FLAG_STEVEN_GUIDES_TO_CAVE_OF_ORIGIN'),plan:()=>interact('MAP_SOOTOPOLIS_CITY',20,36,{localId:7}),
      evidence:'SootopolisCity Steven guides the player to the Cave of Origin',
    },
    {
      id:'cave-origin-wallace',chapter:'sootopolis',done:o=>o.flag('FLAG_WALLACE_GOES_TO_SKY_PILLAR'),plan:()=>interact('MAP_CAVE_OF_ORIGIN_B1F',9,13,{localId:1}),
      evidence:'CaveOfOrigin_B1F AtSkyPillar is native multichoice index2',
    },
    {
      id:'sky-pillar-rayquaza',chapter:'sootopolis',done:o=>o.var('VAR_SKY_PILLAR_RAYQUAZA_CRY_DONE')>=1,plan:o=>at(o,'MAP_SKY_PILLAR_TOP')?goto('MAP_SKY_PILLAR_TOP',14,9):skyStep(o,true),
      evidence:'SkyPillar_Top AwakenRayquaza coordinate trigger; the story awakening does not capture or battle Rayquaza',
    },
    {
      id:'sootopolis-team-leaders',chapter:'sootopolis',done:o=>o.flag('FLAG_SOOTOPOLIS_ARCHIE_MAXIE_LEAVE'),
      plan:o=>skyFloors.includes(o.player.map.id)?skyStep(o,false):o.flag('FLAG_MET_MAXIE_SOOTOPOLIS')?interact('MAP_SOOTOPOLIS_CITY',31,33,{localId:17}):interact('MAP_SOOTOPOLIS_CITY',29,33,{localId:16}),
      evidence:'SootopolisCity Maxie and Archie conversations complete after the native Rayquaza scene',
    },
    {
      id:'sootopolis-waterfall',chapter:'sootopolis',done:o=>o.flag('FLAG_RECEIVED_HM_WATERFALL'),plan:()=>interact('MAP_SOOTOPOLIS_CITY',31,32,{localId:18}),
      evidence:'SootopolisCity Wallace gives HM07 after FLAG_SOOTOPOLIS_ARCHIE_MAXIE_LEAVE',
    },
    {
      id:'sootopolis-juan',chapter:'sootopolis',done:o=>o.flag('FLAG_BADGE08_GET'),plan:()=>interact('MAP_SOOTOPOLIS_CITY_GYM_1F',8,2,{localId:1,puzzle:true}),
      evidence:'SootopolisCity_Gym_1F Juan awards badge08 after the native cracked-ice puzzle',
    },
    {
      id:'teach-waterfall',chapter:'league',done:o=>knows(o,127),plan:o=>teach(o,345,127),
      evidence:'HM07 Waterfall and badge08 permit the ascent to Ever Grande',
    },

    {id:'league-pp-stock',chapter:'league',done:o=>o.flag('FLAG_SYS_GAME_CLEAR')||inLeague(o)||leaguePpStock(o,constants)===null,plan:o=>leaguePpStock(o,constants),evidence:'Native ripe Leppa trees, src/berry.c and data/scripts/new_game.inc'},
    {id:'league-supplies',chapter:'league',done:o=>o.flag('FLAG_SYS_GAME_CLEAR')||inLeague(o)||shoppingRemaining(o,'MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F').length===0,plan:()=>interactAt('MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F',16,4,'up',{shop:'MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F'}),evidence:'Native League mart: Full Restore, Revive, Hyper Potion'},
    {id:'league-heal-before-entry',chapter:'league',done:o=>o.flag('FLAG_SYS_GAME_CLEAR')||inLeague(o)||partyHealth(o).full,plan:()=>interactAt('MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F',3,4,'up'),evidence:'League nurse at3,2 restores the full team before entry'},
    {id:'league-entry',chapter:'league',done:o=>o.flag('FLAG_SYS_GAME_CLEAR')||o.flag('FLAG_ENTERED_ELITE_FOUR'),plan:()=>interact('MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F',9,2,{localId:3}),evidence:'Native badge verification and FLAG_ENTERED_ELITE_FOUR'},
    ...['SIDNEY','PHOEBE','GLACIA','DRAKE'].map(name=>({id:`league-${name.toLowerCase()}`,chapter:'league',done:o=>o.flag('FLAG_SYS_GAME_CLEAR')||o.flag(`FLAG_DEFEATED_ELITE_4_${name}`),plan:()=>interact(`MAP_EVER_GRANDE_CITY_${name}S_ROOM`,6,5,{localId:1}),evidence:`Native ${name} battle completion flag`})),
    {id:'league-champion',chapter:'league',done:o=>o.flag('FLAG_SYS_GAME_CLEAR'),plan:()=>goto('MAP_EVER_GRANDE_CITY_CHAMPIONS_ROOM',6,11),evidence:'Native Wallace entry scene and Hall of Fame game-clear save'},
    {id:'league-national-dex',chapter:'postgame',done:o=>o.flag('FLAG_SYS_NATIONAL_DEX'),plan:()=>goto(MAPS.lab,6,10),evidence:'Birch lab native VAR_DEX_UPGRADE_JOHTO_STARTER_STATE1 upgrade scene'},

  ]);
  const healObjective = Object.freeze({
    id: 'heal-party', chapter: 'maintenance',
    done: (o) => partyHealth(o).full,
    plan: (o) => {
      const here = o.player.map.id;
      if(inLeague(o))return leagueRecovery(o,constants)??wait('The League party is ready.');
      if(here==='MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F'||here==='MAP_EVER_GRANDE_CITY'&&o.player.position.y<30)return interactAt('MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F',3,4,'up');
      if(here==='MAP_EVER_GRANDE_CITY'||here==='MAP_EVER_GRANDE_CITY_POKEMON_CENTER_1F'||here.startsWith('MAP_VICTORY_ROAD'))return interactAt('MAP_EVER_GRANDE_CITY_POKEMON_CENTER_1F',7,4,'up');
      if(here.startsWith('MAP_SEAFLOOR_CAVERN')||here==='MAP_UNDERWATER_SEAFLOOR_CAVERN'||/^MAP_(UNDERWATER_)?ROUTE12[5-9]$/.test(here))return interactAt('MAP_MOSSDEEP_CITY_POKEMON_CENTER_1F',7,4,'up');
      if(here==='MAP_ROUTE119'||here.startsWith('MAP_ROUTE119_WEATHER_INSTITUTE'))return interactAt(o.flag('FLAG_RECEIVED_CASTFORM')?'MAP_FORTREE_CITY_POKEMON_CENTER_1F':MAPS.mauvilleCenter,7,4,'up');
      if(['MAP_MT_CHIMNEY','MAP_MT_CHIMNEY_CABLE_CAR_STATION'].includes(here)&&!o.flag('FLAG_DEFEATED_EVIL_TEAM_MT_CHIMNEY'))return interact('MAP_MT_CHIMNEY_CABLE_CAR_STATION',6,6,{localId:1});
      if(here==='MAP_ROUTE112_CABLE_CAR_STATION'||here==='MAP_ROUTE112'&&!(o.player.position.x<13&&o.player.position.y>40))return interactAt(MAPS.mauvilleCenter,7,4,'up');
      // Route 104 is split by Petalburg Woods: its northern half belongs to Rustboro.
      const spot = (here === MAPS.route104 && o.player.position.y < 40) ? HEAL_SPOTS[3] : (HEAL_SPOTS.find(candidate => candidate.near.includes(here)) ?? HEAL_SPOTS[1]);
      if (spot.kind === 'mom') return interact(house(o).own1F, 2, 6, { localId: 1, note: 'PlayersHouse_1F_EventScript_Mom → MomHealsParty once FLAG_RESCUED_BIRCH is set' });
      return interactAt(spot.map, 7, 4, 'up', { note: `${spot.id}: nurse at (7,2) across the counter` });
    },
    evidence: 'data/scripts/pkmn_center_nurse.inc; data/scripts/players_house.inc MomHealsParty',
  });
  let healing = false;
  return Object.freeze({
    objectives,
    healObjective,
    readinessFor,
    shoppingRemaining,
    /** Species ids the battle policy may try to catch on the current map. */
    captureTargets(observation) {
      const mapId = observation.player?.map.id;
      const ids = new Set();
      if(mapId==='MAP_ROUTE117'&&!hasWaterCarrier(observation))ids.add(speciesId('MARILL'));
      for (const member of captureTargetsOn(observation, mapId)) { const id = speciesId(member.sourceSpecies.replace('SPECIES_', '')); if (id) ids.add(id); }
      return ids;
    },
    /** Desired multichoice index for the current context (default 0). */
    multichoice(observation) {
      if(observation.player?.map.id==='MAP_CAVE_OF_ORIGIN_B1F')return 2;
      const objective = this.current(observation);
      if (objective?.multichoice !== undefined) return objective.multichoice;
      if (observation.player?.map.id === MAPS.rustboro && observation.var('VAR_RUSTBORO_CITY_STATE') === 6) return 3;
      if (observation.player?.map.id === MAPS.dewford && observation.flag('FLAG_DELIVERED_STEVEN_LETTER')) return 1;
      return 0;
    },
    current(observation) {
      if (!observation.player) return null;
      if(inLeague(observation)){
        const recovery=leagueRecovery(observation,constants);
        if(recovery)return {id:'league-recover-party',chapter:'maintenance',plan:()=>recovery};
        healing=false;
        return objectives.find(objective=>!objective.done(observation))??null;
      }
      const health = partyHealth(observation);
      if (health.usable > 0 && observation.flag('FLAG_RESCUED_BIRCH')) {
        const needsHeal = health.leadFraction < 0.34 || (health.fainted > 0 && health.usable - health.fainted <= 1) || health.leadAttackPp <= 2 || health.leadPrimaryPp===0;
        if (needsHeal) healing = true;
        if (healing && health.full) healing = false;
        if (healing) return healObjective;
      }
      return objectives.find(objective => !objective.done(observation)) ?? null;
    },
    status(observation) {
      const current = this.current(observation);
      return Object.freeze({ activeObjective: current ? { id: current.id, chapter: current.chapter } : null, completed: observation.player?objectives.filter(objective => objective.done(observation)).map(objective => objective.id):[], total: objectives.length, health: partyHealth(observation) });
    },
  });
}

export const STORY_MAPS = MAPS;
