// Goldenrod Underground switch room (maps/GoldenrodUndergroundSwitchRoomEntrances.asm).
//
// Three switches and an EMERGENCY switch drive wUndergroundSwitchPositions:
// switch n adds n while turning on (addval 1/2/3) and subtracts it turning
// off, so the position is always S1 + 2·S2 + 3·S3; the emergency switch writes
// 7 (and sets every switch flag) or 0 (and clears them). Each position then
// opens and closes a fixed set of doors (UpdateDoors .PositionN) and leaves
// the rest as they were, so the doors depend on the press history — which the
// EVENT_DOOR_n_OPEN flags record exactly. This module replays that logic to
// find the presses that open a way to the warehouse warp from wherever the
// player stands.

import { createMapGrid, findRoute } from '../world/grid.mjs';
import { eventOpenings } from './navigation.mjs';

export const SWITCH_ROOM = 'GOLDENROD_UNDERGROUND_SWITCH_ROOM_ENTRANCES';
export const WAREHOUSE = 'GOLDENROD_UNDERGROUND_WAREHOUSE';
/** Where the basement door (GOLDENROD_UNDERGROUND warp 6) drops the player. */
export const SWITCH_ROOM_ENTRY = Object.freeze({ x: 23, y: 3 });
/** The tile below the warehouse warps (22,10)/(23,10). */
export const WAREHOUSE_WARP_APPROACH = Object.freeze({ x: 22, y: 11 });

/** bg_event tiles and the tile the player reads them from (facing up). */
export const SWITCHES = Object.freeze({
  1: Object.freeze({ event: 'EVENT_SWITCH_1', tile: { x: 16, y: 1 }, stand: { x: 16, y: 2 } }),
  2: Object.freeze({ event: 'EVENT_SWITCH_2', tile: { x: 10, y: 1 }, stand: { x: 10, y: 2 } }),
  3: Object.freeze({ event: 'EVENT_SWITCH_3', tile: { x: 2, y: 1 }, stand: { x: 2, y: 2 } }),
  E: Object.freeze({ event: 'EVENT_EMERGENCY_SWITCH', tile: { x: 20, y: 11 }, stand: { x: 20, y: 12 } }),
});

// UpdateDoors .Position0–.Position6 and .EmergencyPosition (7): [open, close].
const POSITIONS = Object.freeze({
  0: [[], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  1: [[1, 7, 10], [6, 8, 9, 11]],
  2: [[2, 8, 9], [5, 7, 10, 11]],
  3: [[3, 7, 10], [4, 8, 9, 11]],
  4: [[4, 8, 9], [3, 7, 10, 11]],
  5: [[5, 7, 10], [2, 8, 11]],
  6: [[6, 8, 9, 11], [1, 7, 10]],
  7: [[3, 5, 6, 8, 9, 11], [1, 2, 4, 7, 10]],
});

/** Switch and door state read from the event flags. */
export function readSwitchRoom(hasEvent) {
  return {
    switches: { 1: hasEvent('EVENT_SWITCH_1'), 2: hasEvent('EVENT_SWITCH_2'), 3: hasEvent('EVENT_SWITCH_3'), E: hasEvent('EVENT_EMERGENCY_SWITCH') },
    doors: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((n) => hasEvent(`EVENT_DOOR_${n}_OPEN`))),
  };
}

const applyPosition = (doors, position) => {
  const [open, close] = POSITIONS[position];
  const next = new Set(doors);
  for (const n of open) next.add(n);
  for (const n of close) next.delete(n);
  return next;
};

/** The state after pressing `which` (1, 2, 3 or 'E') and answering YES. */
export function pressSwitch(state, which) {
  const switches = { ...state.switches };
  if (which === 'E') {
    const on = !switches.E;
    switches.E = on; switches[1] = on; switches[2] = on; switches[3] = on;
    return { switches, doors: applyPosition(state.doors, on ? 7 : 0) };
  }
  switches[which] = !switches[which];
  const position = (switches[1] ? 1 : 0) + (switches[2] ? 2 : 0) + (switches[3] ? 3 : 0);
  return { switches, doors: applyPosition(state.doors, position) };
}

const hasEventFor = (state) => (flag) => {
  const door = /^EVENT_DOOR_(\d+)_OPEN$/.exec(flag);
  if (door) return state.doors.has(Number(door[1]));
  const which = Object.keys(SWITCHES).find((k) => SWITCHES[k].event === flag);
  return which !== undefined && state.switches[which] === true;
};

const encode = (state, at) => `${[1, 2, 3, 'E'].map((k) => (state.switches[k] ? 1 : 0)).join('')}|${[...state.doors].sort((a, b) => a - b).join(',')}|${at.x},${at.y}`;

/**
 * Presses that open a way from `from` (a switch-room tile) to `goal` (the
 * warehouse warp by default; the basement-door entry to leave):
 * `{ presses: [{ which, stand, tile }], reachable }`. `presses` is empty
 * when the warp is already reachable; `null` when no sequence of at most
 * `maximumPresses` reachable presses works.
 */
export function planSwitchRoom(world, from, hasEvent, { maximumPresses = 8, blockers = [], goal = WAREHOUSE_WARP_APPROACH } = {}) {
  const start = { state: readSwitchRoom(hasEvent), at: { x: from.x, y: from.y }, presses: [] };
  const gridFor = (state) => createMapGrid(world, SWITCH_ROOM, { blockers, openings: eventOpenings(SWITCH_ROOM, hasEventFor(state)) });
  const reaches = (grid, at, goal) => (at.x === goal.x && at.y === goal.y) || findRoute(grid, at, goal) !== null;
  const seen = new Set([encode(start.state, start.at)]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift();
    const grid = gridFor(node.state);
    if (reaches(grid, node.at, goal)) return { presses: node.presses, reachable: true };
    if (node.presses.length >= maximumPresses) continue;
    for (const which of [3, 2, 1, 'E']) {
      const entry = SWITCHES[which];
      if (!reaches(grid, node.at, entry.stand)) continue;
      const state = pressSwitch(node.state, which);
      const code = encode(state, entry.stand);
      if (seen.has(code)) continue;
      seen.add(code);
      queue.push({ state, at: entry.stand, presses: [...node.presses, { which, stand: entry.stand, tile: entry.tile }] });
    }
  }
  return null;
}
