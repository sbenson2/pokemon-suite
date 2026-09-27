// Shared Emerald player runtime: boots the verified cartridge on the pinned
// core, wires observer → central delegator → controller, and exposes one
// synchronous stepFrame() so the CLI runner and real-ROM tests share a loop.
import { readVerifiedCartridge } from '../../../shared/cartridge.js';
import { createPinnedMultiSystemSession } from '../../../shared/pinned-mgba.js';
import { EMERALD_PROFILE, getStarterTeam, chooseStarter } from '../catalog.mjs';
import { loadRuntimeManifest } from '../runtime-symbols.mjs';
import { loadEmeraldConstants } from '../constants.mjs';
import { loadCharmap } from '../text.mjs';
import { createRomTables } from '../rom-tables.mjs';
import { createEmeraldObserver } from '../observation.mjs';
import { createWorld } from '../world.mjs';
import { createStory } from '../story.mjs';
import { createBattleAdvisor } from '../battle.mjs';
import { createCentralPlayer } from './delegator.mjs';
import { createController,pressProgram,neutralProgram } from './controller.mjs';
import {inspectNativeContinue} from './native-continue.mjs';
import {createNativeSave} from './native-save.mjs';
import { createFreshOpeningInputPlanner } from '../opening.mjs';

export async function createEmeraldRuntime({ romPath, coreDirectory, tickets, state = null, sram = null, session: owningSession = null, teamPlan = undefined, onDecision = () => {}, onBootStage = () => {} }) {
  if (owningSession && (state || sram)) throw new Error('Attach the Emerald player to its current owner without loading another save.');
  const [manifest, constants, charmap] = await Promise.all([loadRuntimeManifest(), loadEmeraldConstants(), loadCharmap()]);
  onBootStage('knowledge-loaded', { maps: constants.maps.byId.size });
  const cartridge = await readVerifiedCartridge({ id: 'pokemon-emerald-us', path: romPath, bytes: EMERALD_PROFILE.rom.byteLength, sha1: EMERALD_PROFILE.rom.sha1 });
  onBootStage('cartridge-verified', { sha1: cartridge.identity.sha1 });
  if (owningSession && (owningSession.identity.cartridgeSha1 ?? owningSession.identity.romSha1) !== cartridge.identity.sha1) throw new Error('The existing session is not the verified Emerald cartridge.');
  const session = owningSession ?? await createPinnedMultiSystemSession({ coreDirectory, cartridge, system: 'gba' });
  onBootStage('core-booted', { mgbaCommit: session.identity.mgbaCommit });
  if (sram) session.loadSram(sram);
  if (state) session.loadState(state);
  const read = (address, length) => session.readMemory(address, length);
  const tables = createRomTables({ readMemory: read, manifest, charmap });
  const observer = createEmeraldObserver({ readMemory: read, manifest, constants, tables, charmap, frameOf: () => session.frame });
  const world = createWorld({ readMemory: read, manifest, constants });
  const story = createStory({ constants, tables, teamPlan: teamPlan === undefined ? getStarterTeam(chooseStarter(tickets.starterTicket)) : teamPlan });
  const player = createCentralPlayer({ world, tables, constants, story, battleAdvisor: createBattleAdvisor({ tables, constants }), tickets });
  const controller = createController();
  const opening = createFreshOpeningInputPlanner(tickets, manifest);
  let reachedField = false;
  let decisions = 0;
  let lastDecision = null;
  let lastObservation = null;
  let context = { lastResult: null };

  const stepButtons = () => {
    const tick = observer.tick();
    if (controller.idle) {
      const observation = observer.observe();
      lastObservation = observation;
      if (!reachedField && (observation.is('CB2_Overworld') || observation.emulator.mode === 'battle'||((state||owningSession)&&['party-menu','bag','summary','berry-tag'].includes(observation.emulator.mode)))) reachedField = true;
      if (!reachedField) {
        const continuation=(sram||owningSession)&&inspectNativeContinue(observation);
        if(continuation){
          if(continuation.kind==='stop')throw new Error(continuation.reason);
          controller.start(continuation.button?pressProgram(continuation.button,{hold:2,release:12}):neutralProgram(8));
          return controller.tick(tick);
        }
        return opening.buttonsFor({ callback2: observation.emulator.callback2, taskFunctions: observation.tasks.map(task => task.func) });
      }
      const decision = player.decide(observation, context);
      decisions += 1;
      lastDecision = decision;
      const previous = context.lastResult;
      context = { lastResult: null };
      onDecision({ decision, observation, frame: session.frame, decisions, lastResult: previous });
      if (decision.program) controller.start(decision.program);
    }
    const buttons = controller.tick(tick);
    if (controller.idle && controller.lastResult) context.lastResult = controller.lastResult;
    return buttons;
  };

  return Object.freeze({
    session, observer, world, story, player, controller, tables, constants, manifest, cartridge,
    get decisions() { return decisions; },
    get lastDecision() { return lastDecision; },
    get lastObservation() { return lastObservation; },
    get reachedField() { return reachedField; },
    stepButtons,
    createActivityController:()=>createController(),
    inputProgram:(buttons,hold=3,release=30)=>buttons.length?pressProgram(buttons[0],{hold,release}):neutralProgram(hold),
    createActivityPlayer:activityStory=>createCentralPlayer({world,tables,constants,story:activityStory,battleAdvisor:createBattleAdvisor({tables,constants}),tickets}),
    createNativeSave: options => createNativeSave({...options, emptyFlash:session.saveSram().every(byte=>byte===255)}),
    stepFrame() { return session.step(stepButtons()); },
    observe() { lastObservation = observer.observe(); return lastObservation; },
    close() { if (!owningSession) session.close(); },
  });
}
