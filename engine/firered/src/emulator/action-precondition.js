import {createHash} from 'node:crypto';
import {encodeButtons} from './mgba-session.js';

function cyclingRoadPullCell(observation, reasons) {
  const memory=observation.playerMemory??{};
  if(reasons.length===0||
    reasons.some(r=>!['battle-transition','callback-change','palette-fade','tile-transition','transient-callback'].includes(r))||
    (Number(memory.avatar?.flags)&6)===0)return false;
  const cell=memory.mapGrid?.cells?.find(c=>c.x===memory.position?.x&&c.y===memory.position?.y);
  return ['MB_CYCLING_ROAD_PULL_DOWN','MB_CYCLING_ROAD_PULL_DOWN_GRASS'].includes(cell?.behaviorName);
}

function fieldMotion(observation, action) {
  if (!observation) return false;
  const memory=observation.playerMemory??{},reasons=observation.phaseReasons??[];
  if(observation.phase!=='transition'||observation.emulator?.mode!=='overworld'||observation.emulator?.inBattle||
    Object.values(memory.ui??{}).some(Boolean)||memory.questLog?.playback||action?.kind!=='sustained-chord'||
    !Number.isSafeInteger(action.holdFrames)||action.holdFrames<1||action.holdFrames>8||action.releaseFrames!==0||
    !Array.isArray(action.buttons)||!action.buttons.length||action.buttons.some(b=>!['up','down','left','right','b'].includes(b)))return false;
  if(action.reason==='hold-cycling-road-brake-transition') {
    return action.buttons.length===1&&action.buttons[0]==='b'&&cyclingRoadPullCell(observation,reasons);
  }
  if(cyclingRoadPullCell(observation,reasons)) {
    // An owned slope chord may continue while its exact chord is still held;
    // the pull otherwise carries the bicycle away as soon as it is released.
    return action.buttons.some(b=>['up','down','left','right'].includes(b))&&
      Number.isSafeInteger(observation.emulator?.input?.heldKeysRaw)&&
      observation.emulator.input.heldKeysRaw===encodeButtons(action.buttons);
  }
  return ['continue-movement-lease-tile-transition','continue-running-tile-transition'].includes(action.reason)&&
    reasons.length===1&&reasons[0]==='tile-transition'&&
    observation.emulator?.input?.heldKeysRaw===encodeButtons(action.buttons);
}

function pokemonFacts(pokemon) {
  if (!pokemon) return null;
  return Object.fromEntries(['slot','species','personality','otId','level','hp','maxHp',
    'status','status1','status2','moves','pp','heldItem','item','ability','types','stats','statStages']
    .map(key=>[key,pokemon[key]]));
}

function retainedFieldKeys(observation) {
  const keys=observation?.emulator?.input?.heldKeysRaw;
  return observation?.phase==='stable'&&observation.emulator?.mode==='overworld'&&
    observation.emulator.inputReady===false&&!observation.emulator.inBattle&&
    observation.playerMemory?.battle==null&&!observation.playerMemory?.questLog?.playback&&
    Number.isSafeInteger(keys)&&keys>0&&keys<=0x3ff ? keys : null;
}

function surface(observation) {
  const memory = observation.playerMemory ?? {};
  const encounter = memory.encounter;
  const trainer = memory.trainer ?? {}, battle = memory.battle;
  // Bind the facts used by navigation, recipient selection, item use and battle
  // policy. A still-identical cursor is insufficient if its Pokemon moved slots
  // or the field/battle changed between observation and the sole input writer.
  // Exclude capture IDs, animation clocks and hashes of unrelated live RAM.
  const facts = [observation.emulator?.mode, observation.emulator?.inBattle,
    memory.map?.id, memory.position, memory.avatar?.facing, memory.avatar?.flags,
    memory.storyState, encounter?.validity, encounter?.pokemon?.species,
    encounter?.pokemon?.personality, encounter?.pokemon?.otId,
    trainer.partyValidity, trainer.party?.map(pokemonFacts), trainer.bag, trainer.money,
    memory.ui?.storage ? trainer.storage : null,
    battle && [battle.turn,battle.trainerId,battle.weather,battle.playerPartySlot,
      battle.battlerPartyIndexes,battle.monToSwitchIntoIds,battle.absentBattlerFlags,
      pokemonFacts(battle.player),pokemonFacts(battle.opponent),battle.battlers?.map(pokemonFacts)],
    memory.ui ?? {}];
  // Decision feeds and checkpoints carry the digest, not another full copy of
  // the party, bag and PC on every button press.
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

export function actionPrecondition(observation, action = null, {retainedInput = false} = {}) {
  const retainedKeys=retainedInput?retainedFieldKeys(observation):null;
  return { schema: "master-red/action-precondition/v2", frame: observation.frame,
    expiresFrame: observation.frame + 120, surface: surface(observation),
    ...(retainedKeys!==null?{retainedKeys}:{}),
    ...(fieldMotion(observation,action)?{motion:{buttons:[...action.buttons],reason:action.reason,
      phaseReasons:[...observation.phaseReasons]}}:{}) };
}

export function actionPreconditionMatches(expected, observation, action = null) {
  const ready=expected?.motion
    ? fieldMotion(observation,action)&&action.reason===expected.motion.reason&&
      JSON.stringify(action.buttons)===JSON.stringify(expected.motion.buttons)&&
      JSON.stringify(observation.phaseReasons)===JSON.stringify(expected.motion.phaseReasons)
    : observation?.phase==='stable'&&(observation.emulator?.inputReady===true||
      Number.isSafeInteger(expected?.retainedKeys)&&expected.retainedKeys>0&&
      expected.retainedKeys===retainedFieldKeys(observation));
  return expected?.schema === "master-red/action-precondition/v2" &&
    Number.isSafeInteger(expected.frame) && Number.isSafeInteger(expected.expiresFrame) &&
    expected.expiresFrame >= expected.frame && expected.expiresFrame - expected.frame <= 120 &&
    Number.isSafeInteger(observation?.frame) && observation.frame >= expected.frame &&
    observation.frame <= expected.expiresFrame && ready && expected.surface === surface(observation);
}
