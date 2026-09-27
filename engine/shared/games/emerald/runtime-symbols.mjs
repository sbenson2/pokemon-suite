// Every RAM/ROM symbol the Emerald player reads, resolved from the pinned
// pokeemerald symbol file so no address is ever guessed.
import { readAdapterFile } from '../../shared/adapter-resources.mjs';
import { parseSymbolMap, SYMBOL_SOURCE } from './addresses.mjs';

export const EMERALD_RUNTIME_SYMBOLS = Object.freeze([
  // core
  'gMain', 'gTasks', 'gPaletteFade', 'gSaveBlock1Ptr', 'gSaveBlock2Ptr',
  'gFieldCallback', 'gFieldCallback2', 'gObjectEvents', 'gPlayerAvatar', 'gMapHeader',
  'gBackupMapLayout', 'sLockFieldControls', 'sGlobalScriptContextStatus', 'sGlobalScriptContext',
  'sTextPrinters', 'gTextFlags', 'gSpecialVar_Result', 'gSpecialVar_LastTalked', 'gSpecialVar_ItemId',
  'gPlayerPartyCount', 'gPlayerParty', 'gEnemyParty', 'gPartyMenu', 'gBagPosition', 'sStartMenuCursorPos',
  'gSelectedOrderFromParty','gMapLayouts','Task_HandleWhichMoveInput','CB2_BerryTagScreen','Task_Hof_ExitOnKeyPressed','gLocalTime',
  'gBerries','sOpponentBerrySets','sBerryBlender','CB2_LoadBerryBlender','CB2_PlayBlender','CB2_EndBlenderGame','CB2_CheckPlayAgainLocal','sSavedPokeblockData','sInfo','CB2_UsePokeblockMenu','CB2_PokeblockMenu','CB2_PokeblockFeed','UsePokeblockMenu','ShowPokeblockResults','CloseUsePokeblockMenu','FeedPokeblockToMon','Task_HandlePokeblockMenuInput','Task_HandlePokeblockActionsInput','Task_WaitForAtePokeblockMessage',
  'gMoveToLearn', 'sMonSummaryScreen', 'sMartInfo', 'sShopData', 'gMapGroups', 'Task_HandleMultichoiceInput',
  'gSaveCounter','gSaveFileStatus','gDifferentSaveFile','sSaveDialogCallback','SaveCallback','SaveStartCallback','StartMenuSaveCallback','SaveSuccessCallback','SaveReturnSuccessCallback','SaveErrorCallback','SaveReturnErrorCallback','SaveConfirmInputCallback','SaveOverwriteInputCallback',
  'sCurrentStartMenuActions','sNumStartMenuActions','gMenuCallback','HandleStartMenuInput','gTMHMLearnsets',
  'sRotatingGate_FortreePuzzleConfig','sRotatingGate_ArmLayout','sRotatingGate_RotationInfoNorth','sRotatingGate_RotationInfoSouth','sRotatingGate_RotationInfoWest','sRotatingGate_RotationInfoEast','sRotatingGate_ArmPositionsClockwiseRotation','sRotatingGate_ArmPositionsAntiClockwiseRotation',
  'CB2_InitPokeNav', 'CB2_Pokenav', 'Task_CallYesOrNoCallback', 'CB2_BuyMenu', 'CB2_InitBuyMenu', 'Task_ExitBuyMenu',
  'Task_ReturnToItemListAfterItemPurchase', 'Task_ItemContext_SingleRow', 'Task_ItemContext_MultipleRows', 'Task_ContinueTaskAfterMessagePrints',
  // battle
  'gBattleTypeFlags', 'gBattleOutcome', 'gBattleMons', 'gDisableStructs', 'gBattlersCount', 'gBattlerPartyIndexes',
  'gBattlerPositions', 'gBattleMainFunc', 'gBattleCommunication', 'gActionSelectionCursor',
  'gMoveSelectionCursor', 'gBattlerControllerFuncs', 'gTrainerBattleOpponent_A', 'gBattleResults',
  'gActiveBattler', 'gCurrentMove',
  // ROM tables
  'gSpeciesInfo', 'gSpeciesNames', 'gMoveNames', 'gBattleMoves', 'gTypeEffectiveness', 'gTrainers',
  'sSpeciesToNationalPokedexNum', 'gItems', 'gExperienceTables', 'gLevelUpLearnsets',
  // callbacks and tasks
  'CB2_Overworld', 'CB2_MainMenu', 'CB2_NewGame', 'CB2_NamingScreen', 'CB2_ChooseStarter', 'CB2_StarterChoose', 'CB2_WallClock',
  'CB2_InitBattle', 'BattleMainCB2', 'CB2_UpdatePartyMenu', 'CB2_BagMenuRun', 'CB2_InitSummaryScreen',
  'CB2_EvolutionSceneUpdate', 'CB2_LoadMap', 'CB2_ReturnToField', 'CB2_ReturnToFieldContinueScript',
  'CB2_ReturnToFieldFadeFromBlack', 'CB2_ReturnToFieldWithOpenMenu', 'CB2_ReturnToFieldLocal', 'CB2_DoChangeMap', 'CB2_WhiteOut',
  'Task_TitleScreenPhase3', 'Task_HandleMainMenuInput', 'Task_NewGameBirchSpeech_ChooseGender',
  'Task_NewGameBirchSpeech_WaitPressBeforeNameChoice', 'Task_NewGameBirchSpeech_ProcessNameYesNoMenu',
  'Task_HandleStarterChooseInput', 'Task_HandleConfirmStarterInput', 'Task_HandleTruckSequence',
  'Task_HandleYesNoInput', 'Task_SetClock_HandleInput', 'Task_SetClock_AskConfirm', 'Task_SetClock_HandleConfirmInput',
  'Task_HandleChooseMonInput', 'Task_HandleSelectionMenuInput', 'Task_ShowStartMenu',
  'Task_ReplaceMoveYesNo', 'Task_HandleReplaceMoveYesNoInput', 'Task_HandleReplaceMoveInput',
  'Task_StopLearningMoveYesNo', 'Task_HandleStopLearningMoveYesNoInput', 'Task_ShowSummaryScreenToForgetMove',
  'Task_BagMenu_HandleInput', 'Task_ItemContext_Normal', 'Task_ShopMenu', 'Task_BuyMenu',
  'Task_BuyHowManyDialogueHandleInput', 'Task_HandleShopMenuBuy', 'Task_HandleShopMenuQuit', 'Task_ReturnToShopMenu',
  'Task_WarpAndLoadMap', 'Task_RunPerStepCallback',
  // battle controller functions
  'HandleInputChooseAction', 'HandleInputChooseMove', 'HandleInputChooseTarget', 'HandleChooseMoveAfterDma3',
  'OpenPartyMenuToChooseMon', 'WaitForMonSelection', 'OpenBagAndChooseItem', 'CompleteWhenChoseItem',
  'PlayerHandleYesNoInput',
]);

