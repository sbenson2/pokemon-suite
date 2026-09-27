// A* over one map plus a map-graph planner across warps and connections.
import { DELTA, OPPOSITE, canStep, connectionArrival, nextElevation,arrowWarpDirection } from './world.mjs';

const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);

// field_player_avatar.c DoForcedMovement: a current chooses the next step
// before reading the D-pad. Control returns when that forced step collides.
function stepDirections(world,grid,node,blockers){
 const here=world.tile(grid,node.x,node.y),direction=world.rules.currents?.get(here?.behavior);
 if(!direction)return DIRECTIONS;
 const {dx,dy}=DELTA[direction],next=world.tile(grid,node.x+dx,node.y+dy);
 if(canStep(world.rules,here,next,direction,node.elevation,blockers))return [direction];
 return DIRECTIONS;
}

class MinHeap {
  #items = [];
  get size() { return this.#items.length; }
  push(item) {
    const items = this.#items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].f <= items[index].f) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }
  pop() {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1; const right = left + 1; let smallest = index;
        if (left < items.length && items[left].f < items[smallest].f) smallest = left;
        if (right < items.length && items[right].f < items[smallest].f) smallest = right;
        if (smallest === index) break;
        [items[smallest], items[index]] = [items[index], items[smallest]];
        index = smallest;
      }
    }
    return top;
  }
}

/**
 * Finds a walking path on one map grid. `isGoal(tile)` decides arrival, and
 * `goalDirection` (optional) requires the final step to enter in that direction.
 * Returns an array of { x, y, direction } steps (excluding the start) or null.
 */
export function findPath({ world, grid, start, isGoal, goalDirection = null, blockers = null, maxCost = 4000, heuristic = () => 0 }) {
  const rules = world.rules;
  const startTile = world.tile(grid, start.x, start.y);
  if (!startTile) return null;
  const startElevation = start.elevation ?? startTile.elevation;
  const key = (x, y, elevation) => `${x},${y},${elevation}`;
  const open = new MinHeap();
  const best = new Map();
  const startKey = key(start.x, start.y, startElevation);
  open.push({ f: 0, g: 0, x: start.x, y: start.y, elevation: startElevation, parent: null, direction: null });
  best.set(startKey, 0);
  while (open.size) {
    const node = open.pop();
    if (node.g > maxCost) break;
    const here = world.tile(grid, node.x, node.y);
    if (node.parent && isGoal(here, node)) {
      const steps = [];
      for (let cursor = node; cursor.parent; cursor = cursor.parent) steps.push(Object.freeze({ x: cursor.x, y: cursor.y, direction: cursor.direction, jump: cursor.jump === true }));
      return Object.freeze(steps.reverse());
    }
    if (!node.parent && isGoal(here, node)) return Object.freeze([]);
    if(node.parent&&(rules.doors.has(here.behavior)||rules.terminalWarps?.has(here.behavior)||rules.terminalCoords?.has(`${here.x},${here.y}`)))continue;
    for (const direction of stepDirections(world,grid,node,blockers)) {
      const { dx, dy } = DELTA[direction];
      let target = world.tile(grid, node.x + dx, node.y + dy);
      let jump = false;
      let cost = 1;
      if (target && rules.jumps[direction] === target.behavior) {
        const landing = world.tile(grid, node.x + dx * 2, node.y + dy * 2);
        if (!landing || landing.collision !== 0 || rules.water.has(landing.behavior)) continue;
        if (blockers?.has(`${landing.x},${landing.y}`)) continue;
        target = landing; jump = true; cost = 2;
      } else if (!canStep(rules, here, target, direction, node.elevation, blockers)) continue;
      if (goalDirection && isGoal(target, node) && direction !== goalDirection) continue;
      if (rules.tallGrass.has(target.behavior)) cost += 1;
      const elevation = nextElevation(node.elevation, target);
      const g = node.g + cost;
      const targetKey = key(target.x, target.y, elevation);
      if (best.has(targetKey) && best.get(targetKey) <= g) continue;
      best.set(targetKey, g);
      open.push({ f: g + heuristic(target), g, x: target.x, y: target.y, elevation, parent: node, direction, jump });
    }
  }
  return null;
}

export function pathToSegments(path) {
  const segments = [];
  for (const step of path) {
    const last = segments[segments.length - 1];
    if (last && last.direction === step.direction && !step.jump && !last.jump) { last.steps += 1; last.to = { x: step.x, y: step.y }; }
    else segments.push({ direction: step.direction, steps: 1, to: { x: step.x, y: step.y }, jump: step.jump });
  }
  return segments;
}

function manhattan(goal) {
  return (tile) => Math.abs(tile.x - goal.x) + Math.abs(tile.y - goal.y);
}

