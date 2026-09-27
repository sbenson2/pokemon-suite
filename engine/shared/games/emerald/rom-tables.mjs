// Read-only decoders for cartridge ROM tables (species, moves, types, trainers,
// names). Offsets come from include/pokemon.h, include/battle.h, and
// include/constants at pokeemerald 5eff786.
import { decodeGen3Text } from './text.mjs';
import {readGateTables} from './rotating-gates.mjs';

const SPECIES_INFO_BYTES = 28;
const BATTLE_MOVE_BYTES = 12;
const SPECIES_NAME_BYTES = 11;
const MOVE_NAME_BYTES = 13;
const TRAINER_BYTES = 40;
const ITEM_BYTES = 44;
const TYPE_FORESIGHT = 0xfe;
const TYPE_ENDTABLE = 0xff;

function u16(bytes, offset = 0) { return bytes[offset] | (bytes[offset + 1] << 8); }
function u32(bytes, offset = 0) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }

export function createRomTables({ readMemory, manifest, charmap }) {
  if (typeof readMemory !== 'function') throw new TypeError('readMemory must be a function');
  const cache = new Map();
  const memo = (key, produce) => {
    if (!cache.has(key)) cache.set(key, Object.freeze(produce()));
    return cache.get(key);
  };
  const tables = {
    nationalSpecies(id) {
      if (!Number.isInteger(id) || id < 1 || id > 411 || !manifest.sSpeciesToNationalPokedexNum) return null;
      return memo(`national:${id}`, () => ({id:u16(readMemory(manifest.sSpeciesToNationalPokedexNum + (id-1)*2,2))})).id;
    },
    experienceAtLevel(species, level) {
      if (!Number.isInteger(level) || level < 1 || level > 100 || !manifest.gExperienceTables) return null;
      const growth = tables.species(species).growthRate;
      return u32(readMemory(manifest.gExperienceTables + (growth*101 + level)*4,4));
    },
    canLearnTM(species,itemId){
      const bit=itemId-289;if(!Number.isInteger(species)||species<1||species>411||!Number.isInteger(bit)||bit<0||bit>=58)return false;
      const bytes=readMemory(manifest.gTMHMLearnsets+species*8,8);
      return Boolean(bytes[Math.floor(bit/8)]&(1<<(bit%8)));
    },
    species(id) {
      return memo(`species:${id}`, () => {
        const b = readMemory(manifest.gSpeciesInfo + id * SPECIES_INFO_BYTES, SPECIES_INFO_BYTES);
        return {
          id,
          name: decodeGen3Text(readMemory(manifest.gSpeciesNames + id * SPECIES_NAME_BYTES, SPECIES_NAME_BYTES), charmap),
          baseStats: Object.freeze({ hp: b[0], attack: b[1], defense: b[2], speed: b[3], spAttack: b[4], spDefense: b[5] }),
          types: Object.freeze([b[6], b[7]]),
          catchRate: b[8],
          expYield: b[9],
          growthRate: b[0x13],
          abilities: Object.freeze([b[0x16], b[0x17]]),
        };
      });
    },
    move(id) {
      return memo(`move:${id}`, () => {
        const b = readMemory(manifest.gBattleMoves + id * BATTLE_MOVE_BYTES, BATTLE_MOVE_BYTES);
        return {
          id,
          name: decodeGen3Text(readMemory(manifest.gMoveNames + id * MOVE_NAME_BYTES, MOVE_NAME_BYTES), charmap),
          effect: b[0], power: b[1], type: b[2], accuracy: b[3], pp: b[4],
          secondaryEffectChance: b[5], target: b[6], priority: (b[7] << 24) >> 24, flags: b[8],
        };
      });
    },
    typeChart() {
      return memo('typeChart', () => {
        const rows = [];
        const bytes = readMemory(manifest.gTypeEffectiveness, 0x150);
        for (let offset = 0; offset + 2 < bytes.length; offset += 3) {
          const [attacker, defender, multiplier] = [bytes[offset], bytes[offset + 1], bytes[offset + 2]];
          if (attacker === TYPE_ENDTABLE) break;
          if (attacker === TYPE_FORESIGHT) continue;
          rows.push(Object.freeze({ attacker, defender, multiplier }));
        }
        return rows;
      });
    },
    /** Returns the ×10 effectiveness multiplier of an attack type against a defender's types. */
    effectiveness(attackType, defenderTypes) {
      let result = 10;
      const seen = new Set();
      for (const defender of defenderTypes) {
        if (seen.has(defender)) continue;
        seen.add(defender);
        for (const row of tables.typeChart()) {
          if (row.attacker === attackType && row.defender === defender) result = (result * row.multiplier) / 10;
        }
      }
      return result;
    },
    item(id) {
      return memo(`item:${id}`, () => {
        const b = readMemory(manifest.gItems + id * ITEM_BYTES, ITEM_BYTES);
        return {
          id,
          name: decodeGen3Text(b.subarray(0, 14), charmap),
          price: u16(b, 16),
          holdEffect: b[18],
          pocket: b[26],
          type: b[27],
          battleUsage: b[32],
        };
      });
    },
    trainer(id) {
      return memo(`trainer:${id}`, () => {
        const b = readMemory(manifest.gTrainers + id * TRAINER_BYTES, TRAINER_BYTES);
        const partyFlags = b[0];
        const partySize = b[32];
        const partyPointer = u32(b, 36);
        const customMoves = (partyFlags & 1) !== 0;
        const heldItem = (partyFlags & 2) !== 0;
        const entryBytes = customMoves ? (heldItem ? 16 : 14) : (heldItem ? 8 : 6);
        const party = [];
        if (partySize > 0 && partySize <= 6 && partyPointer >= 0x08000000 && partyPointer < 0x0a000000) {
          const raw = readMemory(partyPointer, partySize * entryBytes);
          for (let index = 0; index < partySize; index += 1) {
            const entry = raw.subarray(index * entryBytes, (index + 1) * entryBytes);
            const species = u16(entry, 4);
            const moves = customMoves ? [0, 1, 2, 3].map(slot => u16(entry, (heldItem ? 8 : 6) + slot * 2)) : [];
            party.push(Object.freeze({ iv: u16(entry, 0), level: entry[2], species, speciesName: tables.species(species).name, heldItem: heldItem ? u16(entry, 6) : 0, moves: Object.freeze(moves) }));
          }
        }
        return {
          id,
          name: decodeGen3Text(b.subarray(4, 16), charmap),
          trainerClass: b[1],
          doubleBattle: b[24] !== 0,
          aiFlags: u32(b, 28),
          items: Object.freeze([u16(b, 16), u16(b, 18), u16(b, 20), u16(b, 22)]),
          partySize,
          party: Object.freeze(party),
        };
      });
    },
  };
  tables.rotatingGates=()=>memo('rotating-gates',()=>readGateTables({readMemory,manifest}));
  return Object.freeze(tables);
}