export function createRuntimeManifest(symbols) {
  if (!(symbols instanceof Map)) throw new TypeError('symbols must be a Map returned by parseSymbolMap');
  const missing = EMERALD_RUNTIME_SYMBOLS.filter(symbol => !symbols.has(symbol));
  if (missing.length) throw new Error(`Missing Emerald runtime symbols: ${missing.join(', ')}`);
  return Object.freeze(Object.fromEntries(EMERALD_RUNTIME_SYMBOLS.map(symbol => [symbol, symbols.get(symbol)])));
}

let cached = null;

export async function loadRuntimeManifest() {
  if (cached) return cached;
  const text = await readAdapterFile(SYMBOL_SOURCE.path.replace(/^vendor\//,''));
  const manifest = createRuntimeManifest(parseSymbolMap(text));
  // Three translation units define a static `sMenu`; menu.c's 12-byte struct
  // (left, top, cursorPos, minCursorPos, maxCursorPos, windowId, …) is the
  // one behind multichoice and yes/no menus.
  const menu = text.match(/^([0-9a-fA-F]{8})\s+l\s+0000000c\s+sMenu$/m);
  if (!menu) throw new Error('menu.c sMenu (12 bytes) not found in the pinned symbol file');
  // battle_controller_safari.c defines another static HandleInputChooseAction.
  // Bind the normal player's 0x266-byte function in this pinned symbol build.
  const action=text.match(/^([0-9a-fA-F]{8})\s+l\s+00000266\s+HandleInputChooseAction$/m);
  if(!action)throw new Error('Normal battle action controller not found in the pinned symbol file');
  cached = Object.freeze({ ...manifest, HandleInputChooseAction:Number.parseInt(action[1],16), sMenu: Number.parseInt(menu[1], 16) });
  return cached;
}