/** Exits of a map: warps (tile → destination map/tile) and connections (edge tiles). */
export function mapExits(world, geometry, grid=geometry) {
  const exits = [];
  if(geometry.holeDestination){
    const dest=world.geometry(geometry.holeDestination.group,geometry.holeDestination.number);
    for(let y=0;y<grid.height;y++)for(let x=0;x<grid.width;x++){
      const from=world.tile(grid,x,y),arrival=world.tile(dest,x,y);
      if(world.rules.holes?.has(from?.behavior)&&arrival&&!arrival.undefined&&arrival.collision===0)exits.push({kind:'fall',x,y,destination:{group:dest.group,number:dest.number,id:dest.id,x,y}});
    }
  }
  if(world.rules.canDive){
    const underwater=geometry.mapType===5||geometry.mapType==='MAP_TYPE_UNDERWATER',direction=underwater?'emerge':'dive';
    const connection=geometry.connections.find(c=>c.direction===direction),fixed=connection?null:geometry.fixedDiveWarp,edge=connection??fixed;
    if(edge){
      let destination=null;try{destination=world.geometry(edge.group,edge.number);}catch{}
      if(destination)for(let y=0;y<grid.height;y++)for(let x=0;x<grid.width;x++){
        const from=world.tile(grid,x,y);
        if(!from||from.collision!==0||from.undefined||world.rules.doors.has(from.behavior))continue;
        if(underwater?world.rules.cannotEmerge?.has(from.behavior):!world.rules.diveable?.has(from.behavior))continue;
        const arrival=world.tile(destination,fixed?.x??x,fixed?.y??y);
        if(!arrival||arrival.undefined||arrival.collision!==0)continue;
        exits.push({kind:'dive',x,y,button:underwater?'b':'a',direction,destination:{group:destination.group,number:destination.number,id:destination.id,x:arrival.x,y:arrival.y}});
      }
    }
  }
  for (const warp of geometry.warps) {
    if (warp.destGroup === 127 || warp.destNumber === 127) continue; // MAP_DYNAMIC
    let destination = null;
    try { destination = world.geometry(warp.destGroup, warp.destNumber); } catch { continue; }
    const arrival = destination.warps[warp.destWarpId] ?? null;
    if (!arrival) continue;
    const behavior = grid.behaviors[warp.y * grid.width + warp.x];
    const arrow = arrowWarpDirection(world.rules,behavior);
    const door = world.rules.doors.has(behavior);
    if(!door&&!arrow&&!world.rules.stepWarps?.has(behavior))continue;
    exits.push(Object.freeze({ kind: 'warp', x: warp.x, y: warp.y, door, arrow, destination: Object.freeze({ group: destination.group, number: destination.number, id: destination.id, x: arrival.x, y: arrival.y }) }));
  }
  for (const connection of geometry.connections) {
    if (!DELTA[connection.direction]) continue;
    let destination = null;
    try { destination = world.geometry(connection.group, connection.number); } catch { continue; }
    const edgeTiles = [];
    if (connection.direction === 'up' || connection.direction === 'down') {
      const y = connection.direction === 'up' ? 0 : geometry.height - 1;
      for (let x = 0; x < geometry.width; x += 1) {
        const arrival = connectionArrival(connection, x, y, destination);
        if (arrival.x < 0 || arrival.x >= destination.width) continue;
        edgeTiles.push({ x, y, arrival });
      }
    } else {
      const x = connection.direction === 'left' ? 0 : geometry.width - 1;
      for (let y = 0; y < geometry.height; y += 1) {
        const arrival = connectionArrival(connection, x, y, destination);
        if (arrival.y < 0 || arrival.y >= destination.height) continue;
        edgeTiles.push({ x, y, arrival });
      }
    }
    for (const edge of edgeTiles) {
      const arrivalTile = world.tile(destination, edge.arrival.x, edge.arrival.y);
      if (!arrivalTile || arrivalTile.collision !== 0 || (world.rules.water.has(arrivalTile.behavior)&&!(world.rules.canSurf&&world.rules.surfable?.has(arrivalTile.behavior)))) continue;
      exits.push(Object.freeze({ kind: 'connection', x: edge.x, y: edge.y, direction: connection.direction, destination: Object.freeze({ group: destination.group, number: destination.number, id: destination.id, x: edge.arrival.x, y: edge.arrival.y }) }));
    }
  }
  return exits;
}

/** Walking distances from `start` to every reachable tile on one grid (BFS with the same step rules as A*). */
export function floodDistances({ world, grid, start, blockers = null, maxTiles = 20000 }) {
  return floodReachable({world,grid,start,blockers,maxTiles}).distances;
}

