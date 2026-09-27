// The central player: one observation in, one bounded program out. Advisors
// (battle, menus, dialog, story/navigation, recovery) only propose; this
// module rectifies precedence and maps the winner to controller input.
import { DELTA, OPPOSITE,arrowWarpDirection } from '../world.mjs';
import { planLeg,findTrainingTile,pathToSegments } from '../navigation.mjs';
import {routeRestrictions,adjacentFieldObstacle,fieldTravelWorld} from '../routing-constraints.mjs';
import { neutralProgram, pressProgram, routeProgram, sequenceProgram, walkProgram } from './controller.mjs';
import {inspectNativePartyItem} from './native-items.mjs';
import {surfaceApproach,waterfallApproach} from './field-travel.mjs';
import {planGatePath} from '../rotating-gates.mjs';
import {planStrengthPath} from '../strength.mjs';
import {planRotatingTilePath} from '../rotating-tiles.mjs';
import {inspectStevenPartySelection} from './party-selection.mjs';
import {planSootopolisIce} from '../ice-puzzle.mjs';
import {routeRecoveryProgram} from './navigation-recovery.mjs';
import {inspectNativeContinue} from './native-continue.mjs';

const NEIGHBOR_ORDER = Object.freeze(['down', 'up', 'left', 'right']);

function press(button, { hold = 2, release = 6 } = {}) { return pressProgram(button, { hold, release }); }

export function blockersFor(observation) {
  const blockers = new Set();
  for (const object of observation.objects) {
    if (object.isPlayer) continue;
    if (object.mapGroup !== observation.player.map.group || object.mapNum !== observation.player.map.number) continue;
    blockers.add(`${object.x},${object.y}`);
    blockers.add(`${object.previousX},${object.previousY}`);
  }
  return blockers;
}

