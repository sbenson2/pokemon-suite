import {dataOf, indexed} from './mechanics-data.js';

const MAJOR_TRAINER_CLASSES = new Set([
  'TRAINER_CLASS_LEADER', 'TRAINER_CLASS_BOSS', 'TRAINER_CLASS_ELITE_FOUR',
  'TRAINER_CLASS_CHAMPION', 'TRAINER_CLASS_RIVAL_EARLY', 'TRAINER_CLASS_RIVAL_LATE',
]);
// These story encounters use ordinary trainer classes in the cartridge.
// Names resolve through the selected game's mechanics data, never display text.
const STORY_TRAINERS = new Set([
  'TRAINER_BLACK_BELT_KOICHI',
  'TRAINER_TEAM_ROCKET_GRUNT_19', 'TRAINER_TEAM_ROCKET_GRUNT_20',
  'TRAINER_TEAM_ROCKET_GRUNT_21',
  'TRAINER_BIKER_GOON', 'TRAINER_BIKER_GOON_2', 'TRAINER_BIKER_GOON_3',
  'TRAINER_CUE_BALL_PAXTON', 'TRAINER_TEAM_ROCKET_GRUNT_45',
  'TRAINER_TEAM_ROCKET_ADMIN', 'TRAINER_TEAM_ROCKET_ADMIN_2',
  'TRAINER_SCIENTIST_GIDEON',
]);

export function isMajorBattle(observation, mechanics) {
  if (observation?.emulator?.mode !== 'battle' && !observation?.emulator?.inBattle) return false;
  const memory = observation?.playerMemory;
  const flags = Number(memory?.battleTypeFlags) >>> 0;
  // The ghost Marowak is a scripted wild battle, not a capture/training target.
  if ((flags & (1 << 15)) !== 0 && memory?.map?.id === 'MAP_POKEMON_TOWER_6F' &&
      Number(memory?.battle?.opponent?.species) === 105) return true;
  if ((flags & (1 << 3)) === 0) return false;
  // Tower opponents are built dynamically and need not have a normal trainer
  // table ID. Their native battle flag identifies the serious encounter.
  if ((flags & (1 << 19)) !== 0) return true;
  const trainer = indexed(dataOf(mechanics).trainers, memory?.battle?.trainerId);
  return Boolean(trainer && (MAJOR_TRAINER_CLASSES.has(trainer.trainerClass) ||
    STORY_TRAINERS.has(trainer.name)));
}