function floodReachable({ world, grid, start, blockers = null, maxTiles = 20000 }) {
  const rules = world.rules;
  const startTile = world.tile(grid, start.x, start.y);
  const distances = new Map();
  const elevations = new Set();
  if (!startTile) return {distances,elevations};
  const queue = [{ x: start.x, y: start.y, elevation: start.elevation ?? startTile.elevation, g: 0 }];
  distances.set(`${start.x},${start.y}`, 0);
  elevations.add(`${start.x},${start.y},${queue[0].elevation}`);
  let head = 0;
  while (head < queue.length && head < maxTiles) {
    const node = queue[head++];
    const here = world.tile(grid, node.x, node.y);
    for (const direction of stepDirections(world,grid,node,blockers)) {
      const { dx, dy } = DELTA[direction];
      let target = world.tile(grid, node.x + dx, node.y + dy);
      if (!target) continue;
      let cost = 1;
      if (rules.jumps[direction] === target.behavior) {
        const landing = world.tile(grid, node.x + dx * 2, node.y + dy * 2);
        if (!landing || landing.collision !== 0 || rules.water.has(landing.behavior) || blockers?.has(`${landing.x},${landing.y}`)) continue;
        target = landing; cost = 2;
      } else if (!canStep(rules, here, target, direction, node.elevation, blockers)) continue;
      const key = `${target.x},${target.y}`;
      const elevation=nextElevation(node.elevation,target),stateKey=`${key},${elevation}`;
      if (elevations.has(stateKey)) continue;
      elevations.add(stateKey);
      if(!distances.has(key)||distances.get(key)>node.g+cost)distances.set(key, node.g + cost);
      if (rules.doors.has(target.behavior)||rules.terminalWarps?.has(target.behavior)||rules.terminalCoords?.has(key)) continue;
      queue.push({ x: target.x, y: target.y, elevation, g: node.g + cost });
    }
  }
  return {distances,elevations};
}

/**
 * Component-aware route across maps: a breadth-first search over
 * (map, arrival tile) states where each expansion only uses exits that are
 * actually walkable from that arrival tile. Returns the ordered hops
 * [{ map, arrival, exit }] ending on the target map, or null.
 */
export function mapRoute({ world, geometry, grid, start, target, blockers = null, blockersByMap = null, maxStates = 4000 }) {
  const key = (group, number, x, y, elevation) => `${group}:${number}:${x},${y},${elevation}`;
  const seenMaps = new Map();
  const queue = [{ geometry, grid, arrival: { x: start.x, y: start.y, elevation: start.elevation }, previous: null, exit: null, first: true }];
  let expanded = 0;
  while (queue.length && expanded < maxStates) {
    const state = queue.shift();
    const stateKey = key(state.geometry.group, state.geometry.number, state.arrival.x, state.arrival.y,state.arrival.elevation??world.tile(state.grid,state.arrival.x,state.arrival.y)?.elevation);
    if (seenMaps.has(stateKey)) continue;
    expanded += 1;
    seenMaps.set(stateKey, true);
    const {distances,elevations} = floodReachable({ world, grid: state.grid, start: state.arrival, blockers: new Set([...(state.first ? blockers??[] : []),...(blockersByMap?.get(`${state.geometry.group}:${state.geometry.number}`)??[])]) });
    // All arrivals in this reachable component share the same exits. Do not
    // charge every boundary tile against the map-search budget.
    // Current routes are directed: reaching another tile does not imply it
    // can return here and use this arrival's exits.
    if(!state.grid.behaviors.some(b=>world.rules.currents?.has(b)))for(const tileKey of elevations)seenMaps.set(`${state.geometry.group}:${state.geometry.number}:${tileKey}`,true);
    if (state.geometry.group === target.group && state.geometry.number === target.number) {
      const goal = `${target.x},${target.y}`;
      const adjacentReachable = [...DIRECTIONS].some(direction => distances.has(`${target.x - DELTA[direction].dx},${target.y - DELTA[direction].dy}`));
      if (distances.has(goal) || adjacentReachable || (state.arrival.x === target.x && state.arrival.y === target.y)) {
        const hops = [];
        for (let cursor = state; cursor; cursor = cursor.previous) hops.push({ group: cursor.geometry.group, number: cursor.geometry.number, id: cursor.geometry.id, arrival: cursor.arrival, exit: cursor.exit });
        return hops.reverse();
      }
    }
    for (const exit of mapExits(world, state.geometry,state.grid)) {
      if (!distances.has(`${exit.x},${exit.y}`)) continue;
      let destination = null;
      try { destination = world.geometry(exit.destination.group, exit.destination.number); } catch { continue; }
      const arrival = { x: exit.destination.x, y: exit.destination.y };
      const arrivalKey = key(destination.group, destination.number, arrival.x, arrival.y,world.tile(destination,arrival.x,arrival.y)?.elevation);
      if (seenMaps.has(arrivalKey)) continue;
      queue.push({ geometry: destination, grid: destination, arrival, previous: { ...state, exit }, exit: null, first: false });
    }
  }
  return null;
}