export function createCentralPlayer({ world, tables, constants, story, battleAdvisor, tickets, log = () => {} }) {
  let sequence = 0;
  let namingPhase = 0;
  let pendingItem=null;
  const stalls = new Map();
  const extraBlockers = new Map();

  const decision = (advisor, recommendation, program, extra = {}) => {
    sequence += 1;
    return Object.freeze({ sequence, advisor, recommendation: Object.freeze(recommendation), action: program ? Object.freeze({ kind: program.kind, reason: program.reason ?? recommendation.kind }) : null, program, ...extra });
  };

  const resolveTarget = (observation, intent) => {
    const entry = constants.maps.get(intent.map);
    if (!entry) throw new Error(`unknown story map ${intent.map}`);
    return { group: entry.group, number: entry.number, x: intent.x, y: intent.y };
  };

  const navigate = (observation, target, { goalDirection = null, objectiveId = 'navigate' } = {}) => {
    const grid = world.liveGrid();
    const geometry = world.geometry(observation.player.map.group, observation.player.map.number);
    if (!grid) return null;
    const blockers = blockersFor(observation);
    for (const extra of extraBlockers.get(objectiveId) ?? []) blockers.add(extra);
    const start = { x: observation.player.position.x, y: observation.player.position.y, elevation: observation.player.elevation };
    const travel=fieldTravelWorld(world,observation),restrictions=routeRestrictions(constants,observation);
    if(observation.player.map.id==='MAP_SOOTOPOLIS_CITY_GYM_1F'&&objectiveId==='sootopolis-juan'&&observation.var('VAR_ICE_STEP_COUNT')<67){
      const path=planSootopolisIce({world,grid,start,stepCount:observation.var('VAR_ICE_STEP_COUNT'),constants,blockers});
      if(!path)return null;
      const segments=pathToSegments(path);
      return {leg:{kind:'local',path,segments,exit:null},program:sequenceProgram([routeProgram(segments,{reason:'native-ice-puzzle'}),neutralProgram(60,'native-ice-stairs')],'solve-native-ice')};
    }
    let leg = planLeg({ world:travel, grid, geometry, start, target: { ...target, direction: goalDirection }, blockers, blockersByMap:restrictions });
    if(observation.player.map.id==='MAP_MOSSDEEP_CITY_GYM'){
      const catalog=constants.maps.get('MAP_MOSSDEEP_CITY_GYM'),goal=target.group===geometry.group&&target.number===geometry.number?target:leg?.exit;
      if(!goal)return null;
      const objects=world.savedObjectTemplates().filter(p=>{const t=catalog.objects.find(t=>t.localId===p.localId);return t&&(!t.flag||!observation.flag(t.flag));}).map(p=>{
        const live=observation.objects.find(l=>!l.isPlayer&&l.localId===p.localId&&l.mapGroup===geometry.group&&l.mapNum===geometry.number);
        return live?{...p,x:live.x,y:live.y,elevation:live.elevation}:p;
      });
      const colors=['Yellow','Blue','Green','Purple','Red'];
      const switches=catalog.coordEvents.flatMap(e=>{const color=colors.findIndex(c=>e.script.endsWith(`${c}FloorSwitch`));return color<0?[]:[{x:e.x,y:e.y,color}];});
      const warps=geometry.warps.filter(w=>w.destGroup===geometry.group&&w.destNumber===geometry.number).map(w=>({x:w.x,y:w.y,destination:{x:geometry.warps[w.destWarpId].x,y:geometry.warps[w.destWarpId].y}}));
      const path=planRotatingTilePath({world,grid,start,target:goal,objects,switches,warps});
      if(!path)return null;
      const event=path.findIndex(step=>step.warp||step.switch!==undefined),part=event<0?path:path.slice(0,event+1),segments=pathToSegments(part);
      if(event>=0||target.group===geometry.group&&target.number===geometry.number){
        let program=segments.length?routeProgram(segments,{reason:'native-rotating-tile-puzzle'}):neutralProgram(4,'puzzle-arrival');
        if(event>=0&&path[event].switch!==undefined)program=sequenceProgram([program,neutralProgram(32,'native-statue-movement')],'rotate-native-statues');
        return {leg:{kind:'local',path:part,segments,exit:null},program};
      }
      leg={...leg,path,segments};
    }
    if(observation.flag('FLAG_BADGE04_GET')&&observation.party.some(p=>p.validity==='valid'&&!p.isEgg&&p.moves.some(m=>m.id===70))){
      const boulders=observation.objects.filter(o=>!o.isPlayer&&o.mapGroup===geometry.group&&o.mapNum===geometry.number&&o.graphicsId===constants.graphics.OBJ_EVENT_GFX_PUSHABLE_BOULDER);
      const smashable=observation.flag('FLAG_BADGE03_GET')&&observation.party.some(p=>p.validity==='valid'&&!p.isEgg&&p.moves.some(m=>m.id===249))?observation.objects.filter(o=>!o.isPlayer&&!o.invisible&&o.mapGroup===geometry.group&&o.mapNum===geometry.number&&o.graphicsId===constants.graphics.OBJ_EVENT_GFX_BREAKABLE_ROCK):[];
      if(boulders.length||smashable.length){
        const fixed=blockersFor({...observation,objects:observation.objects.filter(o=>!boulders.includes(o)&&!smashable.includes(o))});
        for(const key of restrictions.get(`${geometry.group}:${geometry.number}`)??[])fixed.add(key);
        const relaxed=planLeg({world:travel,grid,geometry,start,target:{...target,direction:goalDirection},blockers:fixed,blockersByMap:restrictions});
        // A static-map detour can return through this same unresolved barrier.
        // Prefer a solved local push when it shortens that apparent detour.
        const shorter=relaxed&&(!leg||(relaxed.remainingMaps??0)<(leg.remainingMaps??0)||relaxed.path.length<leg.path.length);
        const path=shorter?planStrengthPath({world:travel,grid,start,target:relaxed.kind==='transit'?relaxed.exit:target,boulders,smashable,blockers:fixed}):null;
        const pushIndex=path?.findIndex(step=>step.push||step.smash)??-1;
        if(pushIndex>=0){
          const approach=path.slice(0,pushIndex),segments=pathToSegments(approach),step=path[pushIndex];
          const localLeg={kind:'local',path:approach,segments,exit:null};
          if(approach.length)return {leg:localLeg,program:routeProgram(segments,{reason:'approach-strength-push'})};
          if(step.smash||!observation.flag('FLAG_SYS_USE_STRENGTH')){
            const programs=[];
            if(observation.player.facing!==step.direction)programs.push(walkProgram(step.direction,{turnOnly:true,reason:'face-boulder'}));
            programs.push(neutralProgram(4,'settle'),press('a',{release:10}));
            return {leg:localLeg,program:sequenceProgram(programs,step.smash?'native-rock-smash':'activate-native-strength')};
          }
          return {leg:localLeg,program:walkProgram(step.direction,{target:{x:step.x,y:step.y},maxFrames:180,stallFrames:120,reason:'native-strength-push'})};
        }
      }
    }
    if (!leg) return null;
    if(observation.player.map.id==='MAP_FORTREE_CITY_GYM'){
      const data=tables.rotatingGates(),orientations=data.config.map((_,i)=>(observation.var(`VAR_TEMP_${Math.floor(i/2)}`)>>((i%2)*8))&255);
      const path=planGatePath({world,grid,data,orientations,start,target:leg.kind==='transit'?leg.exit:target,blockers});
      if(!path)return null;
      leg={...leg,path,segments:pathToSegments(path)};
    }
    const surf=surfaceApproach({observation,world,grid,path:leg.path})??waterfallApproach({world,grid,path:leg.path,start});
    if(surf){
      const segments=pathToSegments(surf.path),programs=[];
      if(segments.length)programs.push(routeProgram(segments,{reason:'approach-surf-shore'}));
      else{
        if(observation.player.facing!==surf.face)programs.push(walkProgram(surf.face,{turnOnly:true,reason:'face-water'}));
        programs.push(neutralProgram(4,'settle'),press('a',{release:10}));
      }
      return {leg:{kind:'local',path:surf.path,segments,exit:null},program:sequenceProgram(programs,'native-surf')};
    }
    const programs = [];
    if (leg.segments.length) programs.push(routeProgram(leg.segments, { reason: leg.kind === 'transit' ? `transit:${leg.exit.destination.id}` : 'local-route' }));
    if (leg.kind === 'local') {
      // Arrow-warp tiles (including MAP_DYNAMIC exits such as the moving
      // truck) fire only while the direction is held on the tile.
      const targetTile = world.tile(grid, target.x, target.y);
      const arrow = targetTile ? arrowWarpDirection(world.rules,targetTile.behavior) : null;
      if (arrow) programs.push(walkProgram(arrow, { maxFrames: 60, reason: 'arrow-warp' }));
    }
    if (leg.kind === 'transit') {
      if(leg.exit.kind==='dive')programs.push(press(leg.exit.button,{release:12}));
      else if(leg.exit.kind==='fall')programs.push(neutralProgram(120,'native-floor-fall'));
      else if (leg.exit.kind === 'connection') programs.push(walkProgram(leg.exit.direction, { maxFrames: 90, reason: 'cross-connection' }));
      else if (leg.exit.arrow) programs.push(walkProgram(leg.exit.arrow, { maxFrames: 60, reason: 'arrow-warp' }));
      else if (!leg.exit.door && leg.segments.length === 0) programs.push(neutralProgram(30, 'warp-settle'));
    }
    return { leg, program: programs.length === 1 ? programs[0] : programs.length ? sequenceProgram(programs, 'navigate') : neutralProgram(8, 'already-there') };
  };

  const lastSeen = new Map();
  const ambushes = new Map();
  const interactProgram = (observation, intent, objectiveId) => {
    const target = resolveTarget(observation, intent);
    const onMap = observation.player.map.group === target.group && observation.player.map.number === target.number;
    const template=constants.maps.get(intent.map)?.objects?.find(object => intent.localId !== undefined
      ? object.localId === intent.localId : object.x === target.x && object.y === target.y);
    let objectTile = { x: target.x, y: target.y, elevation: template?.elevation };
    let moving = false;
    if (onMap && intent.localId !== undefined) {
      const live = observation.objects.find(object => !object.isPlayer && object.localId === intent.localId && object.mapNum === target.number && object.mapGroup === target.group);
      if (live) {
        objectTile = { x: live.x, y: live.y, elevation: live.elevation };
        const seenKey = `${target.group}:${target.number}:${intent.localId}`;
        const previous = lastSeen.get(seenKey);
        moving = (live.heldMovementActive && !live.heldMovementFinished) || (previous !== undefined && (previous.x !== live.x || previous.y !== live.y));
        lastSeen.set(seenKey, { x: live.x, y: live.y });
      }
    }
    const here = observation.player.position;
    // ObjectEventDoesElevationMatch: native interactions do not inherit the
    // movement exception for Surf dismounts. Zero is the only wildcard.
    const heightMatches = elevation => !Number.isInteger(elevation) ||
      !Number.isInteger(objectTile.elevation) || elevation === 0 ||
      objectTile.elevation === 0 || elevation === objectTile.elevation;
    if (onMap) {
      for (const direction of NEIGHBOR_ORDER) {
        const { dx, dy } = DELTA[direction];
        if (here.x + dx === objectTile.x && here.y + dy === objectTile.y && heightMatches(observation.player.elevation)) {
          const programs = [];
          if (observation.player.facing !== direction) programs.push(walkProgram(direction, { turnOnly: true, reason: 'face-object' }));
          programs.push(neutralProgram(4, 'settle'));
          programs.push(press('a', { hold: 2, release: 8 }));
          return { program: sequenceProgram(programs, 'interact'), detail: { facing: direction, object: objectTile } };
        }
      }
      if (moving) {
        // A patrolling NPC outruns a chase at equal walking speed: hold a tile
        // beside its current tile, face it, and press A until it walks in.
        const ambushKey = `${objectiveId}:${intent.localId}`;
        const ambush = ambushes.get(ambushKey);
        if (ambush && here.x === ambush.stand.x && here.y === ambush.stand.y && heightMatches(observation.player.elevation)) {
          const programs = [];
          if (observation.player.facing !== ambush.facing) programs.push(walkProgram(ambush.facing, { turnOnly: true, reason: 'face-ambush' }));
          for (let index = 0; index < 40; index += 1) programs.push(press('a', { hold: 2, release: 6 }));
          return { program: sequenceProgram(programs, 'ambush'), detail: { ambush: ambush.tile, stand: ambush.stand, facing: ambush.facing } };
        }
        const grid = world.liveGrid();
        for (const direction of NEIGHBOR_ORDER) {
          const { dx, dy } = DELTA[OPPOSITE[direction]];
          const stand = { x: objectTile.x + dx, y: objectTile.y + dy };
          const tile = world.tile(grid, stand.x, stand.y);
          if (!tile || tile.collision !== 0 || world.rules.water.has(tile.behavior) || !heightMatches(tile.elevation)) continue;
          if (observation.objects.some(object => !object.isPlayer && object.x === stand.x && object.y === stand.y)) continue;
          const navigation = navigate(observation, { group: target.group, number: target.number, x: stand.x, y: stand.y }, { objectiveId });
          if (!navigation) continue;
          ambushes.set(ambushKey, { tile: objectTile, stand, facing: direction });
          return { program: navigation.program, detail: { approach: stand, facing: direction, leg: navigation.leg.kind, ambushFor: objectTile } };
        }
      }
    }
    const grid = onMap ? world.liveGrid() : null;
    const preferred = intent.from ? [intent.from, ...NEIGHBOR_ORDER.filter(direction => direction !== intent.from)] : NEIGHBOR_ORDER;
    for (const direction of preferred) {
      const { dx, dy } = DELTA[OPPOSITE[direction]];
      const stand = { x: objectTile.x + dx, y: objectTile.y + dy };
      if (onMap) {
        const tile = world.tile(grid, stand.x, stand.y);
        if (!tile || tile.collision !== 0 || world.rules.water.has(tile.behavior) || !heightMatches(tile.elevation)) continue;
      }
      const navigation = navigate(observation, { group: target.group, number: target.number, x: stand.x, y: stand.y }, { objectiveId });
      if (navigation) return { program: navigation.program, detail: { approach: stand, facing: direction, leg: navigation.leg.kind } };
    }
    return null;
  };

  const storyDecision = (observation, context) => {
    const objective = story.current(observation);
    if (!objective) return decision('story', { kind: 'campaign-complete' }, neutralProgram(60, 'campaign-complete'));
    const intent = objective.plan(observation);
    const stallKey = objective.id;
    const lastResult = context.lastResult;
    if (lastResult && ['blocked', 'timeout'].includes(lastResult.status) && lastResult.position) {
      const count = (stalls.get(stallKey) ?? 0) + 1;
      stalls.set(stallKey, count);
      if (count >= 2 && lastResult.blockedTile) {
        if (!extraBlockers.has(stallKey)) extraBlockers.set(stallKey, new Set());
        extraBlockers.get(stallKey).add(lastResult.blockedTile);
      }
      if (count % 4 === 3) {
        const direction = NEIGHBOR_ORDER[count % NEIGHBOR_ORDER.length];
        return decision('recovery', { kind: 'recovery-step', objective: objective.id, direction, stalls: count }, routeRecoveryProgram(observation,direction,constants), { objective: objective.id });
      }
    }
    if (intent.kind === 'wait') return decision('story', { kind: 'wait', objective: objective.id, reason: intent.reason }, neutralProgram(30, 'story-wait'), { objective: objective.id });
    if (intent.kind === 'goto') {
      const target = resolveTarget(observation, intent);
      const navigation = navigate(observation, target, { goalDirection: intent.direction ?? null, objectiveId: objective.id });
      if (!navigation) {
        const count = (stalls.get(stallKey) ?? 0) + 1;
        stalls.set(stallKey, count);
        return decision('recovery', { kind: 'no-route', objective: objective.id, target, stalls: count }, routeRecoveryProgram(observation,NEIGHBOR_ORDER[count % 4],constants), { objective: objective.id });
      }
      return decision('navigation', { kind: navigation.leg.kind === 'transit' ? 'transit' : 'walk', objective: objective.id, target, segments: navigation.leg.segments.length, exit: navigation.leg.exit?.destination?.id ?? null }, navigation.program, { objective: objective.id });
    }
    if (intent.kind === 'interact-at') {
      const target = resolveTarget(observation, intent);
      const here = observation.player.position;
      const onMap = observation.player.map.group === target.group && observation.player.map.number === target.number;
      if (onMap && here.x === target.x && here.y === target.y) {
        const programs = [];
        if (observation.player.facing !== intent.facing) programs.push(walkProgram(intent.facing, { turnOnly: true, reason: 'face-counter' }));
        programs.push(neutralProgram(4, 'settle'), press('a', { hold: 2, release: 8 }));
        return decision('navigation', { kind: 'interact-at', objective: objective.id, facing: intent.facing, at: target }, sequenceProgram(programs, 'interact-at'), { objective: objective.id });
      }
      const navigation = navigate(observation, target, { objectiveId: objective.id });
      if (!navigation) {
        const count = (stalls.get(stallKey) ?? 0) + 1;
        stalls.set(stallKey, count);
        return decision('recovery', { kind: 'no-route', objective: objective.id, target, stalls: count }, routeRecoveryProgram(observation,NEIGHBOR_ORDER[count % 4],constants), { objective: objective.id });
      }
      return decision('navigation', { kind: navigation.leg.kind === 'transit' ? 'transit' : 'walk', objective: objective.id, target, segments: navigation.leg.segments.length, exit: navigation.leg.exit?.destination?.id ?? null }, navigation.program, { objective: objective.id });
    }
    if (intent.kind === 'train') {
      const entry = constants.maps.get(intent.map);
      const onMap = observation.player.map.group === entry.group && observation.player.map.number === entry.number;
      const grid = onMap ? world.liveGrid() : null;
      const geometry = world.geometry(entry.group, entry.number);
      const source = grid ?? geometry;
      const here = observation.player.position;
      const best=findTrainingTile({world,grid:source,start:onMap?{...here,elevation:observation.player.elevation}:null,blockers:onMap?blockersFor(observation):null});
      if (!best) return decision('recovery', { kind: 'no-grass', objective: objective.id, map: intent.map }, neutralProgram(30, 'no-grass'), { objective: objective.id });
      const standing = onMap ? world.tile(grid, here.x, here.y) : null;
      if (standing && world.rules.tallGrass.has(standing.behavior)) {
        const step = (stalls.get(stallKey) ?? 0) + 1;
        stalls.set(stallKey, step);
        const direction = NEIGHBOR_ORDER[step % 4];
        return decision('training', { kind: 'train-step', objective: objective.id, direction, untilLevel: intent.untilLevel, level: observation.party[0]?.level ?? null }, walkProgram(direction, { maxFrames: 40, stallFrames: 12, reason: 'train-step' }), { objective: objective.id });
      }
      const navigation = navigate(observation, { group: entry.group, number: entry.number, x: best.x, y: best.y }, { objectiveId: objective.id });
      if (!navigation) return decision('recovery', { kind: 'no-route', objective: objective.id, target: best }, walkProgram(NEIGHBOR_ORDER[(stalls.get(stallKey) ?? 0) % 4], { maxFrames: 30, stallFrames: 12, reason: 'no-route-probe' }), { objective: objective.id });
      return decision('training', { kind: 'train-approach', objective: objective.id, grass: { x: best.x, y: best.y }, untilLevel: intent.untilLevel, level: observation.party[0]?.level ?? null }, navigation.program, { objective: objective.id });
    }
    if (intent.kind === 'interact') {
      const result = interactProgram(observation, intent, objective.id);
      if (!result) {
        if (intent.puzzle && observation.player.map.id === intent.map) {
          const probe = puzzleProbe(observation, objective.id);
          if (probe) return probe;
        }
        const count = (stalls.get(stallKey) ?? 0) + 1;
        stalls.set(stallKey, count);
        return decision('recovery', { kind: 'no-approach', objective: objective.id, intent, stalls: count }, routeRecoveryProgram(observation,NEIGHBOR_ORDER[count % 4],constants), { objective: objective.id });
      }
      return decision('navigation', { kind: 'interact', objective: objective.id, ...result.detail }, result.program, { objective: objective.id });
    }
    return decision('story', { kind: 'unknown-intent', objective: objective.id }, neutralProgram(30, 'unknown-intent'), { objective: objective.id });
  };

  /**
   * Move replacement on the summary screen: the cursor starts at slot 0
   * (SwitchToMoveSelection) and DPAD_DOWN advances through the five entries,
   * the fifth being the new move (cancel). Forget the weakest move when the
   * new one is stronger; otherwise cancel learning.
   */
  const moveLearnDecision = (observation) => {
    if (observation.emulator.paletteFadeActive) return decision('menus', { kind: 'replace-move-wait' }, neutralProgram(4, 'replace-move-fade'));
    const summary = observation.menus.summaryScreen;
    const newMoveId = summary?.newMove || observation.menus.moveToLearn;
    const learner = summary && observation.party[summary.curMonIndex] ? observation.party[summary.curMonIndex] : (observation.battle ? observation.party[observation.battle.battlers.find(b => b.side === 'player')?.partyIndex ?? 0] : observation.party[0]);
    const value = (moveId) => { const info = tables.move(moveId); if (!info || info.power === 0) return 5; const stab = learner?.types.includes(info.type) ? 1.5 : 1; return info.power * stab * (info.accuracy === 0 ? 1 : info.accuracy / 100); };
    const current = (learner?.moves ?? []).map((move, index) => ({ index, id: move.id, name: move.name, value: value(move.id) }));
    const newValue = value(newMoveId);
    let slot = 4;
    if (current.length === 4) {
      const replaceable=current.filter(move=>![15,19,57,70,127,148,249,291].includes(move.id));
      const weakest = replaceable.reduce((min,move)=>!min||move.value<min.value?move:min,null);
      if (weakest&&newValue > weakest.value) slot = weakest.index;
    }
    const detail = { slot, cursor: summary?.cursor ?? null, newMove: tables.move(newMoveId)?.name ?? newMoveId, forget: slot === 4 ? null : current[slot]?.name ?? null, evidenceRefs: ['src/pokemon_summary_screen.c SwitchToMoveSelection/Task_HandleReplaceMoveInput'] };
    if (summary && summary.cursor !== slot) {
      // ChangeSelectedMove wraps across the five entries: UP from 0 lands on the new move (4).
      const button = slot === 4 ? 'up' : (summary.cursor < slot ? 'down' : 'up');
      return decision('menus', { kind: 'replace-move-cursor', button, ...detail }, press(button, { release: 8 }));
    }
    if (!summary) return decision('menus', { kind: 'replace-move-blind', ...detail }, sequenceProgram([...Array(slot).fill(null).map(() => press('down', { release: 8 })), press('a', { release: 12 })], 'replace-move'));
    return decision('menus', { kind: slot === 4 ? 'cancel-new-move' : 'replace-move', ...detail }, press('a', { release: 12 }));
  };

  let battleContext = { frame: 0, typeFlags: null, potionUses: 0 };
  const shopSession = { active: false };

  /**
   * Mart purchases by readback (src/shop.c): BUY/SELL/QUIT cursor in menu.c
   * sMenu, list position = selectedRow + scrollOffset, quantity in the
   * Task_BuyHowManyDialogueHandleInput task data[1] (DPAD ±1, ±10).
   */
  const shopDecision = (observation) => {
    const mapId = observation.player?.map.id;
    const remaining = story.shoppingRemaining(observation, mapId);
    const shop = observation.menus.shop;
    if (observation.hasTask('Task_BuyHowManyDialogueHandleInput') && shop) {
      const entry = remaining.find(item => shop.items[shop.selectedRow + shop.scrollOffset] === item.itemId) ?? remaining[0];
      const want = Math.max(1, Math.min(entry?.quantity ?? 1, shop.maxQuantity || 99));
      const count = shop.quantity ?? 1;
      if (count === want) return decision('shop', { kind: 'shop-quantity-confirm', quantity: count, item: entry?.item ?? null }, press('a', { release: 12 }));
      const delta = want - count;
      const button = delta >= 10 ? 'right' : delta > 0 ? 'up' : delta <= -10 ? 'left' : 'down';
      return decision('shop', { kind: 'shop-quantity', quantity: count, want, button }, press(button, { release: 6 }));
    }
    if (observation.menus.yesNoActive) return decision('shop', { kind: 'shop-yes', cursor: observation.menus.menuCursor }, press(observation.menus.menuCursor === 0 ? 'a' : 'up', { release: 10 }));
    if (observation.hasTask('Task_BuyMenu') && shop) {
      const current = shop.selectedRow + shop.scrollOffset;
      const wanted = remaining.map(item => ({ ...item, index: shop.items.indexOf(item.itemId) })).filter(item => item.index >= 0);
      if (!wanted.length) return decision('shop', { kind: 'shop-leave-buy-menu' }, press('b', { release: 12 }));
      const target = wanted[0];
      if (current === target.index) return decision('shop', { kind: 'shop-select-item', item: target.item, quantity: target.quantity }, press('a', { release: 12 }));
      return decision('shop', { kind: 'shop-list-cursor', current, target: target.index, item: target.item }, press(current < target.index ? 'down' : 'up', { release: 8 }));
    }
    if (observation.hasTask('Task_ShopMenu')) {
      const cursor = observation.menus.menuCursor;
      const want = remaining.length ? 0 : 2; // BUY / SELL / QUIT
      if (cursor === want) return decision('shop', { kind: want === 0 ? 'shop-buy' : 'shop-quit', remaining: remaining.length }, press('a', { release: 12 }));
      return decision('shop', { kind: 'shop-menu-cursor', cursor, want }, press(cursor < want ? 'down' : 'up', { release: 8 }));
    }
    if (observation.hasTask('Task_ReturnToItemListAfterItemPurchase')) return decision('shop', { kind: 'shop-purchase-message' }, press('a', { hold: 2, release: 8 }));
    if (observation.hasTask('Task_ReturnToShopMenu') || observation.hasTask('Task_ExitBuyMenu') || observation.hasTask('Task_HandleShopMenuBuy')) return decision('shop', { kind: 'shop-transition' }, neutralProgram(4, 'shop-transition'));
    // Field messages ("Is there anything else?", "How many?") hand off to a menu the
    // moment they close: one press with a long release so the next decision sees the menu.
    if (observation.hasTask('Task_ContinueTaskAfterMessagePrints') || observation.script.textPrinterActive) return decision('shop', { kind: 'shop-message' }, press('a', { hold: 2, release: 24 }));
    return decision('shop', { kind: 'shop-settle' }, neutralProgram(4, 'shop-settle'));
  };

  /** When a map has no route to the target, step on the nearest unvisited coord-event tile (gym floor switches, etc.). */
  const probed = new Map();
  const puzzleProbe = (observation, objectiveId) => {
    const map = observation.player.map;
    const geometry = world.geometry(map.group, map.number);
    const grid = world.liveGrid();
    if (!grid || !geometry.coordEvents.length) return null;
    const key = `${map.group}:${map.number}`;
    if (!probed.has(key)) probed.set(key, new Set());
    const visited = probed.get(key);
    const here = observation.player.position;
    const candidates = geometry.coordEvents.filter(event => !visited.has(`${event.x},${event.y}`) && !(event.x === here.x && event.y === here.y)).map(event => ({ event, distance: Math.abs(event.x - here.x) + Math.abs(event.y - here.y) })).sort((a, b) => a.distance - b.distance);
    for (const { event } of candidates) {
      const navigation = navigate(observation, { group: map.group, number: map.number, x: event.x, y: event.y }, { objectiveId });
      if (!navigation) { visited.add(`${event.x},${event.y}`); continue; }
      visited.add(`${event.x},${event.y}`);
      if (visited.size >= geometry.coordEvents.length) visited.clear();
      return decision('recovery', { kind: 'puzzle-probe', objective: objectiveId, tile: { x: event.x, y: event.y } }, navigation.program, { objective: objectiveId });
    }
    return null;
  };

  return Object.freeze({
    get sequence() { return sequence; },
    decide(observation, context = {}) {
      const mode = observation.emulator.mode;
      const continuation=inspectNativeContinue(observation);
      if(continuation)return decision('continuation',continuation,continuation.button?press(continuation.button,{release:12}):neutralProgram(12,'native-continue-wait'));
      if(!observation.battle&&mode!=='battle'){
        const intent=story.current(observation)?.plan(observation);
        if(!pendingItem&&['teach-move','restore','level-up'].includes(intent?.kind)&&(observation.fieldReady||observation.menus.startMenu||['bag','party-menu','summary','berry-tag'].includes(mode)||mode==='evolution'&&intent.kind==='level-up'))pendingItem=intent;
        if(pendingItem){
          const next=inspectNativePartyItem(observation,pendingItem);
          if(next.kind==='complete')pendingItem=null;
          else return decision('native-item',{...next,kind:next.kind==='stop'?'native-item-blocked':pendingItem.kind==='restore'?'restore-party':pendingItem.kind==='level-up'?'native-evolution-item':'teach-field-move'},next.button?press(next.button,{release:10}):neutralProgram(8,'native-item-wait'));
        }
      }
      if (observation.hasTask('Task_HandleReplaceMoveInput')) return moveLearnDecision(observation);
      if (mode === 'battle' || observation.battle) {
        if (!battleContext.frame || !observation.battle || battleContext.typeFlags !== observation.battle.typeFlags || observation.frame - battleContext.frame > 6000) battleContext = { frame: observation.frame, typeFlags: observation.battle?.typeFlags, potionUses: 0 };
        battleContext.frame = observation.frame;
        const advice = battleAdvisor.advise(observation, { captureTargets: story.captureTargets(observation), potionUses: battleContext.potionUses });
        if (!advice) return decision('battle', { kind: 'battle-wait' }, neutralProgram(6, 'battle-wait'));
        if (advice.itemUse) battleContext.potionUses += 1;
        return decision('battle', advice, press(advice.button, { hold: 2, release: (advice.cadence ?? 8) - 2 }));
      }
      const shopping = story.shoppingRemaining(observation, observation.player?.map.id).length > 0 || shopSession.active;
      if (mode === 'shop' || ['Task_ShopMenu', 'Task_BuyMenu', 'Task_BuyHowManyDialogueHandleInput', 'Task_ReturnToShopMenu', 'Task_ExitBuyMenu', 'Task_HandleShopMenuBuy', 'Task_ReturnToItemListAfterItemPurchase'].some(task => observation.hasTask(task)) || (shopSession.active && observation.hasTask('Task_ContinueTaskAfterMessagePrints'))) {
        shopSession.active = !observation.hasTask('Task_ShopMenu') || story.shoppingRemaining(observation, observation.player?.map.id).length > 0 || true;
        if (observation.hasTask('Task_ShopMenu') && observation.menus.menuCursor === 2 && story.shoppingRemaining(observation, observation.player?.map.id).length === 0) shopSession.active = false;
        return shopDecision(observation);
      }
      if (mode === 'starter-choice') {
        const confirm = observation.task('Task_HandleConfirmStarterInput');
        if (confirm) return decision('opening', { kind: 'starter-confirm' }, press('a', { release: 12 }));
        const choose = observation.task('Task_HandleStarterChooseInput');
        if (choose) {
          const selection = choose.data[0];
          if (selection === tickets.starterTicket) return decision('opening', { kind: 'starter-select', selection }, press('a', { release: 12 }));
          return decision('opening', { kind: 'starter-cursor', selection, target: tickets.starterTicket }, press(selection < tickets.starterTicket ? 'right' : 'left', { release: 12 }));
        }
        return decision('opening', { kind: 'starter-wait' }, neutralProgram(6, 'starter-wait'));
      }
      if (mode === 'naming-screen') {
        namingPhase += 1;
        const button = namingPhase % 2 === 1 ? 'start' : 'a';
        return decision('menus', { kind: 'naming-screen', button }, press(button, { hold: 2, release: 28 }));
      }
      if (mode === 'wall-clock') {
        // src/wallclock.c Task_SetClock_AskConfirm creates the YES/NO menu with the cursor on NO (initialCursorPos 1); DPAD_UP never wraps.
        if (observation.hasTask('Task_SetClock_HandleConfirmInput')) return decision('menus', { kind: 'clock-confirm-yes' }, sequenceProgram([press('up', { release: 8 }), press('a', { release: 12 })], 'clock-confirm-yes'));
        if (observation.hasTask('Task_SetClock_HandleInput')) return decision('menus', { kind: 'clock-accept' }, press('a', { release: 12 }));
        return decision('menus', { kind: 'clock-wait' }, neutralProgram(6, 'clock-wait'));
      }
      if (mode === 'evolution') return decision('menus', { kind: 'evolution-wait' }, neutralProgram(12, 'evolution'));
      if (mode === 'pokenav') {
        // Forced Match Call tutorial (src/pokenav_menu_handler.c): only Match
        // Call (cursor 2) accepts A while FORCE_CALL_READY; after the call
        // only B / Switch Off leave. A blind cycle covers both states.
        const cycle = ['down', 'down', 'a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', 'b'];
        return decision('menus', { kind: 'pokenav-cycle' }, sequenceProgram(cycle.map(button => press(button, { hold: 2, release: 22 })), 'pokenav-cycle'));
      }
      if (observation.hasTask('Task_HandleReplaceMoveInput')) return moveLearnDecision(observation);
      if (mode === 'party-menu' || mode === 'bag' || mode === 'summary' || mode === 'berry-tag') {
        const steven=mode==='party-menu'?inspectStevenPartySelection(observation):null;
        if(steven)return decision('menus',steven,steven.button?press(steven.button,{release:10}):neutralProgram(4,'steven-party-settle'));
        if (observation.hasTask('Task_HandleReplaceMoveYesNoInput') || observation.hasTask('Task_HandleStopLearningMoveYesNoInput')) return decision('menus', { kind: 'learn-move-yes' }, press('a', { release: 10 }));
        return decision('menus', { kind: `${mode}-back`, }, press('b', { release: 10 }));
      }
      if (mode !== 'overworld') return decision('menus', { kind: `${mode}-wait` }, neutralProgram(8, mode));
      if (observation.dialogActive) {
        if (observation.menus.multichoice.active) {
          const target = Math.min(story.multichoice(observation), Math.max(observation.menus.multichoice.max, 0));
          const cursor = observation.menus.multichoice.cursor;
          if (cursor === target) return decision('dialog', { kind: 'multichoice-select', choice: target }, press('a', { release: 10 }));
          return decision('dialog', { kind: 'multichoice-cursor', choice: target, cursor }, press(cursor < target ? 'down' : 'up', { release: 8 }));
        }
        if (observation.menus.yesNoActive) return decision('dialog', { kind: 'yes-no', answer: 'yes' }, press('a', { release: 10 }));
        return decision('dialog', { kind: 'advance-text' }, press('a', { hold: 2, release: 6 }));
      }
      if (!observation.fieldReady) return decision('field', { kind: 'field-settle' }, neutralProgram(4, 'field-settle'));
      // Emerald relocates the save blocks around battles and map loads; an
      // uncatalogued map id means the pointer was caught mid-move.
      if (!observation.player.map.id) return decision('field', { kind: 'unstable-observation' }, neutralProgram(4, 'unstable-observation'));
      const obstacle=adjacentFieldObstacle(constants,observation);
      if(obstacle){const result=interactProgram(observation,obstacle,'clear-field-obstacle');if(result)return decision('navigation',{kind:'clear-field-obstacle',localId:obstacle.localId},result.program);}
      return storyDecision(observation, context);
    },
  });
}