/** Breadth-first map sequence from one map to another through exits. */
export function mapSequence(world, from, to, { maxMaps = 400 } = {}) {
  const key = (group, number) => `${group}:${number}`;
  const target = key(to.group, to.number);
  const queue = [{ group: from.group, number: from.number }];
  const previous = new Map([[key(from.group, from.number), null]]);
  let visited = 0;
  while (queue.length && visited < maxMaps) {
    const current = queue.shift();
    visited += 1;
    const currentKey = key(current.group, current.number);
    if (currentKey === target) {
      const sequence = [];
      for (let cursor = currentKey; cursor; cursor = previous.get(cursor)) {
        const [group, number] = cursor.split(':').map(Number);
        sequence.push({ group, number });
      }
      return sequence.reverse();
    }
    let geometry = null;
    try { geometry = world.geometry(current.group, current.number); } catch { continue; }
    for (const exit of mapExits(world, geometry)) {
      const nextKey = key(exit.destination.group, exit.destination.number);
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, currentKey);
      queue.push({ group: exit.destination.group, number: exit.destination.number });
    }
  }
  return null;
}

/**
 * Plans the next leg toward a target map tile: a path on the current map and
 * the action that leaves the map (if the target is elsewhere).
 */
export function planLeg({ world, grid, geometry, start, target, blockers = null, blockersByMap = null }) {
  blockers=new Set([...(blockers??[]),...(blockersByMap?.get(`${geometry.group}:${geometry.number}`)??[])]);
  if (target.group === geometry.group && target.number === geometry.number) {
    const goal = { x: target.x, y: target.y };
    const path = findPath({ world, grid, start, isGoal: (tile) => tile.x === goal.x && tile.y === goal.y, goalDirection: target.direction ?? null, blockers, heuristic: manhattan(goal) });
    if(path)return Object.freeze({ kind: 'local', path, segments: pathToSegments(path), exit: null });
  }
  const hops = mapRoute({ world, geometry, grid, start, target, blockers, blockersByMap });
  if (!hops || hops.length < 2) return null;
  const firstExit = hops[0].exit;
  const sequence = hops.map(hop => ({ group: hop.group, number: hop.number }));
  const candidates = [firstExit];
  const byKey = new Map(candidates.map(exit => [`${exit.x},${exit.y}`, exit]));
  let path = findPath({
    world, grid, start, blockers,
    isGoal: (tile) => byKey.has(`${tile.x},${tile.y}`),
    heuristic: (tile) => Math.min(...candidates.map(exit => Math.abs(tile.x - exit.x) + Math.abs(tile.y - exit.y))),
  });
  if (!path) return null;
  if(!path.length&&firstExit.kind==='warp'&&world.rules.terminalWarps?.has(world.tile(grid,start.x,start.y)?.behavior)){
    const here=world.tile(grid,start.x,start.y);
    for(const direction of DIRECTIONS){
      const {dx,dy}=DELTA[direction],to=world.tile(grid,start.x+dx,start.y+dy);
      if(!to||world.rules.terminalWarps.has(to.behavior)||world.rules.doors.has(to.behavior))continue;
      if(!canStep(world.rules,here,to,direction,start.elevation??here.elevation,blockers))continue;
      if(!canStep(world.rules,to,here,OPPOSITE[direction],nextElevation(start.elevation??here.elevation,to),blockers))continue;
      path=[{x:to.x,y:to.y,direction},{x:start.x,y:start.y,direction:OPPOSITE[direction]}];break;
    }
    if(!path.length)return null;
  }
  const last = path[path.length - 1] ?? { x: start.x, y: start.y };
  const exit = byKey.get(`${last.x},${last.y}`);
  return Object.freeze({ kind: 'transit', path, segments: pathToSegments(path), exit, sequence: Object.freeze(sequence), remainingMaps: sequence.length - 1 });
}

export const NAVIGATION_DIRECTIONS = DIRECTIONS;
export { OPPOSITE };

export function findTrainingTile({world,grid,start=null,blockers=null}){
 const distances=start?floodDistances({world,grid,start,blockers}):null;
 let best=null;
 for(let y=0;y<grid.height;y++)for(let x=0;x<grid.width;x++){
  const tile=world.tile(grid,x,y);
  if(!tile||tile.collision!==0||!world.rules.tallGrass.has(tile.behavior))continue;
  const distance=distances?distances.get(`${x},${y}`):Math.abs(x-grid.width/2)+Math.abs(y-grid.height);
  if(distance!==undefined&&(!best||distance<best.distance))best={x,y,distance};
 }
 return best;
}
