import assert from "node:assert/strict";
import test from "node:test";

import {
  AtomicCaptureError,
  createFireRedObserver,
} from "../src/evidence/fire-red-observer.js";
import { assertAtomicObservation } from "../src/foundation.js";
import { createCampaignPlanner } from "../src/player/campaign.js";
import { createPolicyAdvisors } from "../src/player/advisors.js";
import { createCentralPlayer } from "../src/player/delegator.js";

const zeroIdentity = { validity: "valid", personality: 0, otId: 0, trainerId: 0, secretId: 0,
  nature: { id: 0, name: "Hardy" }, shiny: true, shinyValue: 0, isEgg: false, abilityNum: 0,
  friendship: 0, beauty: 0, sheen: 0, pokerus: 0,
  evs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 },
  ivs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 } };

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function partyPokemon({
  species,
  heldItem = 0,
  level,
  hp,
  maxHp,
  status1 = 0,
  ppBonuses = 0,
  experience = 0,
  moves = [],
  pp = [],
  attack = 0,
  defense = 0,
  speed = 0,
  spAttack = 0,
  spDefense = 0,
}) {
  const bytes = new Uint8Array(100);
  const view = new DataView(bytes.buffer);
  // Personality 0 uses GAEM order. A zero OT id keeps the XOR key simple.
  view.setUint32(0, 0, true);
  view.setUint32(4, 0, true);
  bytes[19] = 2;
  const secure = new Uint8Array(48);
  const secureView = new DataView(secure.buffer);
  secureView.setUint16(0, species, true);
  secureView.setUint16(2, heldItem, true);
  secureView.setUint32(4, experience, true);
  secure[8] = ppBonuses;
  moves.forEach((move, slot) => secureView.setUint16(12 + slot * 2, move, true));
  pp.forEach((value, slot) => { secure[20 + slot] = value; });
  let checksum = 0;
  for (let offset = 0; offset < secure.length; offset += 2) {
    checksum = (checksum + secureView.getUint16(offset, true)) & 0xffff;
  }
  view.setUint16(28, checksum, true);
  bytes.set(secure, 32);
  view.setUint32(80, status1, true);
  bytes[84] = level;
  view.setUint16(86, hp, true);
  view.setUint16(88, maxHp, true);
  view.setUint16(90, attack, true);
  view.setUint16(92, defense, true);
  view.setUint16(94, speed, true);
  view.setUint16(96, spAttack, true);
  view.setUint16(98, spDefense, true);
  return bytes;
}

function battlePokemon({
  species,
  level,
  hp,
  maxHp,
  moves = [],
  pp = [],
  attack = 1,
  defense = 1,
  speed = 1,
  spAttack = 1,
  spDefense = 1,
  type1 = 0,
  type2 = type1,
  ability = 0,
  item = 0,
  status1 = 0,
  status2 = 0,
  statStages = [6, 6, 6, 6, 6, 6, 6, 6],
}) {
  const bytes = new Uint8Array(88);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, species, true);
  view.setUint16(2, attack, true);
  view.setUint16(4, defense, true);
  view.setUint16(6, speed, true);
  view.setUint16(8, spAttack, true);
  view.setUint16(10, spDefense, true);
  moves.forEach((move, slot) => view.setUint16(12 + slot * 2, move, true));
  statStages.forEach((value, index) => { bytes[24 + index] = value; });
  bytes[32] = ability;
  bytes[33] = type1;
  bytes[34] = type2;
  pp.forEach((value, slot) => { bytes[36 + slot] = value; });
  view.setUint16(40, hp, true);
  bytes[42] = level;
  view.setUint16(44, maxHp, true);
  view.setUint16(46, item, true);
  view.setUint32(76, status1, true);
  view.setUint32(80, status2, true);
  return bytes;
}

function fireRedText(value) {
  const bytes = [];
  for (const character of value) {
    if (character === " ") bytes.push(0);
    else if (character === "\n") bytes.push(0xfe);
    else if (character === ".") bytes.push(0xad);
    else if (character >= "A" && character <= "Z") {
      bytes.push(0xbb + character.charCodeAt(0) - 65);
    } else if (character >= "a" && character <= "z") {
      bytes.push(0xd5 + character.charCodeAt(0) - 97);
    } else {
      throw new Error(`unsupported fixture character ${character}`);
    }
  }
  bytes.push(0xff);
  return Uint8Array.from(bytes);
}

function fixtureRuntime() {
  return {
    data: {
      symbols: {
        gSaveBlock1Ptr: { address: 0x03000000, size: 4 },
        gSaveBlock2Ptr: { address: 0x03000004, size: 4 },
        gSaveFileStatus: { address: 0x03000008, size: 2 },
        gSaveAttemptStatus: { address: 0x0300000a, size: 2 },
        gPlayerAvatar: { address: 0x02000100, size: 32 },
        gObjectEvents: { address: 0x02000140, size: 576 },
        gMain: { address: 0x03000100, size: 0x43c },
        gPaletteFade: { address: 0x02000200, size: 16 },
        gBattleTypeFlags: { address: 0x02000220, size: 4 },
        gBattleControllerExecFlags: { address: 0x02000224, size: 4 },
        gBattlerControllerFuncs: { address: 0x03000b10, size: 16 },
        gActionSelectionCursor: { address: 0x02000228, size: 4 },
        gMoveSelectionCursor: { address: 0x0200022c, size: 4 },
        gActiveBattler: { address: 0x02000230, size: 1 },
        gBattleOutcome: { address: 0x02000231, size: 1 },
        gBattleScripting: { address: 0x02000240, size: 36 },
        gBattlescriptCurrInstr: { address: 0x02000264, size: 4 },
        gBattleCommunication: { address: 0x02000268, size: 8 },
        gMoveToLearn: { address: 0x02000270, size: 2 },
        gBattleMons: { address: 0x02007000, size: 352 },
        gStatuses3: { address: 0x02007180, size: 16 },
        gDisableStructs: { address: 0x02007400, size: 112 },
        gLastMoves: { address: 0x02007470, size: 8 },
        gBattleStruct: { address: 0x02007478, size: 4 },
        gBattleResults: { address: 0x02007700, size: 68 },
        gMultiUsePlayerCursor: { address: 0x02007750, size: 1 },
        gBattlersCount: { address: 0x02007751, size: 1 },
        gAbsentBattlerFlags: { address: 0x02007752, size: 1 },
        gSentPokesToOpponent: { address: 0x02007190, size: 2 },
        gBattlerPartyIndexes: { address: 0x02007192, size: 8 },
        gBattlePartyCurrentOrder: { address: 0x0200719a, size: 3 },
        gDisplayedStringBattle: { address: 0x02007200, size: 300 },
        gPlayerPartyCount: { address: 0x02000b00, size: 1 },
        gPlayerParty: { address: 0x02000c00, size: 600 },
        gStorage: { address: 0x02000e80, size: 4 },
        gPokemonStoragePtr: { address: 0x03000b00, size: 4 },
        sCurrentBoxOption: { address: 0x02000e84, size: 1 },
        sCursorArea: { address: 0x02000e85, size: 1 },
        sCursorPosition: { address: 0x02000e86, size: 1 },
        sIsMonBeingMoved: { address: 0x02000e87, size: 1 },
        sInPartyMenu: { address: 0x02000e88, size: 1 },
        sDepositBoxId: { address: 0x02000e89, size: 1 },
        sChooseBoxMenu: { address: 0x02000e8c, size: 4 },
        gTasks: { address: 0x03000600, size: 640 },
        sStartMenuCursorPos: { address: 0x02000300, size: 1 },
        sNumStartMenuItems: { address: 0x02000301, size: 1 },
        sStartMenuOrder: { address: 0x02000302, size: 9 },
        sStartMenuCallback: { address: 0x02000310, size: 4 },
        sSaveDialogCB: { address: 0x03000a00, size: 4 },
        sSaveDialogDelay: { address: 0x03000a04, size: 1 },
        sSaveDialogIsPrinting: { address: 0x03000a05, size: 1 },
        sMenu: { address: 0x02000320, size: 12 },
        sShopData: { address: 0x02000900, size: 28 },
        sMessageBoxType: { address: 0x02000340, size: 1 },
        sTextPrinters: { address: 0x02000400, size: 1152 },
        sGlobalScriptContextStatus: { address: 0x03000a10, size: 1 },
        sGlobalScriptContext: { address: 0x03000a20, size: 116 },
        sLockFieldControls: { address: 0x03000a94, size: 1 },
        gBagMenuState: { address: 0x02000500, size: 20 },
        gSpecialVar_ItemId: { address: 0x02000520, size: 2 },
        sTMCaseStaticResources: { address: 0x02000530, size: 12 },
        sMoveSelectionCursorPos: { address: 0x02000540, size: 1 },
        sMoveSwapCursorPos: { address: 0x02000541, size: 1 },
        sLastViewedMonIndex: { address: 0x02000542, size: 1 },
        sMonSummaryScreen: { address: 0x02000544, size: 4 },
        gPartyMenu: { address: 0x02000548, size: 20 },
        sPartyMenuInternal: { address: 0x0200055c, size: 4 },
        sNamingScreen: { address: 0x02000560, size: 4 },
        sPokedexScreenData: { address: 0x02000564, size: 4 },
        sMapCursor: { address: 0x02000568, size: 4 },
        sFlyMap: { address: 0x0200056c, size: 4 },
        sTradeAnim: { address: 0x02000570, size: 4 },
        gSprites: { address: 0x02008000, size: 4420 },
        CB1_Overworld: { address: 0x08001000, size: 20, region: "ROM" },
        CB2_Overworld: { address: 0x08002000, size: 20, region: "ROM" },
        CB2_NewGameScene: { address: 0x08002500, size: 20, region: "ROM" },
        CB2_NamingScreen: { address: 0x08002600, size: 20, region: "ROM" },
        CB2_LoadMap: { address: 0x08003000, size: 20, region: "ROM" },
        CB2_InitPartyMenu: { address: 0x08008000, size: 20, region: "ROM" },
        CB2_OpenBagMenu: { address: 0x08009000, size: 20, region: "ROM" },
        CB2_BagMenuRun: { address: 0x08009100, size: 20, region: "ROM" },
        CB2_UpdatePartyMenu: {
          address: 0x08009200,
          size: 20,
          region: "ROM",
        },
        CB2_BuyMenu: { address: 0x08013000, size: 20, region: "ROM" },
        CB2_InitBuyMenu: { address: 0x08014000, size: 20, region: "ROM" },
        CB2_PokeStorage: { address: 0x08015000, size: 20, region: "ROM" },
        BattleMainCB2: { address: 0x08019000, size: 20, region: "ROM" },
        CB2_RunPokemonSummaryScreen: {
          address: 0x08019200,
          size: 20,
          region: "ROM",
        },
        StartCB_Save2: { address: 0x0800a000, size: 20, region: "ROM" },
        SaveDialogCB_AskSaveHandleInput: {
          address: 0x0800b000,
          size: 20,
          region: "ROM",
        },
        SaveDialogCB_PrintSavingDontTurnOffPower: {
          address: 0x0800c000,
          size: 20,
          region: "ROM",
        },
        SaveDialogCB_ReturnSuccess: {
          address: 0x0800d000,
          size: 20,
          region: "ROM",
        },
        Task_StartMenuHandleInput: { address: 0x08004000, size: 20, region: "ROM" },
        Task_ControlsGuide_HandleInput: {
          address: 0x08004500,
          size: 20,
          region: "ROM",
        },
        Task_PikachuIntro_HandleInput: {
          address: 0x08004540,
          size: 20,
          region: "ROM",
        },
        Task_OakSpeech_ThisWorld: {
          address: 0x08004580,
          size: 20,
          region: "ROM",
        },
        Task_OakSpeech_FadeOutOak: {
          address: 0x080045c0,
          size: 20,
          region: "ROM",
        },
        Task_OakSpeech_HandleGenderInput: {
          address: 0x08021000,
          size: 20,
          region: "ROM",
        },
        Task_OakSpeech_HandleConfirmNameInput: {
          address: 0x08021100,
          size: 20,
          region: "ROM",
        },
        Task_OakSpeech_HandleRivalNameInput: {
          address: 0x08021200,
          size: 20,
          region: "ROM",
        },
        Task_TitleScreenMain: {
          address: 0x08004600,
          size: 20,
          region: "ROM",
        },
        Task_ExecuteMainMenuSelection: {
          address: 0x08004700,
          size: 20,
          region: "ROM",
        },
        Task_MultichoiceMenu_HandleInput: {
          address: 0x0800f000,
          size: 20,
          region: "ROM",
        },
        Task_YesNoMenu_HandleInput: {
          address: 0x0800f100,
          size: 20,
          region: "ROM",
        },
        Task_ListMenuHandleInput: {
          address: 0x0800f200,
          size: 20,
          region: "ROM",
        },
        ListMenuDummyTask: {
          address: 0x0800f300,
          size: 20,
          region: "ROM",
        },
        Task_ShopMenu: { address: 0x08010000, size: 20, region: "ROM" },
        Task_BuyMenu: { address: 0x08010100, size: 20, region: "ROM" },
        Task_BuyHowManyDialogueHandleInput: {
          address: 0x08010200,
          size: 20,
          region: "ROM",
        },
        Task_CallYesOrNoCallback: {
          address: 0x08011000,
          size: 20,
          region: "ROM",
        },
        Task_ContinueTaskAfterMessagePrints: {
          address: 0x08012000,
          size: 20,
          region: "ROM",
        },
        Task_PCMainMenu: { address: 0x08016000, size: 20, region: "ROM" },
        Task_PokeStorageMain: {
          address: 0x08017000,
          size: 20,
          region: "ROM",
        },
        Task_OnSelectedMon: {
          address: 0x08017100,
          size: 20,
          region: "ROM",
        },
        Task_DepositMenu: {
          address: 0x08017200,
          size: 20,
          region: "ROM",
        },
        Task_OnBPressed: { address: 0x08018000, size: 20, region: "ROM" },
        HandleInputChooseAction: {
          address: 0x0801a000,
          size: 20,
          region: "ROM",
        },
        "HandleInputChooseAction@0x0801d000": {
          address: 0x0801d000,
          size: 20,
          region: "ROM",
          sourceName: "HandleInputChooseAction",
        },
        HandleInputChooseMove: {
          address: 0x0801b000,
          size: 20,
          region: "ROM",
        },
        HandleInputChooseTarget: {
          address: 0x0801b080,
          size: 20,
          region: "ROM",
        },
        OakOldManHandleInputChooseMove: {
          address: 0x0801b040,
          size: 20,
          region: "ROM",
        },
        PlayerBufferRunCommand: {
          address: 0x0801c000,
          size: 20,
          region: "ROM",
        },
        PrintOakText_ForPetesSake: {
          address: 0x0801c040,
          size: 20,
          region: "ROM",
        },
        Task_ExitNonDoor: { address: 0x08005000, size: 20, region: "ROM" },
        Task_BattleStart: { address: 0x0801e000, size: 20, region: "ROM" },
        Task_FieldEffectShowMon_WaitFldeff: {
          address: 0x0801f000,
          size: 20,
          region: "ROM",
        },
        Task_ScriptShowMonPic: {
          address: 0x0801f040,
          size: 20,
          region: "ROM",
        },
        Task_FldEffUseSurf: {
          address: 0x0801f100,
          size: 20,
          region: "ROM",
        },
        Task_BagMenu_HandleInput: {
          address: 0x08020000,
          size: 20,
          region: "ROM",
        },
        Task_FieldItemContextMenuHandleInput: {
          address: 0x08020100,
          size: 20,
          region: "ROM",
        },
        Task_HandleListInput: {
          address: 0x08020200,
          size: 20,
          region: "ROM",
        },
        Task_ContextMenu_HandleInput: {
          address: 0x08020300,
          size: 20,
          region: "ROM",
        },
        Task_SelectedTMHM_Field: {
          address: 0x08020380,
          size: 20,
          region: "ROM",
        },
        Task_HandleChooseMonInput: {
          address: 0x08020400,
          size: 20,
          region: "ROM",
        },
        Task_HandleSelectionMenuInput: {
          address: 0x08020440,
          size: 20,
          region: "ROM",
        },
        Task_HandleReplaceMoveYesNoInput: {
          address: 0x08020500,
          size: 20,
          region: "ROM",
        },
        Task_ReplaceMoveYesNo: {
          address: 0x08020540,
          size: 20,
          region: "ROM",
        },
        Task_PrintAndWaitForText: {
          address: 0x08020580,
          size: 20,
          region: "ROM",
        },
        Task_HandleStopLearningMoveYesNoInput: {
          address: 0x08020d00,
          size: 20,
          region: "ROM",
        },
        Task_StopLearningMoveYesNo: {
          address: 0x08020d40,
          size: 20,
          region: "ROM",
        },
        Task_InputHandler_SelectOrForgetMove: {
          address: 0x08020600,
          size: 20,
          region: "ROM",
        },
        Task_LearnNextMoveOrClosePartyMenu: {
          address: 0x08020700,
          size: 20,
          region: "ROM",
        },
        Task_DisplayLevelUpStatsPg1: {
          address: 0x08020720,
          size: 20,
          region: "ROM",
        },
        Task_DisplayLevelUpStatsPg2: {
          address: 0x08020740,
          size: 20,
          region: "ROM",
        },
        Task_TryLearnNewMoves: {
          address: 0x08020760,
          size: 20,
          region: "ROM",
        },
        Task_ForgetMove: {
          address: 0x08020780,
          size: 20,
          region: "ROM",
        },
        Task_UseItem_Normal: {
          address: 0x08020a20,
          size: 20,
          region: "ROM",
        },
        Task_EvolutionScene: {
          address: 0x080207a0,
          size: 20,
          region: "ROM",
        },
        Task_DexScreen_RegisterMonToPokedex: {
          address: 0x08020a00,
          size: 20,
          region: "ROM",
        },
        EvoTask_PostEvoSparklesSet2Teardown: {
          address: 0x080207b0,
          size: 20,
          region: "ROM",
        },
        CB2_PSA: { address: 0x080207c0, size: 20, region: "ROM" },
        CB2_EvolutionSceneUpdate: {
          address: 0x080207e0,
          size: 20,
          region: "ROM",
        },
        CB2_Idle: { address: 0x08020800, size: 20, region: "ROM" },
        CB2_SetUpTMCaseUI_Blocking: {
          address: 0x08020900,
          size: 20,
          region: "ROM",
        },
        CB2_RegionMap: {
          address: 0x08020b00,
          size: 20,
          region: "ROM",
        },
        CB2_InGameTrade: {
          address: 0x08020c00,
          size: 20,
          region: "ROM",
        },
        Task_FlyMap: {
          address: 0x08020b40,
          size: 20,
          region: "ROM",
        },
        Task_EndQuestLog: { address: 0x08006000, size: 20, region: "ROM" },
        Task_MapNamePopup: { address: 0x08007000, size: 20, region: "ROM" },
        Task_RushInjuredPokemonToCenter: {
          address: 0x08007100,
          size: 20,
          region: "ROM",
        },
        WaitForAorBPress: { address: 0x0800e000, size: 20, region: "ROM" },
        BattleScript_CaughtPokemonSkipNewDex: {
          address: 0x08031000,
          size: 0,
          region: "ROM",
        },
        BattleScript_CaughtPokemonSkipNickname: {
          address: 0x08031020,
          size: 0,
          region: "ROM",
        },
      },
      structures: {
        SaveBlock1: {
          size: 4608,
          fields: {
            pos: { offset: 0 },
            location: { offset: 4 },
            gameStats: { offset: 8 },
            money: { offset: 656 },
            bagPocket_Items: { offset: 784 },
            bagPocket_KeyItems: { offset: 952 },
            bagPocket_PokeBalls: { offset: 1072 },
            bagPocket_TMHM: { offset: 1124 },
            bagPocket_Berries: { offset: 1356 },
            trainerRematchStepCounter: { offset: 0x638 },
            trainerRematches: { offset: 0x63a, count: 100 },
            flags: { offset: 3808 },
            vars: { offset: 4096 },
          },
        },
        SaveBlock2: {
          size: 16,
          fields: { encryptionKey: { offset: 0 } },
        },
        PlayerAvatar: {
          size: 32,
          fields: {
            flags: { offset: 0 },
            tileTransitionState: { offset: 3 },
          },
        },
      },
    },
  };
}

class FakeSession {
  constructor() {
    this.identity = Object.freeze({ mgbaCommit: "a".repeat(40) });
    this.platform = "gba";
    this.currentFrame = 42;
    this.frameReads = null;
    this.memory = new Map();
    this.sram = Uint8Array.from([1, 3, 3, 7]);
  }

  get frame() {
    return this.frameReads?.shift() ?? this.currentFrame;
  }

  put(address, bytes) {
    this.memory.set(address, Uint8Array.from(bytes));
  }

  readMemory(address, bytes) {
    const value = this.memory.get(address);
    if (!value || value.length < bytes) {
      throw new Error(`missing fixture memory at 0x${address.toString(16)}`);
    }
    return value.slice(0, bytes);
  }

  saveSram() {
    return this.sram.slice();
  }
}

function stableSession() {
  const session = new FakeSession();
  session.put(0x03000000, u32(0x02001000));
  session.put(0x03000004, u32(0x02002000));
  session.put(0x03000008, Uint8Array.from([1, 0]));
  session.put(0x0300000a, Uint8Array.from([0, 0]));

  const save1 = new Uint8Array(4608);
  const save1View = new DataView(save1.buffer);
  save1View.setInt16(0, 12, true);
  save1View.setInt16(2, 9, true);
  save1[4] = 3;
  save1[5] = 1;
  const encryptionKey = 0x11223344;
  save1View.setUint32(8, (encryptionKey ^ 7) >>> 0, true);
  save1View.setUint32(656, (encryptionKey ^ 54321) >>> 0, true);
  save1View.setUint16(784, 13, true);
  save1View.setUint16(786, (encryptionKey ^ 4) & 0xffff, true);
  save1View.setUint16(1072, 4, true);
  save1View.setUint16(1074, (encryptionKey ^ 9) & 0xffff, true);
  save1View.setUint16(952, 364, true);
  save1View.setUint16(954, (encryptionKey ^ 1) & 0xffff, true);
  save1View.setUint16(1124, 327, true);
  save1View.setUint16(1126, (encryptionKey ^ 1) & 0xffff, true);
  save1View.setUint16(1128, 339, true);
  save1View.setUint16(1130, (encryptionKey ^ 1) & 0xffff, true);
  save1View.setUint16(0x638, (19 << 8) | 73, true);
  save1[0x63a + 5] = 3;
  save1[0x63a + 8] = 1;
  session.put(0x02001000, save1);
  const save2 = new Uint8Array(16);
  new DataView(save2.buffer).setUint32(0, encryptionKey, true);
  session.put(0x02002000, save2);

  const avatar = new Uint8Array(32);
  avatar[0] = 1;
  avatar[3] = 0;
  avatar[5] = 2;
  session.put(0x02000100, avatar);
  const objectEvents = new Uint8Array(576);
  objectEvents[2 * 36] = 1;
  objectEvents[2 * 36 + 24] = 0x42;
  session.put(0x02000140, objectEvents);

  const main = new Uint8Array(0x43c);
  const mainView = new DataView(main.buffer);
  mainView.setUint32(0, 0x08001001, true);
  mainView.setUint32(4, 0x08002001, true);
  session.put(0x03000100, main);
  session.put(0x02000200, new Uint8Array(16));
  session.put(0x02000220, new Uint8Array(4));
  session.put(0x02000224, new Uint8Array(4));
  session.put(0x03000b10, new Uint8Array(16));
  session.put(0x02000228, new Uint8Array(4));
  session.put(0x0200022c, new Uint8Array(4));
  session.put(0x02000230, Uint8Array.from([0]));
  session.put(0x02000231, Uint8Array.from([0]));
  session.put(0x02000240, new Uint8Array(36));
  session.put(0x02000264, u32(0));
  session.put(0x02000268, new Uint8Array(8));
  session.put(0x02000270, new Uint8Array(2));
  session.put(0x02007000, new Uint8Array(352));
  session.put(0x02007180, new Uint8Array(16));
  session.put(0x02007400, new Uint8Array(112));
  session.put(0x02007470, new Uint8Array(8));
  session.put(0x02007478, u32(0));
  session.put(0x02007700, new Uint8Array(68));
  session.put(0x02007750, Uint8Array.from([0]));
  session.put(0x02007751, Uint8Array.from([2]));
  session.put(0x02007752, Uint8Array.from([0]));
  session.put(0x02007190, new Uint8Array(2));
  session.put(0x02007192, new Uint8Array(8));
  session.put(0x0200719a, Uint8Array.from([0x01, 0x23, 0x45]));
  const battleText = new Uint8Array(300);
  battleText[0] = 0xff;
  session.put(0x02007200, battleText);
  session.put(0x02000b00, Uint8Array.from([0]));
  session.put(0x02000c00, new Uint8Array(600));
  session.put(0x02000e80, u32(0));
  session.put(0x03000b00, u32(0));
  session.put(0x02000e84, Uint8Array.from([0]));
  session.put(0x02000e85, Uint8Array.from([0]));
  session.put(0x02000e86, Uint8Array.from([0]));
  session.put(0x02000e87, Uint8Array.from([0]));
  session.put(0x02000e88, Uint8Array.from([0]));
  session.put(0x02000e89, Uint8Array.from([0]));
  session.put(0x02000e8c, u32(0));
  session.put(0x02000300, Uint8Array.from([6]));
  session.put(0x02000301, Uint8Array.from([7]));
  session.put(0x02000302, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 0, 0]));
  session.put(0x02000310, u32(0));
  session.put(0x03000a00, u32(0));
  session.put(0x03000a04, Uint8Array.from([0]));
  session.put(0x03000a05, Uint8Array.from([0]));
  session.put(0x02000320, new Uint8Array(12));
  session.put(0x02000900, new Uint8Array(28));
  session.put(0x02000340, Uint8Array.from([0]));
  session.put(0x02000400, new Uint8Array(1152));
  session.put(0x03000a10, Uint8Array.from([2]));
  session.put(0x03000a20, new Uint8Array(116));
  session.put(0x03000a94, Uint8Array.from([0]));
  session.put(0x02000500, new Uint8Array(20));
  session.put(0x02000520, new Uint8Array(2));
  session.put(0x02000530, new Uint8Array(12));
  session.put(0x02000540, Uint8Array.from([0]));
  session.put(0x02000541, Uint8Array.from([0]));
  session.put(0x02000542, Uint8Array.from([0]));
  session.put(0x02000544, u32(0));
  session.put(0x02000548, new Uint8Array(20));
  session.put(0x0200055c, u32(0));
  session.put(0x02000560, u32(0));
  session.put(0x02000564, u32(0));
  session.put(0x02000568, u32(0));
  session.put(0x0200056c, u32(0));
  session.put(0x02000570, u32(0));
  session.put(0x03000600, new Uint8Array(640));
  return session;
}

test("the observer captures the cartridge-owned battle menu battler independently of gActiveBattler", () => {
  const session = stableSession(), runtime = fixtureRuntime();
  runtime.data.symbols.gBattlerInMenuId = { address: 0x02000232, size: 1 };
  session.put(0x02000230, Uint8Array.from([4]));
  session.put(0x02000232, Uint8Array.from([2]));
  const observer = createFireRedObserver({ session, runtime, runId: 'menu-owner' });
  const observed = observer.capture();
  assert.equal(observed.playerMemory.activeBattler, 4);
  assert.equal(observed.playerMemory.battleMenuBattler, 2);
  assert.doesNotThrow(() => assertAtomicObservation(observed));
});

test('Town Map observes the same immutable save position without changing the native game', () => {
  const session=stableSession(),observer=createFireRedObserver({session,runtime:fixtureRuntime(),runId:'map-display',
    world:{data:{maps:[{id:'MAP_VIRIDIAN_CITY',group:3,number:1,properties:{region_map_section:'MAPSEC_VIRIDIAN_CITY',map_type:'MAP_TYPE_TOWN'},layout:{width:48,height:40}}]}}});
  const observation=observer.capture();
  assert.deepEqual(observation.playerMemory.townMap,{region:'kanto',x:4,y:8});
  assert.deepEqual(observation.playerMemory.position,{x:12,y:9});
  assert.equal(observation.frame,42);
  assert.doesNotThrow(()=>assertAtomicObservation(observation));
});

test("a FireRed observation is one deeply immutable frame-boundary capture", () => {
  const session = stableSession();
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    world: { data: { maps: [{ id: "MAP_VIRIDIAN_CITY", group: 3, number: 1 }] } },
    runId: "run-7",
  });

  const observation = observer.capture();
  assert.doesNotThrow(() => assertAtomicObservation(observation));
  assert.equal(observation.frame, 42);
  assert.match(observation.captureId, /^run-7:1:42:/);
  assert.equal(observation.phase, "stable");
  assert.equal(observation.emulator.callback1, "CB1_Overworld");
  assert.equal(observation.emulator.callback2, "CB2_Overworld");
  assert.equal(observation.emulator.mode, "overworld");
  assert.equal(observation.emulator.inputReady, true);
  assert.deepEqual(observation.emulator.input, {
    heldKeysRaw: 0,
    newKeysRaw: 0,
    heldKeys: 0,
    newKeys: 0,
  });
  assert.deepEqual(observation.playerMemory.position, { x: 12, y: 9 });
  assert.deepEqual(observation.playerMemory.avatar, {
    flags: 1,
    onFoot: true,
    surfing: false,
    objectEventId: 2,
    facing: "north",
    movementDirection: "east",
  });
  assert.deepEqual(observation.playerMemory.map, {
    group: 3,
    number: 1,
    id: "MAP_VIRIDIAN_CITY",
  });
  assert.equal(observation.playerMemory.saveFileStatus, 1);
  assert.equal(observation.playerMemory.gameStats.savedGame, 7);
  assert.deepEqual(observation.playerMemory.vsSeeker, {
    batterySteps: 73,
    responseClearSteps: 19,
    rematchEntries: Array.from({ length: 100 }, (_, index) =>
      index === 5 ? 3 : index === 8 ? 1 : 0
    ),
  });
  assert.equal(observation.sram.bytes, 4);
  assert.match(observation.sram.sha256, /^[0-9a-f]{64}$/);
  assert.match(observation.playerMemory.sha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.playerMemory.map), true);
  assert.throws(() => {
    observation.playerMemory.map.group = 9;
  }, TypeError);
});

test("an in-game trade exposes input only at the source-owned completion state", () => {
  const captureTradeState = (state) => {
    const session = stableSession();
    const main = session.memory.get(0x03000100).slice();
    new DataView(main.buffer).setUint32(4, 0x08020c01, true);
    session.put(0x03000100, main);
    const tradePointer = 0x02009000;
    session.put(0x02000570, u32(tradePointer));
    const trade = new Uint8Array(0x96);
    new DataView(trade.buffer).setUint16(0x94, state, true);
    session.put(tradePointer, trade);
    return createFireRedObserver({
      session,
      runtime: fixtureRuntime(),
      runId: `in-game-trade-${state}`,
    }).capture();
  };

  const animation = captureTradeState(70);
  assert.equal(animation.emulator.mode, "in-game-trade");
  assert.equal(animation.phase, "transition");
  assert.ok(animation.phaseReasons.includes("in-game-trade-animation"));
  assert.deepEqual(animation.playerMemory.ui.inGameTrade, {
    stage: "animation",
    state: 70,
  });

  const completion = captureTradeState(71);
  assert.equal(completion.emulator.mode, "in-game-trade");
  assert.equal(completion.phase, "stable");
  assert.deepEqual(completion.playerMemory.ui.inGameTrade, {
    stage: "completion",
    state: 71,
  });
});

test("the observer exposes the source-owned Fly map cursor only when it accepts input", () => {
  const session = stableSession();
  const main = new Uint8Array(0x43c);
  const mainView = new DataView(main.buffer);
  mainView.setUint32(0, 0x08001001, true);
  mainView.setUint32(4, 0x08020b01, true);
  session.put(0x03000100, main);

  const tasks = new Uint8Array(640);
  const tasksView = new DataView(tasks.buffer);
  tasksView.setUint32(0, 0x08020b41, true);
  tasks[4] = 1;
  session.put(0x03000600, tasks);
  session.put(0x02000568, u32(0x02009000));
  session.put(0x0200056c, u32(0x02009100));

  const mapCursor = new Uint8Array(32);
  const mapCursorView = new DataView(mapCursor.buffer);
  mapCursorView.setInt16(0, 2, true);
  mapCursorView.setInt16(2, 4, true);
  mapCursorView.setUint16(20, 87, true);
  mapCursorView.setUint16(22, 3, true);
  mapCursorView.setUint16(24, 0, true);
  session.put(0x02009000, mapCursor);
  session.put(0x02009100, Uint8Array.from([4, 0, 0]));

  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    world: { data: { maps: [{ id: "MAP_ROUTE23", group: 3, number: 1 }] } },
    runId: "fly-map",
  });
  const observation = observer.capture();

  assert.equal(observation.emulator.mode, "fly-map");
  assert.deepEqual(observation.playerMemory.ui.flyMap, {
    stage: "selection",
    cursor: { x: 2, y: 4 },
    selectedMapsec: 87,
    selectedMapsecType: 3,
    selectedDungeonType: 0,
  });
});

test("the observer exposes a lightweight cartridge state for semantic movement leases", () => {
  const session = stableSession();
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    world: { data: { maps: [{ id: "MAP_VIRIDIAN_CITY", group: 3, number: 1 }] } },
    runId: "controller-state",
  });

  assert.deepEqual(observer.captureControllerState(), {
    frame: 42,
    mode: "overworld",
    callback2: "CB2_Overworld",
    inBattle: false,
    map: "MAP_VIRIDIAN_CITY",
    x: 12,
    y: 9,
    tileTransitionState: 0,
  });
});

test("size-qualified runtime symbols are resolved once instead of rescanning every capture", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  let symbolTableScans = 0;
  runtime.data.symbols = new Proxy(runtime.data.symbols, {
    ownKeys(target) {
      symbolTableScans += 1;
      return Reflect.ownKeys(target);
    },
  });
  const observer = createFireRedObserver({
    session,
    runtime,
    world: { data: { maps: [{ id: "MAP_VIRIDIAN_CITY", group: 3, number: 1 }] } },
    runId: "cached-symbol-resolution",
  });

  observer.capture();
  const scansAfterFirstCapture = symbolTableScans;
  observer.capture();

  assert.equal(symbolTableScans, scansAfterFirstCapture);
});

test("the observer decodes durable Pokedex seen and owned flags from SaveBlock2", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  runtime.data.structures.SaveBlock2 = {
    size: 0xf24,
    fields: {
      pokedex: { offset: 0x18 },
      encryptionKey: { offset: 0xf20 },
    },
  };
  const save2 = new Uint8Array(0xf24);
  const save2View = new DataView(save2.buffer);
  save2View.setUint32(0xf20, 0x11223344, true);
  // Pokedex owned starts at pokedex + 0x10; seen starts at pokedex + 0x44.
  for (const species of [4, 19, 43]) {
    const bit = species - 1;
    save2[0x18 + 0x10 + (bit >> 3)] |= 1 << (bit & 7);
  }
  for (const species of [4, 16, 19, 43]) {
    const bit = species - 1;
    save2[0x18 + 0x44 + (bit >> 3)] |= 1 << (bit & 7);
  }
  session.put(0x02002000, save2);

  const observation = createFireRedObserver({
    session,
    runtime,
    runId: "pokedex-flags",
  }).capture();

  assert.deepEqual(observation.playerMemory.trainer.pokedex, {
    ownedSpecies: [4, 19, 43],
    seenSpecies: [4, 16, 19, 43],
    ownedCount: 3,
    seenCount: 4,
  });
});

test("the observer exposes FireRed's Trainer Card play time", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  runtime.data.structures.SaveBlock2 = {
    size: 32,
    fields: {
      playTimeHours: { offset: 14 },
      playTimeMinutes: { offset: 16 },
      playTimeSeconds: { offset: 17 },
      playTimeVBlanks: { offset: 18 },
      encryptionKey: { offset: 20 },
    },
  };
  const save2 = new Uint8Array(32);
  const view = new DataView(save2.buffer);
  view.setUint16(14, 23, true);
  save2[16] = 59;
  save2[17] = 58;
  save2[18] = 42;
  view.setUint32(20, 0x11223344, true);
  session.put(0x02002000, save2);

  const observation = createFireRedObserver({
    session,
    runtime,
    runId: "trainer-card-play-time",
  }).capture();

  assert.deepEqual(observation.playerMemory.trainer.playTime, {
    hours: 23,
    minutes: 59,
    seconds: 58,
    vblanks: 42,
  });
});

test("the observer exposes live map-grid collision and behavior changes and avatar locomotion state", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  runtime.data.symbols.VMap = { address: 0x03000c00, size: 12 };
  runtime.data.symbols.gMetatileAttributes_Test = {address:0x08007000,size:43*4,region:'ROM'};
  const attributes=new Uint8Array(43*4);new DataView(attributes.buffer).setUint32(42*4,0x69,true);session.put(0x08007000,attributes);

  const avatar = session.memory.get(0x02000100);
  avatar[0] = (1 << 0) | (1 << 3);

  const virtualWidth = 20;
  const virtualHeight = 19;
  const virtualMap = new Uint8Array(12);
  const virtualMapView = new DataView(virtualMap.buffer);
  virtualMapView.setInt32(0, virtualWidth, true);
  virtualMapView.setInt32(4, virtualHeight, true);
  virtualMapView.setUint32(8, 0x02010000, true);
  session.put(0x03000c00, virtualMap);

  const liveGrid = new Uint8Array(virtualWidth * virtualHeight * 2);
  const liveGridView = new DataView(liveGrid.buffer);
  const liveCellOffset = ((1 + 7) * virtualWidth + (2 + 7)) * 2;
  liveGridView.setUint16(liveCellOffset, 42 | (3 << 12), true);
  session.put(0x02010000, liveGrid);

  const cells = Array.from({ length: 25 }, (_, index) => ({
    x: index % 5,
    y: Math.floor(index / 5),
    metatileId: 7,
    collision: 1,
    elevation: 0,
    behaviorName: "MB_NORMAL",
  }));
  const observer = createFireRedObserver({
    session,
    runtime,
    world: { data: { metatileBehaviors:{MB_NORMAL:{value:0},MB_WARP_DOOR:{value:0x69}}, maps: [{
      id: "MAP_VIRIDIAN_CITY",
      group: 3,
      number: 1,
      layout: { width: 5, height: 5, cells, primaryTileset:"gTileset_Test" },
    }] } },
    runId: "live-grid",
  });

  const observation = observer.capture();

  assert.equal(observation.playerMemory.avatar.flags, (1 << 0) | (1 << 3));
  assert.equal(observation.playerMemory.avatar.onFoot, true);
  assert.equal(observation.playerMemory.avatar.surfing, true);
  assert.deepEqual(
    observation.playerMemory.mapGrid.cells.find(({ x, y }) => x === 2 && y === 1),
    {
      x: 2,
      y: 1,
      metatileId: 42,
      collision: 0,
      elevation: 3,
      behaviorName: "MB_WARP_DOOR",
    },
  );
});

test("the observer exposes source-layout live object coordinates for collision planning", () => {
  const session = stableSession();
  const objectEvents = session.memory.get(0x02000140);
  const npcOffset = 3 * 36;
  const view = new DataView(objectEvents.buffer);
  objectEvents[npcOffset] = 1;
  objectEvents[npcOffset + 8] = 1;
  objectEvents[npcOffset + 9] = 0;
  objectEvents[npcOffset + 10] = 3;
  objectEvents[npcOffset + 11] = 3;
  view.setInt16(npcOffset + 16, 12 + 7, true);
  view.setInt16(npcOffset + 18, 2 + 7, true);
  view.setInt16(npcOffset + 20, 12 + 7, true);
  view.setInt16(npcOffset + 22, 2 + 7, true);
  objectEvents[npcOffset + 24] = 0x11;
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    world: { data: { maps: [{ id: "MAP_PALLET_TOWN", group: 3, number: 0 }] } },
    runId: "live-objects",
  });

  const observation = observer.capture();
  assert.deepEqual(
    observation.playerMemory.objectEvents.find(({ id }) => id === 3),
    {
      id: 3,
      player: false,
      localId: 1,
      map: { group: 3, number: 0 },
      elevation: 3,
      current: { x: 12, y: 2 },
      previous: { x: 12, y: 2 },
      facing: "south",
      movementDirection: "south",
    },
  );
});

test("the observer exposes persisted current-map coordinates for offscreen NPCs", () => {
  const session = stableSession();
  const save1 = session.memory.get(0x02001000);
  const templateOffset = 2272;
  const view = new DataView(save1.buffer, save1.byteOffset, save1.byteLength);
  save1[templateOffset] = 1;
  view.setInt16(templateOffset + 4, 10, true);
  view.setInt16(templateOffset + 6, 4, true);
  const runtime = fixtureRuntime();
  runtime.data.structures.SaveBlock1.fields.objectEventTemplates = {
    offset: templateOffset,
  };
  const observer = createFireRedObserver({
    session,
    runtime,
    world: {
      data: {
        maps: [{
          id: "MAP_VIRIDIAN_CITY_GYM",
          group: 3,
          number: 1,
          objectEvents: [
            { x: 10, y: 2, script: "ViridianCity_Gym_EventScript_Takashi" },
            { x: 2, y: 2, script: "ViridianCity_Gym_EventScript_Giovanni" },
          ],
        }],
      },
    },
    runId: "persisted-map-objects",
  });

  const observation = observer.capture();
  assert.deepEqual(observation.playerMemory.objectEventTemplates, [{
    localId: 1,
    current: { x: 10, y: 4 },
  }]);
});

test("the observer decodes a current-map scene variable through source-backed story symbols", () => {
  const session = stableSession();
  const save1 = session.memory.get(0x02001000);
  new DataView(save1.buffer).setUint16(
    4096 + (0x4055 - 0x4000) * 2,
    4,
    true,
  );
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    story: {
      data: {
        symbols: {
          variables: {
            VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: {
              value: 0x4055,
            },
          },
          flags: {},
        },
      },
    },
    world: {
      data: {
        maps: [{
          id: "MAP_VIRIDIAN_CITY",
          group: 3,
          number: 1,
          coordEvents: [{
            var: "VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB",
          }],
        }],
      },
    },
    runId: "story-state",
  });

  const observation = observer.capture();
  assert.deepEqual(observation.playerMemory.storyState, {
    variables: {
      VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: 4,
    },
    flags: {},
  });
});

test("the observer decodes current-map hidden-item flags", () => {
  const session = stableSession();
  const save1 = session.memory.get(0x02001000);
  const hiddenItemFlag = 1000;
  save1[3808 + Math.floor(hiddenItemFlag / 8)] |=
    1 << (hiddenItemFlag % 8);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    story: {
      data: {
        symbols: {
          variables: {},
          flags: {
            FLAG_HIDDEN_ITEM_VIRIDIAN_FOREST_POTION: {
              value: hiddenItemFlag,
            },
          },
        },
      },
    },
    world: {
      data: {
        maps: [{
          id: "MAP_VIRIDIAN_CITY",
          group: 3,
          number: 1,
          backgroundEvents: [{
            type: "hidden_item",
            flag: "FLAG_HIDDEN_ITEM_VIRIDIAN_FOREST_POTION",
            item: "ITEM_POTION",
            x: 2,
            y: 2,
          }],
        }],
      },
    },
    runId: "hidden-item-story-state",
  });

  const observation = observer.capture();
  assert.deepEqual(observation.playerMemory.storyState, {
    variables: {},
    flags: {
      FLAG_HIDDEN_ITEM_VIRIDIAN_FOREST_POTION: true,
    },
  });
});

test("the observer decodes campaign-wide watched variables and flags", () => {
  const session = stableSession();
  const save1 = session.memory.get(0x02001000);
  const view = new DataView(save1.buffer);
  view.setUint16(4096 + (16471 - 0x4000) * 2, 1, true);
  save1[3808 + Math.floor(2089 / 8)] |= 1 << (2089 % 8);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    storyWatch: { variables: [16471], flags: [2089] },
    world: {
      data: {
        maps: [{ id: "MAP_VIRIDIAN_CITY", group: 3, number: 1 }],
      },
    },
    runId: "campaign-story-state",
  });

  const observation = observer.capture();
  assert.deepEqual(observation.playerMemory.storyState, {
    variables: {},
    flags: {},
    variableIds: { 16471: 1 },
    flagIds: { 2089: true },
  });
});

test("campaign healer watches expose live Silph liberation state away from its scene map", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  const world = {
    maps: [{
      id: "MAP_SILPH_CO_9F", group: 3, number: 1,
      coordEvents: [],
      objectEvents: [{
        x: 2, y: 16, script: "SilphCo_9F_EventScript_HealWoman",
      }],
    }],
  };
  const story = {
    symbols: {
      variables: { VAR_MAP_SCENE_SILPH_CO_11F: { value: 0x4060 } },
      flags: {},
    },
    scripts: [{
      label: "SilphCo_9F_EventScript_HealWoman",
      instructions: [
        { op: "lock", args: [] },
        { op: "faceplayer", args: [] },
        { op: "goto_if_ge", args: ["VAR_MAP_SCENE_SILPH_CO_11F", "1", "SilphCo_9F_EventScript_HealWomanRocketsGone"] },
        { op: "msgbox", args: ["SilphCo_9F_Text_YouShouldTakeQuickNap"] },
        { op: "closemessage", args: [] },
        { op: "call", args: ["EventScript_OutOfCenterPartyHeal"] },
        { op: "msgbox", args: ["SilphCo_9F_Text_DontGiveUp"] },
        { op: "release", args: [] },
        { op: "end", args: [] },
      ],
    }, {
      label: "SilphCo_9F_EventScript_HealWomanRocketsGone",
      instructions: [
        { op: "msgbox", args: ["SilphCo_9F_Text_ThankYouSoMuch"] },
        { op: "release", args: [] },
        { op: "end", args: [] },
      ],
    }],
  };
  const planner = createCampaignPlanner({ campaign: { objectives: [] }, world, story });
  const observer = createFireRedObserver({
    session, runtime, world, story, storyWatch: planner.storyWatch(),
    runId: "silph-healer-story-state",
  });
  const save1 = session.memory.get(0x02001000);
  const view = new DataView(save1.buffer);
  // SaveBlock1.vars starts at 4096 in this fixture; 0x4060 is index 96.
  for (const value of [0, 1, 2, 0]) {
    view.setUint16(4288, value, true);
    const observation = observer.capture();
    assert.equal(observation.playerMemory.map.id, "MAP_SILPH_CO_9F");
    assert.equal(observation.playerMemory.storyState.variableIds?.[16480], value);
    assertAtomicObservation(observation);
  }

  // Unavailable RAM layout must stay unknown, never fabricate the healing state 0.
  delete runtime.data.structures.SaveBlock1.fields.vars;
  assert.equal(observer.capture().playerMemory.storyState.variableIds?.[16480], undefined);
});

test("the new-game controls guide is a stable boot decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08002501, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(3 * 40, 0x08004501, true);
  tasks[3 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "new-game-controls",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.emulator.mode, "boot");
  assert.deepEqual(observation.playerMemory.ui.newGame, {
    stage: "controls-guide",
    selected: "next",
  });
});

test("the Pikachu intro accepts input only in its source-defined input state", () => {
  for (const [mainState, expectedPhase, expectedNewGame] of [
    [1, "stable", { stage: "pikachu-guide", selected: "next" }],
    [2, "transition", null],
  ]) {
    const session = stableSession();
    const main = session.memory.get(0x03000100).slice();
    new DataView(main.buffer).setUint32(4, 0x08002501, true);
    main[0x438] = mainState;
    session.put(0x03000100, main);
    const tasks = session.memory.get(0x03000600).slice();
    new DataView(tasks.buffer).setUint32(3 * 40, 0x08004541, true);
    tasks[3 * 40 + 4] = 1;
    session.put(0x03000600, tasks);
    const observer = createFireRedObserver({
      session,
      runtime: fixtureRuntime(),
      runId: `pikachu-intro-${mainState}`,
    });

    const observation = observer.capture();
    assert.equal(observation.phase, expectedPhase);
    assert.deepEqual(observation.playerMemory.ui.newGame, expectedNewGame);
  }
});

test("Oak narration accepts input only at a cartridge text-printer wait", () => {
  for (const [textState, expectedPhase, expectedNewGame] of [
    [2, "stable", { stage: "oak-dialog", selected: "next" }],
    [0, "transition", null],
  ]) {
    const session = stableSession();
    const main = session.memory.get(0x03000100).slice();
    new DataView(main.buffer).setUint32(4, 0x08002501, true);
    session.put(0x03000100, main);
    const tasks = session.memory.get(0x03000600).slice();
    new DataView(tasks.buffer).setUint32(3 * 40, 0x08004581, true);
    tasks[3 * 40 + 4] = 1;
    session.put(0x03000600, tasks);
    const printers = session.memory.get(0x02000400).slice();
    printers[27] = 1;
    printers[28] = textState;
    session.put(0x02000400, printers);
    const observer = createFireRedObserver({
      session,
      runtime: fixtureRuntime(),
      runId: `oak-dialog-${textState}`,
    });

    const observation = observer.capture();
    assert.equal(observation.phase, expectedPhase);
    assert.deepEqual(observation.playerMemory.ui.newGame, expectedNewGame);
  }
});

test("a proven Oak text wait outranks the broad fade-task transition heuristic", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08002501, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(3 * 40, 0x080045c1, true);
  tasks[3 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 2;
  session.put(0x02000400, printers);
  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "oak-fade-text-wait",
  }).capture();

  assert.doesNotThrow(() => assertAtomicObservation(observation));
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.newGame, {
    stage: "oak-dialog",
    selected: "next",
  });
});

test("the observer exposes the rival preset menu from cartridge state", () => {
  const captureNameMenu = ({ playerName, rivalName = null, cursor }) => {
    const session = stableSession();
    const runtime = fixtureRuntime();
    runtime.data.structures.SaveBlock1.fields.rivalName = { offset: 100 };
    runtime.data.structures.SaveBlock2.fields.playerName = { offset: 4 };
    runtime.data.structures.SaveBlock2.fields.playerGender = { offset: 12 };
    const save1 = session.memory.get(0x02001000).slice();
    const save2 = session.memory.get(0x02002000).slice();
    if (rivalName) save1.set(fireRedText(rivalName), 100);
    if (playerName) save2.set(fireRedText(playerName), 4);
    save2[12] = 1;
    session.put(0x02001000, save1);
    session.put(0x02002000, save2);
    const main = session.memory.get(0x03000100).slice();
    new DataView(main.buffer).setUint32(4, 0x08002501, true);
    session.put(0x03000100, main);
    const tasks = session.memory.get(0x03000600).slice();
    new DataView(tasks.buffer).setUint32(3 * 40, 0x08021201, true);
    tasks[3 * 40 + 4] = 1;
    session.put(0x03000600, tasks);
    const menu = session.memory.get(0x02000320).slice();
    menu[2] = cursor;
    session.put(0x02000320, menu);
    return createFireRedObserver({
      session,
      runtime,
      runId: `name-menu-${playerName ?? "empty"}-${cursor}`,
    }).capture();
  };

  const rivalMenu = captureNameMenu({
    playerName: "OMI",
    rivalName: "KAZ",
    cursor: 3,
  });
  assert.doesNotThrow(() => assertAtomicObservation(rivalMenu));
  assert.deepEqual(rivalMenu.playerMemory.ui.newGame, {
    stage: "choose-rival-name",
    selected: null,
    cursor: 3,
  });
  assert.equal(rivalMenu.playerMemory.trainer.playerName, "OMI");
  assert.equal(rivalMenu.playerMemory.trainer.rivalName, "KAZ");
});

test("the observer exposes FireRed's unavoidable player naming keyboard", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08002601, true);
  session.put(0x03000100, main);

  const namingAddress = 0x02009000;
  session.put(0x02000560, u32(namingAddress));
  const naming = new Uint8Array(0x1e40);
  naming.set(fireRedText("FI"), 0x1800);
  naming[0x1e10] = 2;
  naming[0x1e22] = 1;
  naming[0x1e23] = 5;
  naming[0x1e2c] = 0;
  session.put(namingAddress, naming);

  const sprites = new Uint8Array(4420);
  const cursorOffset = 5 * 68;
  const spriteView = new DataView(sprites.buffer);
  spriteView.setInt16(cursorOffset + 0x2e, 4, true);
  spriteView.setInt16(cursorOffset + 0x30, 1, true);
  session.put(0x02008000, sprites);

  const observation = createFireRedObserver({
    session,
    runtime,
    runId: "player-naming-keyboard",
  }).capture();

  assert.doesNotThrow(() => assertAtomicObservation(observation));
  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.ui.newGame, null);
  assert.deepEqual(observation.playerMemory.ui.naming, {
    stage: "enter-player-preset",
    subject: "player",
    template: 0,
    state: 2,
    inputReady: true,
    text: "FI",
    page: 1,
    cursor: { x: 4, y: 1 },
  });
});

test("Pokemon naming recovery requires a byte-proven blank input, not just decoded text", () => {
  for (const template of [2, 3]) for (const firstByte of [0xff, 0x00, 0xbb, 0x01]) {
    const session = stableSession();
    const main = session.memory.get(0x03000100).slice();
    new DataView(main.buffer).setUint32(4, 0x08002601, true);
    session.put(0x03000100, main);
    session.put(0x02000560, u32(0x02009000));
    const naming = new Uint8Array(0x1e40);
    naming.fill(0xff, 0x1800, 0x1810);
    naming[0x1800] = firstByte;
    naming[0x1e10] = 2;
    naming[0x1e22] = 1;
    naming[0x1e23] = 5;
    naming[0x1e2c] = template;
    session.put(0x02009000, naming);
    session.put(0x02008000, new Uint8Array(4420));
    const observed = createFireRedObserver({ session, runtime: fixtureRuntime(),
      runId: `nickname-blank-${template}-${firstByte}` }).capture();
    assert.equal(observed.playerMemory.ui.naming.subject, "pokemon");
    assert.equal(observed.playerMemory.ui.naming.textIsBlank, [0xff, 0x00].includes(firstByte));
  }
});

test("the observer exposes the live gender-menu cursor", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08002501, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(3 * 40, 0x08021001, true);
  tasks[3 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 1;
  session.put(0x02000320, menu);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "gender-menu",
  }).capture();
  assert.deepEqual(observation.playerMemory.ui.newGame, {
    stage: "choose-gender",
    selected: "GIRL",
    cursor: 1,
  });
});

test("the title-screen cry handoff remains transitional until the main menu", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08002581, true);
  session.put(0x03000100, main);
  const runtime = fixtureRuntime();
  runtime.data.symbols.CB2_TitleScreenRun = {
    address: 0x08002580,
    size: 20,
    region: "ROM",
  };
  const tasks = session.memory.get(0x03000600).slice();
  const taskOffset = 2 * 40;
  new DataView(tasks.buffer).setUint32(taskOffset, 0x08004601, true);
  tasks[taskOffset + 4] = 1;
  new DataView(tasks.buffer).setInt16(taskOffset + 8, 5, true);
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime,
    runId: "title-cry",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("title-screen-transition"));
});

test("automatic empty-save main-menu selection is transitional", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(40, 0x08004701, true);
  tasks[44] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "new-game-auto-select",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("modal-task-transition"));
});

test("party, wallet, and bag facts are decoded from their source-backed memory", () => {
  const session = stableSession();
  session.put(0x02000b00, Uint8Array.from([2]));
  const party = new Uint8Array(600);
  party.set(partyPokemon({
    species: 6,
    heldItem: 200,
    level: 69,
    hp: 201,
    maxHp: 201,
    status1: 64,
    ppBonuses: 2,
    experience: 328509,
    moves: [53, 126, 19, 15],
    pp: [14, 4, 12, 28],
    attack: 195,
    defense: 143,
    speed: 172,
    spAttack: 230,
    spDefense: 154,
  }), 0);
  party.set(partyPokemon({species: 76, level: 47, hp: 0, maxHp: 133, moves: [89, 157]}), 100);
  session.put(0x02000c00, party);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "trainer-facts",
  });

  const observation = observer.capture();
  assert.equal(observation.playerMemory.trainer.money, 54321);
  assert.deepEqual(observation.playerMemory.trainer.bag.items, [
    {itemId: 13, quantity: 4},
  ]);
  assert.deepEqual(observation.playerMemory.trainer.bag.pokeBalls, [
    {itemId: 4, quantity: 9},
  ]);
  assert.equal(observation.playerMemory.trainer.partyCount, 2);
  assert.equal(observation.playerMemory.trainer.partyValidity, "valid");
  assert.deepEqual(observation.playerMemory.trainer.party, [
    {...zeroIdentity, slot: 0, species: 6, heldItem: 200, ppBonuses: 2, experience: 328509,
      level: 69, hp: 201, maxHp: 201,
      status1: 64,
      moves: [53, 126, 19, 15],
      pp: [14, 4, 12, 28],
      stats: { attack: 195, defense: 143, speed: 172,
        spAttack: 230, spDefense: 154 }},
    {...zeroIdentity, slot: 1, species: 76, heldItem: 0, ppBonuses: 0, experience: 0,
      level: 47, hp: 0, maxHp: 133,
      status1: 0, moves: [89, 157, 0, 0],
      pp: [0, 0, 0, 0]},
  ]);
  assert.equal(observation.playerMemory.trainer.usablePartyCount, 1);
});

test("party count follows validated slots while the storage global is stale", () => {
  const session = stableSession();
  session.put(0x02000b00, Uint8Array.from([6]));
  const party = new Uint8Array(600);
  party.set(
    partyPokemon({ species: 143, level: 32, hp: 147, maxHp: 147 }),
    0,
  );
  party.set(
    partyPokemon({ species: 21, level: 19, hp: 49, maxHp: 49 }),
    100,
  );
  session.put(0x02000c00, party);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "stale-party-count",
  });

  const observation = observer.capture();
  assert.equal(observation.playerMemory.trainer.partyCount, 2);
  assert.deepEqual(
    observation.playerMemory.trainer.party.map(({ species }) => species),
    [143, 21],
  );
  party[32] ^= 1;
  session.put(0x02000c00, party);
  assert.equal(observer.capture().playerMemory.trainer.partyValidity, "unknown");
});

test("a frame change during capture is rejected instead of returning mixed state", () => {
  const session = stableSession();
  session.frameReads = [42, 43];
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "race",
  });

  assert.throws(
    () => observer.capture(),
    (error) =>
      error instanceof AtomicCaptureError &&
      error.code === "ATOMIC_CAPTURE_RACE" &&
      error.startFrame === 42 &&
      error.endFrame === 43,
  );
});

test("map and callback changes are recoverable transition samples", () => {
  const session = stableSession();
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "transition",
  });
  assert.equal(observer.capture().phase, "stable");

  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08003001, true);
  session.put(0x03000100, main);
  session.currentFrame = 43;
  const changed = observer.capture();
  assert.equal(changed.phase, "transition");
  assert.ok(changed.phaseReasons.includes("callback-change"));

  session.currentFrame = 44;
  const recovered = observer.capture();
  assert.equal(recovered.phase, "transition");
  assert.ok(recovered.phaseReasons.includes("transient-callback"));
});

test("invalid live pointers produce an unknown observation that can be resampled", () => {
  const session = stableSession();
  session.put(0x03000000, u32(0));
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "unknown",
  });
  const observation = observer.capture();
  assert.equal(observation.phase, "unknown");
  assert.ok(observation.phaseReasons.includes("save-block-1-pointer"));
  assert.doesNotThrow(() => assertAtomicObservation(observation));
});

test("active task functions expose modal state without granting them input ownership", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(0, 0x08004001, true);
  taskView.setInt16(8, 1, true);
  tasks[4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "menu",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.emulator.mode, "start-menu");
  assert.deepEqual(observation.playerMemory.activeTasks, [
    { slot: 0, function: "Task_StartMenuHandleInput", priority: 0 },
  ]);
  assert.deepEqual(observation.playerMemory.ui.startMenu, {
    cursor: 6,
    count: 7,
    order: [
      "pokedex",
      "pokemon",
      "bag",
      "player",
      "save",
      "option",
      "exit",
    ],
    selected: "exit",
  });
  assert.equal(
    JSON.stringify(observation).toLowerCase().includes("controller"),
    false,
  );
});

test("an active Start menu ignores a stale hidden field-dialog close state", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(0, 0x08004001, true);
  taskView.setInt16(8, 1, true);
  tasks[4] = 1;
  session.put(0x03000600, tasks);
  const context = session.memory.get(0x03000a20).slice();
  context[1] = 2;
  new DataView(context.buffer).setUint32(4, 0x0800e001, true);
  session.put(0x03000a20, context);
  session.put(0x03000a10, Uint8Array.from([2]));
  session.put(0x03000a94, Uint8Array.from([1]));

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "start-menu-stale-field-close",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.equal(observation.emulator.mode, "start-menu");
  assert.equal(observation.playerMemory.ui.fieldDialog, null);
  assert.equal(observation.playerMemory.ui.startMenu.selected, "exit");
});

test("a Pokemon summary input task is an actionable closeable modal", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  runtime.data.symbols.Task_InputHandler_Info = {
    address: 0x08021400,
    size: 20,
    region: "ROM",
  };
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019201, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(0, 0x08021401, true);
  tasks[4] = 1;
  session.put(0x03000600, tasks);

  const observation = createFireRedObserver({
    session,
    runtime,
    runId: "pokemon-summary-info",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.equal(observation.emulator.mode, "party");
  assert.deepEqual(observation.playerMemory.ui.pokemonSummary, {
    stage: "info",
    partySlot: 0,
  });
  assert.equal(observation.phaseReasons.includes("party-transition"), false);
});

test("the Start-menu task must reach its input-handling state before observation is stable", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(0, 0x08004001, true);
  tasks[4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "start-menu-initializing",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("start-menu-initializing"));
});

test("the Start-menu bootstrap task remains a transition after battle", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  runtime.data.symbols.task50_startmenu = {
    address: 0x08004040,
    size: 20,
    region: "ROM",
  };
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(0, 0x08004041, true);
  tasks[4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime,
    runId: "post-battle-start-menu-bootstrap",
  });

  const observation = observer.capture();

  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("start-menu-initializing"));
});

test("FireRed key latching is observed separately from world stability", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  const view = new DataView(main.buffer);
  view.setUint16(0x28, 0x80, true);
  view.setUint16(0x2a, 0x80, true);
  view.setUint16(0x2c, 0x80, true);
  view.setUint16(0x2e, 0x80, true);
  session.put(0x03000100, main);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "input-latched",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.emulator.inputReady, false);
  assert.deepEqual(observation.emulator.input, {
    heldKeysRaw: 0x80,
    newKeysRaw: 0x80,
    heldKeys: 0x80,
    newKeys: 0x80,
  });
});

test("every nonzero avatar tile-transition state is transient", () => {
  const session = stableSession();
  const avatar = session.memory.get(0x02000100).slice();
  avatar[3] = 2;
  session.put(0x02000100, avatar);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "tile-center",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("tile-transition"));
});

test("a blocked Cycling Road tile-center remains actionable for steering", () => {
  const session = stableSession();
  const avatar = session.memory.get(0x02000100).slice();
  avatar[0] = 2;
  avatar[3] = 2;
  session.put(0x02000100, avatar);
  const objectEvents = session.memory.get(0x02000140).slice();
  objectEvents[2 * 36 + 24] = 0x11;
  session.put(0x02000140, objectEvents);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    world: { data: { maps: [{
      id: "MAP_VIRIDIAN_CITY",
      group: 3,
      number: 1,
      layout: {
        width: 24,
        height: 20,
        cells: [
          {
            x: 12,
            y: 9,
            behaviorName: "MB_CYCLING_ROAD_PULL_DOWN",
            collision: 0,
            elevation: 3,
          },
          {
            x: 12,
            y: 10,
            behaviorName: "MB_CYCLING_ROAD_WATER",
            collision: 0,
            elevation: 1,
          },
        ],
      },
    }] } },
    runId: "cycling-road-blocked-tile-center",
  });

  const observation = observer.capture();

  assert.equal(observation.playerMemory.avatar.movementDirection, "south");
  assert.equal(observation.playerMemory.tileTransitionState, 2);
  assert.equal(observation.phase, "stable");
  assert.ok(!observation.phaseReasons.includes("tile-transition"));
});

test("a Cycling Road fence collision remains actionable for steering", () => {
  const session = stableSession();
  const avatar = session.memory.get(0x02000100).slice();
  avatar[0] = 2;
  avatar[3] = 2;
  session.put(0x02000100, avatar);
  const objectEvents = session.memory.get(0x02000140).slice();
  objectEvents[2 * 36 + 24] = 0x11;
  session.put(0x02000140, objectEvents);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    world: { data: { maps: [{
      id: "MAP_VIRIDIAN_CITY",
      group: 3,
      number: 1,
      layout: {
        width: 24,
        height: 20,
        cells: [
          {
            x: 12,
            y: 9,
            behaviorName: "MB_CYCLING_ROAD_PULL_DOWN",
            collision: 0,
            elevation: 3,
          },
          {
            x: 12,
            y: 10,
            behaviorName: "MB_NORMAL",
            collision: 1,
            elevation: 0,
          },
        ],
      },
    }] } },
    runId: "cycling-road-fence-tile-center",
  });

  const observation = observer.capture();

  assert.equal(observation.playerMemory.avatar.movementDirection, "south");
  assert.equal(observation.playerMemory.tileTransitionState, 2);
  assert.equal(observation.phase, "stable");
  assert.ok(!observation.phaseReasons.includes("tile-transition"));
});

test("automatic field-warp tasks prevent a false stable observation", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(0, 0x08005001, true);
  tasks[4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "field-warp",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("transient-task"));
  assert.deepEqual(observation.playerMemory.activeTasks, [
    { slot: 0, function: "Task_ExitNonDoor", priority: 0 },
  ]);
});

test("automatic Quest Log cleanup and map popups prevent a false stable observation", () => {
  for (const [taskName, address] of [
    ["Task_EndQuestLog", 0x08006001],
    ["Task_MapNamePopup", 0x08007001],
  ]) {
    const session = stableSession();
    const tasks = session.memory.get(0x03000600).slice();
    new DataView(tasks.buffer).setUint32(0, address, true);
    tasks[4] = 1;
    session.put(0x03000600, tasks);
    const observer = createFireRedObserver({
      session,
      runtime: fixtureRuntime(),
      runId: `automatic-${taskName}`,
    });

    const observation = observer.capture();
    assert.equal(observation.phase, "transition", taskName);
    assert.ok(observation.phaseReasons.includes("transient-task"), taskName);
  }
});

test("modal initialization callbacks prevent a false stable observation", () => {
  for (const [callbackName, address] of [
    ["CB2_InitPartyMenu", 0x08008001],
    ["CB2_OpenBagMenu", 0x08009001],
    ["CB2_InitBuyMenu", 0x08014001],
    ["CB2_SetUpTMCaseUI_Blocking", 0x08020901],
  ]) {
    const session = stableSession();
    const main = session.memory.get(0x03000100).slice();
    new DataView(main.buffer).setUint32(4, address, true);
    session.put(0x03000100, main);
    const observer = createFireRedObserver({
      session,
      runtime: fixtureRuntime(),
      runId: `modal-init-${callbackName}`,
    });

    const observation = observer.capture();
    assert.equal(observation.phase, "transition", callbackName);
    assert.ok(observation.phaseReasons.includes("transient-callback"), callbackName);
  }
});

test("an active palette fade prevents a false stable modal observation", () => {
  const session = stableSession();
  const paletteFade = session.memory.get(0x02000200).slice();
  // PaletteFadeControl.active is bit 7 of byte 7 in the matching ROM layout.
  paletteFade[7] = 0x80;
  session.put(0x02000200, paletteFade);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "palette-fade",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("palette-fade"));
  assert.equal(observation.emulator.paletteFadeActive, true);
});

test("Bag list and context decisions expose the selected cartridge item", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009101, true);
  session.put(0x03000100, main);
  const bagState = session.memory.get(0x02000500).slice();
  const bagView = new DataView(bagState.buffer);
  bagState[5] = 1;
  bagView.setUint16(6, 1, true); // Key Items pocket.
  bagView.setUint16(10, 0, true);
  bagView.setUint16(16, 0, true);
  session.put(0x02000500, bagState);

  let tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020001, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  let observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "bag-list",
  });
  let observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.bag, {
    stage: "list",
    pocket: 1,
    pocketName: "key-items",
    index: 0,
    cursor: 0,
    scrollOffset: 0,
    selectedItemId: 364,
    selectedQuantity: 1,
    contextCursor: null,
    selectedAction: null,
  });

  tasks = new Uint8Array(640);
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020101, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const item = new Uint8Array(2);
  new DataView(item.buffer).setUint16(0, 364, true);
  session.put(0x02000520, item);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 0;
  session.put(0x02000320, menu);
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "bag-context",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.ui.bag.stage, "context");
  assert.equal(observation.playerMemory.ui.bag.selectedItemId, 364);
  assert.equal(observation.playerMemory.ui.bag.selectedAction, "open");
});

test("an in-battle Bag list is a stable cartridge decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009101, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const bagState = session.memory.get(0x02000500).slice();
  const bagView = new DataView(bagState.buffer);
  bagView.setUint16(6, 1, true);
  bagView.setUint16(10, 1, true);
  bagView.setUint16(16, 0, true);
  session.put(0x02000500, bagState);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020001, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-bag-list",
  }).capture();

  assert.equal(observation.emulator.mode, "battle");
  assert.equal(observation.phase, "stable");
  assert.ok(!observation.phaseReasons.includes("battle-transition"));
  assert.equal(observation.playerMemory.ui.bag.stage, "list");
  assert.equal(observation.playerMemory.ui.bag.pocket, 1);
});

test("an in-battle party item-result message is a stable decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const partyMenu = session.memory.get(0x02000548).slice();
  partyMenu[11] = 3; // PARTY_ACTION_USE_ITEM.
  session.put(0x02000548, partyMenu);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(1 * 40, 0x08020581, true);
  tasks[1 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const printers = session.memory.get(0x02000400).slice();
  printers[6 * 36 + 27] = 1;
  printers[6 * 36 + 28] = 2;
  session.put(0x02000400, printers);
  const item = session.memory.get(0x02000520).slice();
  new DataView(item.buffer).setUint16(0, 23, true);
  session.put(0x02000520, item);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-party-item-result",
  }).capture();

  assert.equal(observation.emulator.mode, "battle");
  assert.equal(observation.phase, "stable");
  assert.ok(!observation.phaseReasons.includes("battle-transition"));
  assert.deepEqual(observation.playerMemory.ui.party, {
    stage: "message",
    cursor: 0,
    selectedPartySlot: 0,
    itemId: 23,
    menuType: 0,
    actionId: 3,
    cursorPokemon: null,
  });
});

test("a newly caught Pokedex entry is stable only when its page awaits dismissal", () => {
  for (const [state, expectedPhase, expectedUi] of [
    [10, "transition", null],
    [11, "stable", { stage: "registered-entry", selected: "continue" }],
  ]) {
    const session = stableSession();
    const main = session.memory.get(0x03000100).slice();
    new DataView(main.buffer).setUint32(4, 0x08019001, true);
    main[0x439] = 2;
    session.put(0x03000100, main);

    const tasks = session.memory.get(0x03000600).slice();
    new DataView(tasks.buffer).setUint32(2 * 40, 0x08020a01, true);
    tasks[2 * 40 + 4] = 1;
    session.put(0x03000600, tasks);

    session.put(0x02000564, u32(0x02009000));
    session.put(0x02009000, Uint8Array.from([2, state]));

    const observation = createFireRedObserver({
      session,
      runtime: fixtureRuntime(),
      runId: `caught-pokedex-${state}`,
    }).capture();

    assert.equal(observation.phase, expectedPhase);
    assert.deepEqual(observation.playerMemory.ui.pokedexRegistration, expectedUi);
  }
});

test("TM Case list and context decisions expose HM selection", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08020801, true);
  session.put(0x03000100, main);
  const tmCase = session.memory.get(0x02000530).slice();
  const tmCaseView = new DataView(tmCase.buffer);
  tmCaseView.setUint16(8, 1, true);
  tmCaseView.setUint16(10, 0, true);
  session.put(0x02000530, tmCase);

  let tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020201, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  let observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "tm-case-list",
  });
  let observation = observer.capture();
  assert.equal(observation.emulator.mode, "bag");
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.bag, {
    stage: "tm-case-list",
    pocket: 3,
    pocketName: "tm-case",
    index: 1,
    cursor: 1,
    scrollOffset: 0,
    selectedItemId: 339,
    selectedQuantity: 1,
    contextCursor: null,
    selectedAction: null,
  });

  tasks = new Uint8Array(640);
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020301, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const item = new Uint8Array(2);
  new DataView(item.buffer).setUint16(0, 339, true);
  session.put(0x02000520, item);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 0;
  session.put(0x02000320, menu);
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "tm-case-context",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.ui.bag.stage, "tm-case-context");
  assert.equal(observation.playerMemory.ui.bag.selectedItemId, 339);
  assert.equal(observation.playerMemory.ui.bag.selectedAction, "use");
});

test("TM Case context construction is transition state, not a decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08020801, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020381, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "tm-case-context-construction",
  });

  const observation = observer.capture();
  assert.equal(observation.emulator.mode, "bag");
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("bag-transition"));
});

test('Berry Pouch exposes its own list and observed context actions',()=>{
 const session=stableSession(),runtime=fixtureRuntime();
 Object.assign(runtime.data.symbols,{
  sStaticCnt:{address:0x02009500,size:12},sContextMenuOptions:{address:0x02009510,size:4},sContextMenuNumOptions:{address:0x02009514,size:1},
  Task_BerryPouchMain:{address:0x08022200,size:32},Task_NormalContextMenu_HandleInput:{address:0x08022240,size:32},CB2_BerryPouchIdle:{address:0x08022280,size:32}
 });
 const main=session.memory.get(0x03000100).slice();new DataView(main.buffer).setUint32(4,0x08022281,true);session.put(0x03000100,main);
 const save=session.memory.get(0x02001000).slice(),v=new DataView(save.buffer);v.setUint16(1356,139,true);v.setUint16(1358,0x3344^3,true);session.put(0x02001000,save);
 session.put(0x02009500,new Uint8Array(12));session.put(0x02009510,u32(0x08330000));session.put(0x02009514,Uint8Array.of(4));session.put(0x08330000,Uint8Array.of(0,2,1,3));
 const tasks=new Uint8Array(640);tasks[4*40+4]=1;new DataView(tasks.buffer).setUint32(4*40,0x08022201,true);session.put(0x03000600,tasks);
 let o=createFireRedObserver({session,runtime,runId:'berry-list'}).capture();assert.equal(o.phase,'stable');assert.equal(o.playerMemory.ui.bag?.stage,'berry-pouch-list');assert.equal(o.playerMemory.ui.bag.selectedItemId,139);
 new DataView(tasks.buffer).setUint32(4*40,0x08022241,true);session.put(0x03000600,tasks);session.put(0x02000520,Uint8Array.of(139,0));const menu=session.memory.get(0x02000320).slice();menu[2]=1;session.put(0x02000320,menu);
 o=createFireRedObserver({session,runtime,runId:'berry-context'}).capture();assert.equal(o.phase,'stable');assert.deepEqual(o.playerMemory.ui.bag.actions,['use','give','toss','exit']);assert.equal(o.playerMemory.ui.bag.selectedAction,'give');
});

test("Ether's move picker exposes its native menu cursor and selected party member", () => {
  const session=stableSession(),runtime=fixtureRuntime();
  runtime.data.symbols.Task_HandleRestoreWhichMoveInput={address:0x08030000,size:20,region:'ROM'};
  const main=session.memory.get(0x03000100).slice();new DataView(main.buffer).setUint32(4,0x08009201,true);session.put(0x03000100,main);
  const party=session.memory.get(0x02000548).slice();party[9]=2;party[11]=3;session.put(0x02000548,party);
  const item=new Uint8Array(2);new DataView(item.buffer).setUint16(0,34,true);session.put(0x02000520,item);
  const tasks=new Uint8Array(640);new DataView(tasks.buffer).setUint32(4*40,0x08030001,true);tasks[4*40+4]=1;session.put(0x03000600,tasks);
  const menu=session.memory.get(0x02000320).slice();menu[2]=1;session.put(0x02000320,menu);
  const o=createFireRedObserver({session,runtime,runId:'ether-picker'}).capture();
  assert.equal(o.phase,'stable');assert.equal(o.playerMemory.ui.party?.stage,'restore-pp-move');
  assert.equal(o.playerMemory.ui.party?.cursor,1);assert.equal(o.playerMemory.ui.party?.selectedPartySlot,2);assert.equal(o.playerMemory.ui.party?.itemId,34);
  assert.equal(o.playerMemory.ui.moveLearning,null);
});

test("party and move-learning decisions expose source-backed cursors", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  session.put(0x03000100, main);
  const partyMenu = session.memory.get(0x02000548).slice();
  partyMenu[9] = 0;
  partyMenu[11] = 3; // PARTY_ACTION_USE_ITEM.
  new DataView(partyMenu.buffer).setInt16(14, 15, true); // Cut.
  new DataView(partyMenu.buffer).setInt16(16, 1, true); // TM/HM.
  session.put(0x02000548, partyMenu);
  const item = new Uint8Array(2);
  new DataView(item.buffer).setUint16(0, 339, true);
  session.put(0x02000520, item);

  let tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020401, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  let observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "choose-party-mon",
  });
  let observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.party, {
    stage: "choose-pokemon",
    cursor: 0,
    selectedPartySlot: 0,
    itemId: 339,
    menuType: 0,
    actionId: 3,
    cursorPokemon: null,
  });

  tasks = new Uint8Array(640);
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020501, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 0;
  session.put(0x02000320, menu);
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "replace-move-confirm",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.moveLearning, {
    stage: "confirm-replace",
    partySlot: 0,
    moveId: 15,
    itemId: 339,
    cursor: 0,
    selected: "yes",
  });

  tasks = new Uint8Array(640);
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020601, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  session.put(0x02000540, Uint8Array.from([2]));
  session.put(0x02000544, u32(0x02003000));
  session.put(0x02006288, Uint8Array.from([2]));
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "forget-move",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.moveLearning, {
    stage: "forget-move",
    partySlot: 0,
    moveId: 15,
    itemId: 339,
    cursor: 2,
    selected: "move-3",
  });
});

test("a battle switch picker ignores a stale global item id", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  main[0x439] = 2; // gMain.inBattle.
  session.put(0x03000100, main);

  const partyMenu = session.memory.get(0x02000548).slice();
  partyMenu[9] = 0;
  partyMenu[11] = 0; // PARTY_ACTION_CHOOSE_MON, not item use.
  session.put(0x02000548, partyMenu);

  const staleItem = new Uint8Array(2);
  new DataView(staleItem.buffer).setUint16(0, 4, true);
  session.put(0x02000520, staleItem);

  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020401, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-party-stale-item",
  }).capture();

  assert.equal(observation.emulator.mode, "battle");
  assert.deepEqual(observation.playerMemory.ui.party, {
    stage: "choose-pokemon",
    cursor: 0,
    selectedPartySlot: 0,
    menuType: 0,
    actionId: 0,
    cursorPokemon: null,
  });
});

test("party switching exposes FireRed's actionable secondary cursor", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  session.put(0x03000100, main);
  const partyMenu = session.memory.get(0x02000548).slice();
  partyMenu[9] = 1; // The Charizard selected for switching.
  partyMenu[10] = 0; // The destination currently under the real input cursor.
  partyMenu[11] = 8; // PARTY_ACTION_SWITCH.
  session.put(0x02000548, partyMenu);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020401, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "choose-party-switch-target",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.party, {
    stage: "choose-switch-target",
    cursor: 0,
    selectedPartySlot: 1,
    action: "switch",
    menuType: 0,
    actionId: 8,
    cursorPokemon: null,
  });
});

test("party pickers expose their cartridge menu type and action instead of relying on the stale item global", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  session.put(0x03000100, main);
  session.put(0x02000520, new Uint8Array([22, 0]));
  const tasks = new Uint8Array(640);
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020401, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({ session, runtime: fixtureRuntime(), runId: "party-ownership" });
  for (const [menuType, actionId, itemId] of [[0, 3, 22], [3, 11, undefined], [0, 14, 22], [0, 0, undefined]]) {
    const bytes = new Uint8Array(20);
    bytes[8] = menuType | 0x10; // layout bits are not part of menuType.
    bytes[11] = actionId;
    session.put(0x02000548, bytes);
    const party = observer.capture().playerMemory.ui.party;
    assert.equal(party.menuType, menuType);
    assert.equal(party.actionId, actionId);
    assert.equal(party.itemId, itemId);
  }
});

test("a party swap animation is transitional until an actionable party UI returns", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  session.put(0x03000100, main);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "party-swap-animation",
  }).capture();

  assert.equal(observation.emulator.mode, "party");
  assert.equal(observation.playerMemory.ui.party, null);
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("party-transition"));
});

test("an in-battle party selection submenu exposes its native Shift action", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const partyMenu = session.memory.get(0x02000548).slice();
  partyMenu[9] = 1;
  partyMenu[11] = 0; // PARTY_ACTION_CHOOSE_MON uses Shift/Summary/Cancel in battle.
  session.put(0x02000548, partyMenu);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020441, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 0;
  session.put(0x02000320, menu);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-party-shift-action",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.choiceMenu, {
    cursor: 0,
    minCursor: 0,
    maxCursor: 2,
    columns: 1,
    rows: 3,
    selected: "shift",
  });
  assert.deepEqual(observation.playerMemory.ui.party, {
    stage: "selection-menu",
    cursor: 1,
    selectedPartySlot: 1,
    action: "shift",
    actionCursor: 0,
    menuType: 0,
    actionId: 0,
    cursorPokemon: null,
  });
});

test("a field party selection exposes the cartridge's dynamic Switch action", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  session.put(0x03000100, main);
  const partyMenu = session.memory.get(0x02000548).slice();
  partyMenu[9] = 1;
  session.put(0x02000548, partyMenu);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020441, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 2;
  session.put(0x02000320, menu);
  session.put(0x0200055c, u32(0x02000f00));
  const internal = new Uint8Array(24);
  internal.set([0, 22, 1, 3, 2], 15);
  internal[23] = 5;
  session.put(0x02000f00, internal);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "field-party-switch-action",
  }).capture();

  assert.equal(observation.emulator.mode, "party");
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.party, {
    stage: "selection-menu",
    cursor: 1,
    selectedPartySlot: 1,
    action: "field",
    actionCursor: 2,
    actions: ["summary", "surf", "switch", "item", "cancel"],
    selectedAction: "switch",
    menuType: 0,
    actionId: 0,
    cursorPokemon: null,
  });
});

test("a Rare Candy level-up stats page exposes its native party decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  session.put(0x03000100, main);
  session.put(0x02000b00, Uint8Array.from([1]));
  const party = new Uint8Array(600);
  party.set(
    partyPokemon({ species: 21, level: 20, hp: 51, maxHp: 51 }),
    0,
  );
  session.put(0x02000c00, party);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020741, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "rare-candy-stats",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.levelUp, {
    stage: "stats-page-2",
    partySlot: 0,
    species: 21,
    level: 20,
  });

  const tasksAtMoveCheck = new Uint8Array(640);
  new DataView(tasksAtMoveCheck.buffer).setUint32(4 * 40, 0x08020761, true);
  tasksAtMoveCheck[4 * 40 + 4] = 1;
  session.put(0x03000600, tasksAtMoveCheck);
  const moveCheckObserver = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "rare-candy-move-check",
  });
  assert.deepEqual(moveCheckObserver.capture().playerMemory.ui.levelUp, {
    stage: "move-check",
    partySlot: 0,
    species: 21,
    level: 20,
  });
});

test("move-learning text pages are stable only at their party printer prompt", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  session.put(0x03000100, main);
  const partyMenu = session.memory.get(0x02000548).slice();
  partyMenu[9] = 0;
  new DataView(partyMenu.buffer).setInt16(14, 15, true);
  session.put(0x02000548, partyMenu);
  const item = new Uint8Array(2);
  new DataView(item.buffer).setUint16(0, 339, true);
  session.put(0x02000520, item);
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x08020541, true);
  tasks[4 * 40 + 4] = 1;
  taskView.setUint32(5 * 40, 0x08020581, true);
  tasks[5 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const printers = session.memory.get(0x02000400).slice();
  printers[6 * 36 + 27] = 1;
  printers[6 * 36 + 28] = 2;
  session.put(0x02000400, printers);

  let observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "move-learning-page",
  });
  let observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.moveLearning, {
    stage: "replace-explanation",
    partySlot: 0,
    moveId: 15,
    itemId: 339,
    cursor: null,
    selected: null,
  });

  printers[6 * 36 + 28] = 0;
  session.put(0x02000400, printers);
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "move-learning-printing",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("move-learning-transition"));
});

// Live stop, build 107: a Rare Candy took Diglett (party slot 5) to Lv 21,
// the move policy declined Fury Swipes, and FireRed's party menu asked "Stop
// trying to teach FURY SWIPES?" (Task_HandleStopLearningMoveYesNoInput). That
// prompt was unobserved, so the owner saw a party transition forever.
function partyStopLearningSession({ slot = 5, lastViewed = 5, cursor = 0, tasks: names = [0x08020d01] } = {}) {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  session.put(0x03000100, main);
  const partyMenu = session.memory.get(0x02000548).slice();
  partyMenu[9] = slot;
  partyMenu[11] = 0;
  new DataView(partyMenu.buffer).setInt16(14, 154, true); // Fury Swipes.
  new DataView(partyMenu.buffer).setInt16(16, 1, true); // LEARN_VIA_LEVEL_UP.
  session.put(0x02000548, partyMenu);
  session.put(0x02000542, Uint8Array.from([lastViewed]));
  const item = new Uint8Array(2);
  new DataView(item.buffer).setUint16(0, 68, true); // Rare Candy.
  session.put(0x02000520, item);
  const tasks = new Uint8Array(640);
  names.forEach((address, index) => {
    new DataView(tasks.buffer).setUint32(index * 40, address, true);
    tasks[index * 40 + 4] = 1;
  });
  session.put(0x03000600, tasks);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = cursor;
  session.put(0x02000320, menu);
  return session;
}

test("the party menu's stop-learning Yes/No is an explicit move-learning decision", () => {
  let observation = createFireRedObserver({
    session: partyStopLearningSession(),
    runtime: fixtureRuntime(),
    runId: "party-stop-learning",
  }).capture();
  assert.equal(observation.emulator.mode, "party");
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.moveLearning, {
    stage: "confirm-stop-learning",
    partySlot: 5,
    moveId: 154,
    itemId: 68,
    cursor: 0,
    selected: "yes",
  });
  observation = createFireRedObserver({
    session: partyStopLearningSession({ cursor: 1 }),
    runtime: fixtureRuntime(),
    runId: "party-stop-learning-no",
  }).capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.ui.moveLearning.stage, "confirm-stop-learning");
  assert.equal(observation.playerMemory.ui.moveLearning.selected, "no");
  assert.equal(observation.playerMemory.ui.moveLearning.cursor, 1);
});

test("the central player answers the party stop-learning prompt with YES from either cursor", () => {
  // Declining the new move is final: the owner stops teaching it, as it does
  // in battle and in the evolution scene. No objective is needed (a resumed
  // owner may be in this prompt before its checklist selects anything).
  for (const [cursor, buttons] of [[0, ["a"]], [1, ["up"]]]) {
    const observation = createFireRedObserver({
      session: partyStopLearningSession({ cursor }),
      runtime: fixtureRuntime(),
      runId: `party-stop-learning-decision-${cursor}`,
    }).capture();
    const decision = createCentralPlayer({ advisors: createPolicyAdvisors({}) }).decide(observation);
    assert.equal(decision.kind, "act", decision.reason);
    assert.equal(decision.winner.recommendation.kind, "choose-menu-option");
    assert.equal(decision.winner.recommendation.targetOption, "yes");
    assert.equal(decision.winner.recommendation.objective, "stop-learning-move-154");
    assert.deepEqual(decision.action.buttons, buttons);
  }
});

test("the stop-learning question is a move-learning transition while it prints", () => {
  const observation = createFireRedObserver({
    session: partyStopLearningSession({ tasks: [0x08020d41, 0x08020581] }),
    runtime: fixtureRuntime(),
    runId: "party-stop-learning-printing",
  }).capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("move-learning-transition"));
  assert.equal(observation.playerMemory.ui.moveLearning, null);
});

test("party-menu move prompts name gPartyMenu's Pokémon, not a stale summary index", () => {
  // The summary screen was last opened on slot 0; the Rare Candy targets slot 5.
  for (const [tasks, stage] of [
    [[0x08020501], "confirm-replace"],
    [[0x08020d01], "confirm-stop-learning"],
  ]) {
    const observation = createFireRedObserver({
      session: partyStopLearningSession({ lastViewed: 0, tasks }),
      runtime: fixtureRuntime(),
      runId: `party-move-slot-${stage}`,
    }).capture();
    assert.equal(observation.phase, "stable");
    assert.equal(observation.playerMemory.ui.moveLearning.stage, stage);
    assert.equal(observation.playerMemory.ui.moveLearning.partySlot, 5, stage);
  }
});

test("the Pokémon special animation is autonomous transition state", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x080207c1, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020781, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "pokemon-special-animation",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("transient-task"));
  assert.ok(observation.phaseReasons.includes("transient-callback"));
});

test("a Pokémon special-animation text prompt is an explicit decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x080207c1, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020781, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 2;
  session.put(0x02000400, printers);
  const item = new Uint8Array(2);
  new DataView(item.buffer).setUint16(0, 339, true);
  session.put(0x02000520, item);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "pokemon-special-animation-message",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.specialAnimation, {
    stage: "message",
    task: "Task_ForgetMove",
    itemId: 339,
  });
});

test("an evolution-stone result prompt is an explicit decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x080207c1, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020a21, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const scriptContext = session.memory.get(0x03000a20).slice();
  new DataView(scriptContext.buffer).setUint32(4, 0x0800e001, true);
  session.put(0x03000a20, scriptContext);
  const item = new Uint8Array(2);
  new DataView(item.buffer).setUint16(0, 96, true);
  session.put(0x02000520, item);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "evolution-stone-result-message",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.specialAnimation, {
    stage: "message",
    task: "Task_UseItem_Normal",
    itemId: 96,
  });
});

test("a normal medicine result is actionable from the PSA task state", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x080207c1, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  const taskOffset = 4 * 40;
  const psaPointer = 0x02009000;
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(taskOffset, 0x08020a21, true);
  tasks[taskOffset + 4] = 1;
  taskView.setUint32(taskOffset + 8, psaPointer, true);
  session.put(0x03000600, tasks);
  const psa = new Uint8Array(0x98);
  const psaView = new DataView(psa.buffer);
  psaView.setUint16(0x92, 12, true);
  psaView.setUint16(0x96, 19, true);
  session.put(psaPointer, psa);
  const item = new Uint8Array(2);
  new DataView(item.buffer).setUint16(0, 19, true);
  session.put(0x02000520, item);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "potion-result-message",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.specialAnimation, {
    stage: "message",
    task: "Task_UseItem_Normal",
    itemId: 19,
  });
});

test("an evolution remains transient while an autonomous EvoTask is active", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x080207e1, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x080207a1, true);
  tasks[4 * 40 + 4] = 1;
  new DataView(tasks.buffer).setUint32(5 * 40, 0x080207b1, true);
  tasks[5 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "evolution-animation",
  });

  const observation = observer.capture();
  assert.equal(observation.emulator.mode, "evolution");
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("evolution-transition"));
  assert.equal(observation.playerMemory.ui.evolution, null);
});

test("the completed-evolution message is an explicit stable decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x080207e1, true);
  session.put(0x03000100, main);
  session.put(0x02000b00, Uint8Array.from([1]));
  const party = new Uint8Array(600);
  party.set(
    partyPokemon({ species: 22, level: 20, hp: 61, maxHp: 61 }),
    0,
  );
  session.put(0x02000c00, party);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x080207a1, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 2;
  session.put(0x02000400, printers);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "evolution-complete-message",
  });

  const observation = observer.capture();
  assert.equal(observation.emulator.mode, "evolution");
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.evolution, {
    stage: "complete-message",
    evolvedPartySlot: 0,
    species: 22,
    level: 20,
  });
});

test("an evolution move prompt outranks FireRed's stale in-battle flag", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x080207e1, true);
  main[0x439] = 2; // FireRed keeps this set during a post-battle evolution.
  session.put(0x03000100, main);

  const tasks = session.memory.get(0x03000600).slice();
  const taskOffset = 4 * 40;
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(taskOffset, 0x080207a1, true);
  tasks[taskOffset + 4] = 1;
  taskView.setInt16(taskOffset + 8 + 0 * 2, 22, true); // EVOSTATE_REPLACE_MOVE.
  taskView.setInt16(taskOffset + 8 + 6 * 2, 4, true); // MVSTATE_HANDLE_YES_NO.
  taskView.setInt16(taskOffset + 8 + 7 * 2, 5, true); // YES -> SHOW_MOVE_SELECT.
  taskView.setInt16(taskOffset + 8 + 8 * 2, 10, true); // NO -> ASK_CANCEL.
  taskView.setInt16(taskOffset + 8 + 10 * 2, 0, true); // Party slot.
  session.put(0x03000600, tasks);

  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 2;
  session.put(0x02000400, printers);
  session.put(0x02000268, new Uint8Array(8));
  const move = new Uint8Array(2);
  new DataView(move.buffer).setUint16(0, 184, true); // Scary Face.
  session.put(0x02000270, move);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "evolution-learn-move",
  }).capture();

  assert.equal(observation.emulator.mode, "evolution");
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.moveLearning, {
    stage: "confirm-replace",
    partySlot: 0,
    moveId: 184,
    itemId: 0,
    cursor: 0,
    selected: "yes",
  });
  assert.equal(observation.playerMemory.ui.evolution, null);
  assert.equal(observation.phaseReasons.includes("battle-transition"), false);
});

test("an evolution move prompt is stable from its input substate even when the battle text printer is idle", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x080207e1, true);
  main[0x439] = 2;
  session.put(0x03000100, main);

  const tasks = session.memory.get(0x03000600).slice();
  const taskOffset = 4 * 40;
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(taskOffset, 0x080207a1, true);
  tasks[taskOffset + 4] = 1;
  taskView.setInt16(taskOffset + 8 + 0 * 2, 22, true);
  taskView.setInt16(taskOffset + 8 + 6 * 2, 4, true);
  taskView.setInt16(taskOffset + 8 + 7 * 2, 5, true);
  taskView.setInt16(taskOffset + 8 + 8 * 2, 10, true);
  taskView.setInt16(taskOffset + 8 + 10 * 2, 0, true);
  session.put(0x03000600, tasks);

  // The real post-battle prompt has already entered its input substate while
  // the battle text-printer readiness byte is idle. The task state, not that
  // stale printer, owns whether input can be accepted here.
  session.put(0x02000268, new Uint8Array(8));
  const move = new Uint8Array(2);
  new DataView(move.buffer).setUint16(0, 184, true);
  session.put(0x02000270, move);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "evolution-learn-move-idle-printer",
  }).capture();

  assert.equal(observation.emulator.mode, "evolution");
  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.ui.moveLearning.stage, "confirm-replace");
  assert.equal(observation.phaseReasons.includes("evolution-transition"), false);
});

test("field text that is still printing is a transition, not a decision", () => {
  const session = stableSession();
  session.put(0x02000340, Uint8Array.from([2]));
  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 0;
  session.put(0x02000400, printers);
  session.put(0x03000a10, Uint8Array.from([0]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "field-dialog-printing",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("field-dialog-transition"));
  assert.deepEqual(observation.playerMemory.scripts, {
    globalStatus: "running",
    globalMode: "stopped",
    globalNative: null,
    fieldControlsLocked: true,
  });
  assert.deepEqual(observation.playerMemory.ui.fieldDialog, {
    type: "normal",
    stage: "printing",
    textPrinter: {
      active: true,
      state: 0,
      stateName: "handle-character",
    },
  });
});

test("a field-dialog page prompt is an explicit stable decision boundary", () => {
  const session = stableSession();
  session.put(0x02000340, Uint8Array.from([2]));
  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 2;
  session.put(0x02000400, printers);
  session.put(0x03000a10, Uint8Array.from([0]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "field-dialog-page",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.fieldDialog, {
    type: "normal",
    stage: "awaiting-page",
    textPrinter: {
      active: true,
      state: 2,
      stateName: "clear-prompt",
    },
  });
});

test("a ready task-driven field message is an explicit stable decision boundary", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x08012001, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 1;
  session.put(0x02000400, printers);
  session.put(0x03000a94, Uint8Array.from([1]));
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "task-field-message-page",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.phaseReasons.includes("modal-task-transition"), false);
  assert.equal(observation.phaseReasons.includes("script-lock"), false);
  assert.deepEqual(observation.playerMemory.ui.fieldDialog, {
    type: "task-message",
    stage: "awaiting-page",
    textPrinter: {
      active: true,
      state: 1,
      stateName: "wait-for-press",
    },
  });
});

for (const [step, printerActive, printerState, ready] of [
  [10, true, 1, true], [15, true, 1, true], [15, true, 2, true],
  [4, true, 1, false], [6, true, 1, false], [7, true, 1, false],
  [9, true, 1, false], [13, true, 1, false], [14, true, 1, false],
  [15, true, 0, false], [10, false, 1, false],
]) {
  test(`FireRed fishing state ${step}, printer ${printerActive}/${printerState} has prompt readiness ${ready}`, () => {
    const session = stableSession();
    const runtime = fixtureRuntime();
    runtime.data.symbols.Task_Fishing = { address: 0x08022000, size: 20, region: "ROM" };
    const tasks = session.memory.get(0x03000600).slice();
    const view = new DataView(tasks.buffer);
    view.setUint32(4 * 40, 0x08022001, true);
    tasks[4 * 40 + 4] = 1;
    view.setInt16(4 * 40 + 8, step, true);
    view.setInt16(4 * 40 + 8 + 15 * 2, 2, true);
    session.put(0x03000600, tasks);
    session.put(0x03000a94, Uint8Array.from([1]));
    const printers = session.memory.get(0x02000400).slice();
    printers[27] = Number(printerActive);
    printers[28] = printerState;
    session.put(0x02000400, printers);
    const observation = createFireRedObserver({ session, runtime, runId: "fishing-prompt" }).capture();
    assert.equal(observation.phase, ready ? "stable" : "transition");
    assert.equal(observation.playerMemory.scripts.fieldControlsLocked, true);
    assert.equal(observation.playerMemory.ui.fieldDialog?.task ?? null, ready ? "Task_Fishing" : null);
    const player = createCentralPlayer({ advisors: createPolicyAdvisors() });
    const decision = player.decide(observation);
    assert.equal(decision.kind, ready ? "act" : "resample");
    assert.deepEqual(decision.action.buttons, ready ? ["a"] : []);
    if (ready) {
      assert.equal(decision.action.holdFrames, 1);
      assert.equal(decision.action.releaseFrames, 1);
      assert.ok(decision.action.precondition, "fishing retains native action freshness validation");
    }
  });
}

test("a ready starter prompt remains actionable while its script picture is displayed", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x0801f041, true);
  tasks[4 * 40 + 4] = 1;
  new DataView(tasks.buffer).setInt16(4 * 40 + 8, 1, true);
  session.put(0x03000600, tasks);
  session.put(0x03000a94, Uint8Array.from([1]));
  session.put(0x02000340, Uint8Array.from([2]));
  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 2;
  session.put(0x02000400, printers);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "starter-picture-prompt",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.phaseReasons.includes("transient-task"), false);
  assert.deepEqual(observation.playerMemory.ui.fieldDialog, {
    type: "normal",
    stage: "awaiting-page",
    textPrinter: {
      active: true,
      state: 2,
      stateName: "clear-prompt",
    },
  });
});

test("a ready field dialog outranks a stale blocked-step transition flag", () => {
  const session = stableSession();
  const avatar = session.memory.get(0x02000100).slice();
  avatar[3] = 2;
  session.put(0x02000100, avatar);
  session.put(0x02000340, Uint8Array.from([2]));
  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 2;
  session.put(0x02000400, printers);
  session.put(0x03000a10, Uint8Array.from([0]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "field-dialog-stale-tile-transition",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.ui.fieldDialog.stage, "awaiting-page");
  assert.ok(!observation.phaseReasons.includes("tile-transition"));
});

test("the final field-dialog prompt is observable before controls unlock", () => {
  const session = stableSession();
  const context = session.memory.get(0x03000a20).slice();
  context[1] = 2;
  new DataView(context.buffer).setUint32(4, 0x0800e001, true);
  session.put(0x03000a20, context);
  session.put(0x03000a10, Uint8Array.from([0]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "field-dialog-close",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.fieldDialog, {
    type: "hidden",
    stage: "awaiting-close",
    textPrinter: {
      active: false,
      state: 0,
      stateName: "handle-character",
    },
  });
  assert.equal(observation.playerMemory.scripts.globalNative, "WaitForAorBPress");
});

test("a stale field prompt cannot hide an active battle transition", () => {
  const session = stableSession();
  const context = session.memory.get(0x03000a20).slice();
  context[1] = 2;
  new DataView(context.buffer).setUint32(4, 0x0800e001, true);
  session.put(0x03000a20, context);
  session.put(0x03000a10, Uint8Array.from([0]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x0801e001, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-start-over-stale-dialog",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("transient-task"));
});

test("a locked overworld script without a decision is transient", () => {
  const session = stableSession();
  session.put(0x03000a10, Uint8Array.from([1]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "script-lock",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("script-lock"));
  assert.equal(observation.playerMemory.ui.fieldDialog, null);
  assert.deepEqual(observation.playerMemory.scripts, {
    globalStatus: "waiting",
    globalMode: "stopped",
    globalNative: null,
    fieldControlsLocked: true,
  });
});

test("a blackout recovery prompt is an explicit stable decision", () => {
  const session = stableSession();
  session.put(0x03000a10, Uint8Array.from([2]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x08007101, true);
  tasks[4 * 40 + 4] = 1;
  taskView.setInt16(4 * 40 + 8, 1, true);
  taskView.setInt16(4 * 40 + 10, 3, true);
  session.put(0x03000600, tasks);
  const printers = session.memory.get(0x02000400).slice();
  printers[3 * 36 + 27] = 1;
  printers[3 * 36 + 28] = 1;
  session.put(0x02000400, printers);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "blackout-recovery-message",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.blackout, {
    stage: "recovery-message",
    destination: "pokemon-center",
    selected: "acknowledge",
    textPrinter: {
      active: true,
      state: 1,
      stateName: "wait-for-press",
    },
  });
  assert.ok(!observation.phaseReasons.includes("script-lock"));
});

test("blackout recovery text remains transient while it is printing", () => {
  const session = stableSession();
  session.put(0x03000a10, Uint8Array.from([2]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x08007101, true);
  tasks[4 * 40 + 4] = 1;
  taskView.setInt16(4 * 40 + 8, 4, true);
  taskView.setInt16(4 * 40 + 10, 2, true);
  session.put(0x03000600, tasks);
  const printers = session.memory.get(0x02000400).slice();
  printers[2 * 36 + 27] = 1;
  printers[2 * 36 + 28] = 0;
  session.put(0x02000400, printers);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "blackout-recovery-printing",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.deepEqual(observation.playerMemory.ui.blackout, {
    stage: "printing-recovery-message",
    destination: "home",
    selected: null,
    textPrinter: {
      active: true,
      state: 0,
      stateName: "handle-character",
    },
  });
  assert.ok(observation.phaseReasons.includes("blackout-transition"));
});

test("a field-move animation is transient even while the close prompt remains set", () => {
  const session = stableSession();
  const context = session.memory.get(0x03000a20).slice();
  context[1] = 2;
  new DataView(context.buffer).setUint32(4, 0x0800e001, true);
  session.put(0x03000a20, context);
  session.put(0x03000a10, Uint8Array.from([0]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(0, 0x0801f001, true);
  tasks[4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "field-move-animation",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("transient-task"));
});

test("an abbreviated FldEff task is also observed as a field-move transition", () => {
  const session = stableSession();
  const context = session.memory.get(0x03000a20).slice();
  context[1] = 2;
  new DataView(context.buffer).setUint32(4, 0x0800e001, true);
  session.put(0x03000a20, context);
  session.put(0x03000a10, Uint8Array.from([0]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(0, 0x0801f101, true);
  tasks[4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "surf-field-effect",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("transient-task"));
});

test("a script multichoice task is a stable observable decision boundary", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x0800f001, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 0;
  menu[3] = 0;
  menu[4] = 1;
  menu[9] = 1;
  menu[10] = 2;
  session.put(0x02000320, menu);
  session.put(0x03000a10, Uint8Array.from([1]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "multichoice",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.choiceMenu, {
    cursor: 0,
    minCursor: 0,
    maxCursor: 1,
    columns: 1,
    rows: 2,
    selected: "yes",
  });
  assert.ok(!observation.phaseReasons.includes("script-lock"));
});

test("a script list menu exposes its scrolled absolute cursor as a decision", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  const handlerOffset = 3 * 40;
  taskView.setUint32(handlerOffset, 0x0800f201, true);
  tasks[handlerOffset + 4] = 1;
  taskView.setInt16(handlerOffset + 8, 5, true); // Maximum visible rows.
  taskView.setInt16(handlerOffset + 10, 12, true); // Total menu items.
  taskView.setInt16(handlerOffset + 8 + 14 * 2, 5, true); // List task slot.

  const listOffset = 5 * 40;
  taskView.setUint32(listOffset, 0x0800f301, true);
  tasks[listOffset + 4] = 1;
  taskView.setUint16(listOffset + 8 + 12, 12, true); // Template totalItems.
  taskView.setUint16(listOffset + 8 + 14, 5, true); // Template maxShowed.
  taskView.setUint16(listOffset + 8 + 24, 2, true); // Visible cursor row.
  taskView.setUint16(listOffset + 8 + 26, 8, true); // Items above viewport.
  session.put(0x03000600, tasks);
  session.put(0x03000a10, Uint8Array.from([1]));
  session.put(0x03000a94, Uint8Array.from([1]));

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "script-list-menu",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.choiceMenu, {
    cursor: 10,
    minCursor: 0,
    maxCursor: 11,
    columns: 1,
    rows: 5,
    selected: null,
  });
  assert.ok(!observation.phaseReasons.includes("script-lock"));
});

test("a script yes/no task exposes the shared menu cursor as a decision", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(5 * 40, 0x0800f101, true);
  tasks[5 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 1;
  menu[3] = 0;
  menu[4] = 1;
  menu[9] = 0;
  menu[10] = 0;
  session.put(0x02000320, menu);
  session.put(0x03000a10, Uint8Array.from([1]));
  session.put(0x03000a94, Uint8Array.from([1]));
  const runtime = fixtureRuntime();
  runtime.data.symbols.sMenu = { address: 0x02000310, size: 4 };
  runtime.data.symbols["sMenu@0x02000320"] = {
    address: 0x02000320,
    size: 12,
    sourceName: "sMenu",
  };
  const observer = createFireRedObserver({
    session,
    runtime,
    runId: "yes-no",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.choiceMenu, {
    cursor: 1,
    minCursor: 0,
    maxCursor: 1,
    columns: 0,
    rows: 0,
    selected: "no",
  });
  assert.ok(!observation.phaseReasons.includes("script-lock"));
});

test("field nickname choices are identified from the exact expanded cartridge message", () => {
  const raw = (text) => [...fireRedText(text)].slice(0, -1);
  const prompts = [
    { symbol: "Text_GiveNicknameToThisMon", variable: "gStringVar1", code: 2,
      prefix: raw("Do you want to give a nickname to\nthis "), suffix: [0xac] },
    { symbol: "Text_GiveNicknameToReceivedMon", variable: "gStringVar2", code: 3,
      prefix: raw("Want to give a nickname to the\n"), suffix: [...raw(" you received"), 0xac] },
  ];
  for (const prompt of prompts) for (const scenario of ["nickname", "other-prompt", "stale-text", "wrong-variable"]) {
    const session = stableSession();
    const runtime = fixtureRuntime();
    const tasks = session.memory.get(0x03000600).slice();
    new DataView(tasks.buffer).setUint32(5 * 40, 0x0800f101, true);
    tasks[5 * 40 + 4] = scenario === "stale-text" ? 0 : 1;
    session.put(0x03000600, tasks);
    const menu = session.memory.get(0x02000320).slice();
    menu[2] = 0; menu[3] = 0; menu[4] = 1;
    session.put(0x02000320, menu);
    runtime.data.symbols[prompt.symbol] = { address: 0x081a0000, size: 0 };
    runtime.data.symbols.gStringVar4 = { address: 0x02003000, size: 1000 };
    runtime.data.symbols[prompt.variable] = { address: 0x02003400, size: 32 };
    const template = new Uint8Array(128).fill(0xff);
    template.set([...prompt.prefix, 0xfd, prompt.code, ...prompt.suffix, 0xff]);
    session.put(0x081a0000, template);
    const variable = new Uint8Array(32).fill(0xff);
    variable.set(fireRedText(scenario === "wrong-variable" ? "EEVEE" : "LAPRAS"));
    session.put(0x02003400, variable);
    const expanded = new Uint8Array(1000).fill(0xff);
    expanded.set(scenario === "other-prompt" ? fireRedText("Received LAPRAS.")
      : [...prompt.prefix, ...raw("LAPRAS"), ...prompt.suffix, 0xff]);
    session.put(0x02003000, expanded);
    const observed = createFireRedObserver({ session, runtime,
      runId: `gift-prompt-${prompt.symbol}-${scenario}` }).capture();
    assert.equal(observed.playerMemory.ui.choiceMenu?.purpose,
      scenario === "nickname" ? "pokemon-nickname" : undefined, scenario);
  }
});

test("Mart text printing is transient and native confirmation is observable", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x08012001, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  let observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "mart-printing",
  });
  let observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("modal-task-transition"));

  taskView.setUint32(4 * 40, 0x08011001, true);
  session.put(0x03000600, tasks);
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08013001, true);
  session.put(0x03000100, main);
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 0;
  session.put(0x02000320, menu);
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "mart-confirm",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.mart, {
    stage: "confirm-purchase",
    cursor: 0,
    selected: "yes",
  });
});

test("Mart item-list observation exposes the absolute buy cursor", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08013001, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(2 * 40, 0x08010101, true);
  tasks[2 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const shopData = session.memory.get(0x02000900).slice();
  const shopView = new DataView(shopData.buffer);
  shopView.setUint16(0x0c, 2, true);
  shopView.setUint16(0x0e, 2, true);
  session.put(0x02000900, shopData);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "mart-item-list",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.mart, {
    stage: "item-list",
    cursor: 4,
    selected: null,
  });
});

test("Mart quantity observation exposes the item and requested count", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  runtime.data.symbols.gItems = {
    address: 0x08100000,
    size: 25 * 44,
    region: "ROM",
  };
  const itemTable = new Uint8Array(25 * 44);
  const itemTableView = new DataView(itemTable.buffer);
  itemTableView.setUint16(22 * 44 + 16, 700, true);
  itemTableView.setUint16(14 * 44 + 16, 100, true);
  session.put(0x08100000, itemTable);
  const stock = new Uint8Array(4);
  const stockView = new DataView(stock.buffer);
  stockView.setUint16(0, 22, true);
  stockView.setUint16(2, 14, true);
  session.put(0x080f0000, stock);
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08013001, true);
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(2 * 40, 0x08010201, true);
  tasks[2 * 40 + 4] = 1;
  taskView.setInt16(2 * 40 + 8 + 2, 5, true);
  taskView.setInt16(2 * 40 + 8 + 10, 24, true);
  session.put(0x03000600, tasks);
  const shopData = session.memory.get(0x02000900).slice();
  const shopDataView = new DataView(shopData.buffer);
  shopDataView.setUint32(0x04, 0x080f0000, true);
  shopDataView.setUint16(0x10, 2, true);
  shopDataView.setUint16(0x14, 9, true);
  session.put(0x02000900, shopData);

  const observation = createFireRedObserver({
    session,
    runtime,
    runId: "mart-quantity",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.mart, {
    stage: "quantity",
    cursor: null,
    selected: null,
    itemId: 24,
    quantity: 5,
    maximumQuantity: 9,
    stock: [
      { itemId: 22, price: 700 },
      { itemId: 14, price: 100 },
    ],
  });
});

test("battle controller functions separate decisions from animations", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  const mainView = new DataView(main.buffer);
  mainView.setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000224, u32(1));
  let controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801d001, true);
  session.put(0x03000b10, controllers);
  session.put(0x02000228, Uint8Array.from([3, 0, 0, 0]));

  let observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-action",
  });
  let observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.battle, {
    stage: "action",
    battler: 0,
    cursor: 3,
    selected: "run",
  });

  controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801c001, true);
  session.put(0x03000b10, controllers);
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-animation",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("battle-transition"));
  assert.equal(observation.playerMemory.ui.battle, null);

  controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801b001, true);
  session.put(0x03000b10, controllers);
  session.put(0x0200022c, Uint8Array.from([2, 0, 0, 0]));
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-move",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.battle, {
    stage: "move",
    battler: 0,
    cursor: 2,
    selected: "move-3",
    selectedMoveId: null,
  });

  controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801c001, true);
  session.put(0x03000b10, controllers);
  const printers = session.memory.get(0x02000400).slice();
  printers[27] = 1;
  printers[28] = 1;
  session.put(0x02000400, printers);
  const avatar = session.memory.get(0x02000100).slice();
  avatar[3] = 1;
  session.put(0x02000100, avatar);
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-message",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.battle, {
    stage: "message",
    battler: null,
    cursor: null,
    selected: null,
  });
});

test("a double-battle move preview remains actionable during its palette fade", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000220, u32(1)); // BATTLE_TYPE_DOUBLE
  session.put(0x02000224, u32(1));
  const controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801b001, true);
  session.put(0x03000b10, controllers);
  session.put(0x0200022c, Uint8Array.from([1, 0, 0, 0]));
  const paletteFade = session.memory.get(0x02000200).slice();
  paletteFade[7] = 0x80;
  session.put(0x02000200, paletteFade);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "double-battle-move-preview",
  }).capture();

  assert.equal(observation.emulator.paletteFadeActive, true);
  assert.equal(observation.phase, "stable");
  assert.ok(!observation.phaseReasons.includes("palette-fade"));
  assert.deepEqual(observation.playerMemory.ui.battle, {
    stage: "move",
    battler: 0,
    cursor: 1,
    selected: "move-2",
    selectedMoveId: null,
  });
});

test("an in-battle learn-move Yes/No box is an explicit cartridge decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000224, new Uint8Array(4));
  const scripting = session.memory.get(0x02000240).slice();
  scripting[31] = 1;
  session.put(0x02000240, scripting);
  session.put(0x02000264, u32(0x08030000));
  session.put(0x08030000, Uint8Array.from([0x5a]));
  session.put(0x02000268, Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0]));
  const move = new Uint8Array(2);
  new DataView(move.buffer).setUint16(0, 77, true);
  session.put(0x02000270, move);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-learn-move",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.moveLearning, {
    stage: "confirm-replace",
    partySlot: 0,
    moveId: 77,
    itemId: 0,
    cursor: 1,
    selected: "no",
  });
});

test("an in-battle stop-learning Yes/No box is distinguished by its opcode", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const scripting = session.memory.get(0x02000240).slice();
  scripting[31] = 1;
  session.put(0x02000240, scripting);
  session.put(0x02000264, u32(0x08030000));
  session.put(0x08030000, Uint8Array.from([0x5b]));
  session.put(0x02000268, new Uint8Array(8));

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-stop-learning",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.ui.moveLearning.stage, "confirm-stop-learning");
  assert.equal(observation.playerMemory.ui.moveLearning.selected, "yes");
});

test("the in-battle summary move picker exposes its real learned move and cursor", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019201, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020601, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  session.put(0x02000540, Uint8Array.from([1]));
  const stalePartyMenu = session.memory.get(0x02000548).slice();
  stalePartyMenu[9] = 1;
  session.put(0x02000548, stalePartyMenu);
  session.put(0x02000542, Uint8Array.from([0]));
  session.put(0x02000544, u32(0x02003000));
  session.put(0x02006288, Uint8Array.from([2]));
  const move = new Uint8Array(2);
  new DataView(move.buffer).setUint16(0, 77, true);
  session.put(0x02000270, move);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-forget-move",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.moveLearning, {
    stage: "forget-move",
    partySlot: 0,
    moveId: 77,
    itemId: 0,
    cursor: 1,
    selected: "move-2",
  });
});

test("Oak's tutorial battle prompt reads the source-defined voiceover text window", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000224, u32(1));
  const controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801c041, true);
  session.put(0x03000b10, controllers);
  const printers = session.memory.get(0x02000400).slice();
  const voiceoverOffset = 24 * 36;
  printers[voiceoverOffset + 27] = 1;
  printers[voiceoverOffset + 28] = 2;
  session.put(0x02000400, printers);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "oak-tutorial-message",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.battle, {
    stage: "message",
    battler: null,
    cursor: null,
    selected: null,
  });
});

test("the Oak tutorial controller exposes its wrapped move menu as a decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000224, u32(1));
  const controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801b041, true);
  session.put(0x03000b10, controllers);
  session.put(0x0200022c, Uint8Array.from([0, 0, 0, 0]));
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "oak-tutorial-move-menu",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.battle, {
    stage: "move",
    battler: 0,
    cursor: 0,
    selected: "move-1",
    selectedMoveId: null,
  });
});

test("double-battle target selection exposes FireRed's legal default target", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000224, u32(1));
  const controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801b081, true);
  session.put(0x03000b10, controllers);
  session.put(0x02007750, Uint8Array.from([3]));
  session.put(0x02007751, Uint8Array.from([4]));
  const battleMons = new Uint8Array(352);
  battleMons.set(battlePokemon({
    species: 25,
    level: 30,
    hp: 70,
    maxHp: 70,
    moves: [85],
    pp: [15],
  }), 0);
  battleMons.set(battlePokemon({
    species: 74,
    level: 28,
    hp: 40,
    maxHp: 70,
  }), 264);
  session.put(0x02007000, battleMons);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "double-target",
  }).capture();

  assert.deepEqual(observation.playerMemory.ui.battle, {
    stage: "target",
    battler: 0,
    cursor: 3,
    selected: "battler-3",
    selectedSpecies: 74,
    selectedMoveId: 85,
  });
});

test("battle observations identify both active battlers and the selected move ID", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801b001, true);
  session.put(0x03000b10, controllers);
  session.put(0x0200022c, Uint8Array.from([1, 0, 0, 0]));
  const battleMons = new Uint8Array(352);
  battleMons.set(battlePokemon({
    species: 135,
    level: 59,
    hp: 52,
    maxHp: 156,
    moves: [86, 351, 87, 98],
    pp: [20, 17, 7, 30],
    spAttack: 167,
    type1: 13,
  }), 0);
  battleMons.set(battlePokemon({
    species: 59,
    level: 59,
    hp: 193,
    maxHp: 193,
    moves: [245, 53, 46, 44],
    pp: [5, 15, 20, 25],
    spDefense: 117,
    type1: 10,
  }), 88);
  session.put(0x02007000, battleMons);
  const statuses3 = new Uint8Array(16);
  new DataView(statuses3.buffer).setUint32(4, 1 << 2, true);
  session.put(0x02007180, statuses3);
  session.put(0x02007190, Uint8Array.from([0b0000_0011, 0]));
  const battlerPartyIndexes = new Uint8Array(8);
  const battlerPartyIndexView = new DataView(battlerPartyIndexes.buffer);
  battlerPartyIndexView.setUint16(0, 1, true);
  battlerPartyIndexView.setUint16(2, 4, true);
  session.put(0x02007192, battlerPartyIndexes);

  const runtime = fixtureRuntime();
  runtime.data.symbols.gBattleWeather = { address: 0x02007760, size: 2 };
  session.put(0x02007760, Uint8Array.from([32, 0]));
  const observation = createFireRedObserver({
    session,
    runtime,
    runId: "identified-battle",
  }).capture();

  assert.equal(observation.playerMemory.battle.weather, 32);
  assert.equal(observation.playerMemory.battle.player.species, 135);
  assert.deepEqual(observation.playerMemory.battle.player.moves, [86, 351, 87, 98]);
  assert.equal(observation.playerMemory.battle.opponent.species, 59);
  assert.equal(observation.playerMemory.battle.opponent.hp, 193);
  assert.equal(observation.playerMemory.battle.opponent.status3, 1 << 2);
  assert.deepEqual(observation.playerMemory.battle.sentPartyMasks, [3, 0]);
  assert.deepEqual(observation.playerMemory.battle.battlerPartyIndexes,
    [1, 4, 0, 0]);
  assert.equal(observation.playerMemory.battle.playerPartySlot, 1);
  assert.equal(observation.playerMemory.ui.battle.selectedMoveId, 351);
});

test("battle party menus translate every single and double active-slot arrangement into displayed party slots", () => {
  const slots = [0, 1, 2, 3, 4, 5];
  for (const left of slots) for (const right of [null, ...slots.filter(slot => slot !== left)]) {
    const session = stableSession();
    const main = session.memory.get(0x03000100).slice();
    new DataView(main.buffer).setUint32(4, 0x08009201, true);
    main[0x439] = 2;
    session.put(0x03000100, main);
    session.put(0x02000220, u32(right === null ? 0 : 1));
    const active = right === null ? [left] : [left, right];
    const order = [...active, ...slots.filter(slot => !active.includes(slot))];
    const species = [1, 4, 7, 25, 131, 143];
    const displayedParty = new Uint8Array(600);
    order.forEach((fieldSlot, menuSlot) => displayedParty.set(
      partyPokemon({species: species[fieldSlot], level: 50, hp: 100, maxHp: 100}), menuSlot * 100));
    session.put(0x02000b00, Uint8Array.from([6]));
    session.put(0x02000c00, displayedParty);
    session.put(0x0200719a, Uint8Array.from([0, 2, 4], i => order[i] * 16 + order[i + 1]));
    const nativeIndexes = [left, 4, right ?? 0, 2];
    const indexes = new Uint8Array(8);
    nativeIndexes.forEach((slot, i) => new DataView(indexes.buffer).setUint16(i * 2, slot, true));
    session.put(0x02007192, indexes);
    session.put(0x02007190, Uint8Array.from([0b101001, 0b000110]));
    session.put(0x02007478, u32(0x02007500));
    const battleStruct = new Uint8Array(0x200);
    battleStruct.set([1, 6, 4, 6], 0x5c);
    session.put(0x02007500, battleStruct);
    const menu = new Uint8Array(20);menu[8] = 1;
    session.put(0x02000548, menu);
    const tasks = new Uint8Array(640);
    new DataView(tasks.buffer).setUint32(0, 0x08020401, true);tasks[4] = 1;
    session.put(0x03000600, tasks);
    const observer = createFireRedObserver({session, runtime: fixtureRuntime(), runId: `party-order-${left}-${right}`});
    const observed = observer.capture(), battle = observed.playerMemory.battle;
    assert.equal(battle.playerPartySlot, 0, `the left active battler is displayed first for ${order}`);
    assert.equal(observed.playerMemory.trainer.party[battle.playerPartySlot].species, species[left]);
    assert.deepEqual(battle.battlerPartyIndexes, [0, 4, order.indexOf(right ?? 0), 2]);
    assert.deepEqual(battle.monToSwitchIntoIds, [order.indexOf(1), 6, order.indexOf(4), 6]);
    assert.equal(observed.playerMemory.trainer.party[battle.monToSwitchIntoIds[0]].species, species[1]);
    assert.equal(observed.playerMemory.trainer.party[battle.monToSwitchIntoIds[2]].species, species[4]);
    for (let opponent = 0; opponent < 2; opponent++) {
      const originalParticipants = opponent ? [1, 2] : [0, 3, 5];
      const observedParticipants = slots.filter(slot => battle.sentPartyMasks[opponent] & (1 << slot)).map(slot => order[slot]).sort();
      assert.deepEqual(observedParticipants, originalParticipants, 'participation must stay attached to the same Pokémon');
    }
    new DataView(main.buffer).setUint32(4, 0x08019201, true);session.put(0x03000100, main);
    assert.equal(observer.capture().playerMemory.battle.playerPartySlot, 0,
      'battle summary screens preserve the displayed party ordering');
    // Leaving the menu restores the cartridge party to field order. A stale
    // gBattlePartyCurrentOrder must not remap battle commands or the bag.
    for (const callback of [0x08019001, 0x08009101]) {
      new DataView(main.buffer).setUint32(4, callback, true);session.put(0x03000100, main);
      session.put(0x03000600, new Uint8Array(640));
      const fieldBattle = observer.capture().playerMemory.battle;
      assert.deepEqual(fieldBattle.battlerPartyIndexes, nativeIndexes);
      assert.deepEqual(fieldBattle.sentPartyMasks, [0b101001, 0b000110]);
    }
  }
});

test("an unavailable battle party permutation waits for coherent menu data before selecting a Pokémon", () => {
  const session = stableSession(), main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);main[0x439] = 2;
  session.put(0x03000100, main);
  const menu = new Uint8Array(20);menu[8] = 1;session.put(0x02000548, menu);
  const tasks = new Uint8Array(640);
  new DataView(tasks.buffer).setUint32(0, 0x08020401, true);tasks[4] = 1;
  session.put(0x03000600, tasks);
  const observer = createFireRedObserver({session, runtime: fixtureRuntime(), runId: 'party-order-readiness'});
  for (const order of [[0, 0, 0], [0x01, 0x23, 0x4f]]) {
    session.put(0x0200719a, Uint8Array.from(order));
    const o = observer.capture();
    assert.equal(o.phase, 'transition');
    assert.ok(o.phaseReasons.includes('battle-party-order-unavailable'));
    const decision = createCentralPlayer({advisors: createPolicyAdvisors({})}).decide(o);
    assert.deepEqual(decision.action.buttons, []);
  }
  session.put(0x0200719a, Uint8Array.from([0x01, 0x23, 0x45]));
  assert.ok(!observer.capture().phaseReasons.includes('battle-party-order-unavailable'));
});

test("battle observations expose queued double-battle switch reservations", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02007478, u32(0x02007500));
  const battleStruct = new Uint8Array(0x200);
  battleStruct.set([3, 6, 6, 6], 0x5c);
  session.put(0x02007500, battleStruct);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "queued-double-switch",
  }).capture();

  assert.deepEqual(
    observation.playerMemory.battle.monToSwitchIntoIds,
    [3, 6, 6, 6],
  );
});

test("boss auditing exposes the native trainer ID, never an inferred screen name", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  runtime.data.symbols.gTrainerBattleOpponent_A = { address: 0x0200a500, size: 2 };
  session.put(0x0200a500, Uint8Array.of(0x9e, 1)); // Brock, trainer 414
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const observer = createFireRedObserver({ session, runtime, runId: "boss-audit" });
  assert.equal(observer.capture().playerMemory.battle.trainerId, 414);
  delete runtime.data.symbols.gTrainerBattleOpponent_A;
  assert.equal(createFireRedObserver({ session, runtime, runId: "unknown-trainer" }).capture().playerMemory.battle.trainerId, null);
});

test("battle observations preserve a transformed opponent's original species", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  runtime.data.symbols.gEnemyParty = { address: 0x0200a000, size: 600 };
  const enemyParty = new Uint8Array(600);
  enemyParty.set(partyPokemon({
    species: 132,
    level: 23,
    hp: 56,
    maxHp: 56,
    moves: [144],
    pp: [10],
  }));
  session.put(0x0200a000, enemyParty);

  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const battleMons = new Uint8Array(352);
  battleMons.set(battlePokemon({
    species: 135,
    level: 30,
    hp: 100,
    maxHp: 100,
    moves: [98],
    pp: [20],
  }), 0);
  battleMons.set(battlePokemon({
    species: 135,
    level: 23,
    hp: 12,
    maxHp: 56,
    moves: [98],
    pp: [10],
  }), 88);
  session.put(0x02007000, battleMons);

  const observation = createFireRedObserver({
    session,
    runtime,
    runId: "transformed-ditto",
  }).capture();

  assert.equal(observation.playerMemory.battle.opponent.species, 135);
  assert.equal(observation.playerMemory.battle.opponent.originalSpecies, 132);
  assert.equal(observation.playerMemory.encounter.validity, "valid");
  assert.equal(observation.playerMemory.encounter.pokemon.species, 132);
  assert.equal(observation.playerMemory.encounter.pokemon.shiny, true);

  // Stale battle battler from another encounter must not validate this record.
  new DataView(battleMons.buffer).setUint32(88 + 72, 8, true);
  session.put(0x02007000, battleMons);
  const stale = createFireRedObserver({ session, runtime, runId: "stale-battler" }).capture();
  assert.equal(stale.playerMemory.encounter.validity, "unknown");
  assert.equal(stale.playerMemory.encounter.pokemon, null);
});

test("uninitialized enemy RAM is unknown in battle and absent outside battle", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  const observer = createFireRedObserver({ session, runtime, runId: "uninitialized-enemy" });
  assert.equal(observer.capture().playerMemory.encounter, null);
  const main = session.memory.get(0x03000100).slice();
  main[0x439] = 2;
  session.put(0x03000100, main);
  assert.equal(observer.capture().playerMemory.encounter.validity, "unknown");
});

test("old man battle flags identify the catching tutorial even before its enemy record initializes", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  main[0x439] = 2;
  session.put(0x03000100, main);
  const observer = createFireRedObserver({ session, runtime: fixtureRuntime(), runId: "old-man-tutorial" });
  for (const [flags, kind] of [[512, "tutorial"], [516, "tutorial"], [4, "wild"], [12, "trainer"]]) {
    session.put(0x02000220, u32(flags));
    assert.equal(observer.capture().playerMemory.encounter.kind, kind);
  }
});

test("optional RNG observation uses runtime symbols and shares the atomic capture", () => {
  const session = stableSession();
  const runtime = fixtureRuntime();
  runtime.data.symbols.gRngValue = { address: 0x03000bc0, size: 4 };
  runtime.data.symbols.sWildEncounterData = { address: 0x0200a000, size: 12 };
  runtime.data.structures.SaveBlock2.fields.playerTrainerId = { offset: 10 };
  session.put(0x03000bc0, u32(0xfedcba98));
  const wild = new Uint8Array(12); wild.set(u32(0x80000001)); wild[8] = 7;
  session.put(0x0200a000, wild);
  const save2 = session.memory.get(0x02002000).slice(); save2.set(u32(0x12345678), 10);
  session.put(0x02002000, save2);
  const off = createFireRedObserver({ session, runtime, runId: "rng-off" }).capture();
  assert.equal(off.playerMemory.rng, undefined);
  const on = createFireRedObserver({ session, runtime, runId: "rng-on", observeRng: true }).capture();
  assert.equal(on.playerMemory.rng.validity, "valid");
  assert.equal(on.playerMemory.rng.mainState, 0xfedcba98);
  assert.equal(on.playerMemory.rng.wildState, 0x80000001);
  assert.equal(on.playerMemory.rng.stepsSinceLastEncounter, 7);
  const timing = createFireRedObserver({ session, runtime, runId: "rng-timing", observeRng: true }).captureTimingState();
  assert.equal(timing.frame, on.frame);
  assert.equal(timing.rng.mainState, on.playerMemory.rng.mainState);
  assert.equal(timing.rng.wildState, on.playerMemory.rng.wildState);
  assert.equal(on.playerMemory.trainer.trainerId, 0x5678);
  assert.equal(on.playerMemory.trainer.secretId, 0x1234);
  assertAtomicObservation(on);
});

test("native-save quest-log playback is not presented as current actionable gameplay", () => {
  const runtime = fixtureRuntime(), session = stableSession();
  runtime.data.symbols.gQuestLogState = { address: 0x0200b000, size: 1 };
  session.put(0x0200b000, new Uint8Array([2]));
  const observer = createFireRedObserver({ session, runtime, runId: "native-recap" });
  observer.capture();
  const observed = observer.capture();
  assert.equal(observed.playerMemory.questLog?.playback, true);
  assert.ok(observed.phaseReasons.includes("quest-log-playback"));
  assert.equal(observed.emulator.inputReady, false);
});

test("battle observations expose FireRed's native action-legality state", () => {
  const session = stableSession(), runtime=fixtureRuntime();
  runtime.data.symbols.gSideStatuses={address:0x0200b040,size:4};
  runtime.data.symbols.gBattleWeather={address:0x0200b050,size:2};
  runtime.data.symbols.gEnigmaBerries={address:0x0200b060,size:108};
  runtime.data.symbols.gBattleResources={address:0x0200b0d0,size:4};
  session.put(0x0200b050,new Uint8Array([1,0]));
  const enigma=new Uint8Array(108);enigma[7]=29;enigma[26]=10;session.put(0x0200b060,enigma);
  session.put(0x0200b0d0,u32(0x0200b100));const resource=new Uint8Array(8);resource.set(u32(0x0200b110),4);session.put(0x0200b100,resource);
  const resourceFlags=new Uint8Array(16);resourceFlags[0]=1;session.put(0x0200b110,resourceFlags);
  const badgeSave=session.memory.get(0x02001000).slice();badgeSave[3808+260]=0x51;session.put(0x02001000,badgeSave);

  session.put(0x0200b040,new Uint8Array([0x20,1,0x20,0]));
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801a001, true);
  session.put(0x03000b10, controllers);

  const battleMons = new Uint8Array(352);
  battleMons.set(battlePokemon({
    species: 5,
    level: 21,
    hp: 22,
    maxHp: 57,
    moves: [10, 45, 52, 43],
    pp: [30, 35, 25, 30],
    speed: 42,
    ability: 50,
    item: 194,
    status2: 0x6000,
  }), 0);
  battleMons.set(battlePokemon({
    species: 23,
    level: 10,
    hp: 10,
    maxHp: 28,
    moves: [35, 43, 40, 0],
    pp: [18, 30, 35, 0],
    speed: 26,
    ability: 22,
  }), 88);
  battleMons[43] = 201;
  new DataView(battleMons.buffer).setUint32(20, 0x3fffffff, true);
  session.put(0x02007000, battleMons);

  const disableStructs = new Uint8Array(112);
  const disableView = new DataView(disableStructs.buffer);
  disableView.setUint16(4, 52, true);
  disableView.setUint16(6, 10, true);
  disableStructs[0x08] = 2;
  disableStructs[0x09] = 3;
  disableStructs[0x0a] = 18;
  disableStructs[0x10] = 4;
  disableStructs[0x0b] = 0x43;
  disableStructs[0x0c] = 0;
  disableStructs[0x0e] = 0x25;
  disableStructs[0x0f] = 0x31;
  disableStructs[0x11] = 0x22;
  disableStructs[0x12] = 0x14;
  disableStructs[0x13] = 0x36;
  disableStructs[0x14] = 1;
  disableStructs[0x16] = 1;
  disableStructs[0x19] = 2;
  session.put(0x02007400, disableStructs);

  const lastMoves = new Uint8Array(8);
  new DataView(lastMoves.buffer).setUint16(0, 45, true);
  session.put(0x02007470, lastMoves);
  session.put(0x02007478, u32(0x02007500));
  const battleStruct = new Uint8Array(0x200);
  battleStruct[0x6c] = 3;
  new DataView(battleStruct.buffer).setUint16(0xc8, 10, true);
  session.put(0x02007500, battleStruct);
  const battleResults = new Uint8Array(68);
  battleResults[0x13] = 7;
  session.put(0x02007700, battleResults);

  const observation = createFireRedObserver({
    session,
    runtime,
    runId: "native-battle-legality",
  }).capture();
  const { player, runAttempts, turn } = observation.playerMemory.battle;

  assert.equal(player.ability, 50);
  assert.equal(player.item, 194);
  assert.equal(player.sideStatus, 0x120);
  assert.equal(player.battleWeather,1);
  assert.equal(player.sideAlive,1);
  assert.equal(player.flashFireActive,true);
  assert.deepEqual(player.enigmaBerry,{effectId:29,param:10});
  assert.deepEqual(player.badgeBoosts,{attack:true,defense:true,spAttack:true,spDefense:true,speed:false});
  assert.equal(player.friendship, 201);
  assert.deepEqual(player.ivs, {hp:31,attack:31,defense:31,speed:31,spAttack:31,spDefense:31});
  assert.equal(player.status2, 0x6000);
  assert.deepEqual(player.moveState, {
    protectUses: 2,
    stockpileCount: 3,
    substituteHp: 18,
    furyCutterCount: 4,
    disabledMove: 52,
    disableTurns: 3,
    encoredMove: 10,
    encoredMoveSlot: 0,
    encoreTurns: 5,
    perishSongTurns: 1,
    rolloutTurns: 2,
    chargeTurns: 4,
    tauntTurns: 6,
    battlerPreventingEscape: 1,
    isFirstTurn: true,
    rechargeTurns: 2,
    lastMove: 45,
    choiceLockedMove: 10,
  });
  assert.equal(runAttempts, 3);
  assert.equal(turn, 7);
});

test("battle observations expose cartridge stat stages for defensive planning", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000224, u32(1));
  const controllers = new Uint8Array(16);
  new DataView(controllers.buffer).setUint32(0, 0x0801b001, true);
  session.put(0x03000b10, controllers);
  const battleMons = new Uint8Array(352);
  battleMons.set(battlePokemon({
    species: 1,
    level: 5,
    hp: 19,
    maxHp: 19,
    moves: [33, 45],
  }), 0);
  battleMons.set(battlePokemon({
    species: 4,
    level: 5,
    hp: 18,
    maxHp: 18,
    moves: [10, 45],
    statStages: [6, 4, 6, 6, 6, 6, 6, 6],
  }), 88);
  session.put(0x02007000, battleMons);
  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-stat-stages",
  }).capture();

  assert.deepEqual(observation.playerMemory.battle.opponent.statStages, {
    hp: 6,
    attack: 4,
    defense: 6,
    speed: 6,
    spAttack: 6,
    spDefense: 6,
    accuracy: 6,
    evasion: 6,
  });
});

test("battle level-up stat pages are explicit cartridge decisions", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  const scripting = new Uint8Array(36);
  scripting[30] = 6;
  session.put(0x02000240, scripting);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-level-up-page",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.battle, {
    stage: "level-up-stats",
    battler: null,
    cursor: 0,
    selected: "advance",
    page: 1,
  });
  assert.deepEqual(observation.playerMemory.battleScripting, {
    drawLevelUpBoxState: 6,
    learnMoveState: 0,
  });
});

test("the shift prompt exposes its announced opponent and cursor Pokemon", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000b00, Uint8Array.from([2]));
  const partyBytes = new Uint8Array(600);
  partyBytes.set(partyPokemon({
    species: 6,
    level: 91,
    hp: 266,
    maxHp: 266,
    moves: [17, 53, 83, 19],
  }), 0);
  partyBytes.set(partyPokemon({
    species: 135,
    level: 59,
    hp: 52,
    maxHp: 156,
    moves: [86, 351, 87, 98],
  }), 100);
  session.put(0x02000c00, partyBytes);
  const partyMenu = session.memory.get(0x02000548).slice();
  partyMenu[9] = 1;
  session.put(0x02000548, partyMenu);
  const tasks = session.memory.get(0x03000600).slice();
  new DataView(tasks.buffer).setUint32(4 * 40, 0x08020401, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const text = new Uint8Array(300);
  text.set(fireRedText("CHAMPION BLUE is about to use ARCANINE."));
  session.put(0x02007200, text);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "announced-opponent",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.battle.announcedOpponentName, "ARCANINE");
  assert.equal(observation.playerMemory.ui.party.cursorPokemon.species, 135);
  assert.deepEqual(observation.playerMemory.ui.party.cursorPokemon.moves, [86, 351, 87, 98]);
});

test("the battle shift Yes/No opcode is an explicit cartridge decision", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000264, u32(0x08030000));
  session.put(0x08030000, Uint8Array.from([0x67]));
  session.put(0x02000268, Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 0]));
  const scriptContext = session.memory.get(0x03000a20).slice();
  new DataView(scriptContext.buffer).setUint32(4, 0x0800e001, true);
  session.put(0x03000a20, scriptContext);
  session.put(0x03000a94, Uint8Array.from([1]));
  const text = new Uint8Array(300);
  text.set(fireRedText("TEAM ROCKET GRUNT is about to use DROWZEE."));
  session.put(0x02007200, text);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "battle-shift-choice",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.choiceMenu, {
    cursor: 1,
    minCursor: 0,
    maxCursor: 1,
    columns: 1,
    rows: 2,
    selected: "no",
  });
  assert.equal(observation.playerMemory.ui.fieldDialog, null);
  assert.equal(observation.playerMemory.battle.announcedOpponentName, "DROWZEE");
});

test("the caught-Pokemon Yes/No range identifies the nickname prompt", () => {
  const session = stableSession();
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08019001, true);
  main[0x439] = 2;
  session.put(0x03000100, main);
  session.put(0x02000264, u32(0x08031008));
  // Cmd_trygivecaughtmonnick owns this Yes/No menu; it is not the generic
  // battle Yes/No opcode used by shift and move-learning prompts.
  session.put(0x08031008, Uint8Array.from([0xf3]));
  session.put(0x02000268, Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]));

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "capture-nickname-choice",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.battle.scriptName,
    "capture-nickname-prompt");
  assert.equal(observation.playerMemory.ui.choiceMenu.selected, "yes");
});

test("PC and graphical storage decisions expose their source-backed selections", () => {
  const session = stableSession();
  let tasks = session.memory.get(0x03000600).slice();
  let taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x08016001, true);
  taskView.setInt16(4 * 40 + 8, 2, true);
  taskView.setInt16(4 * 40 + 10, 1, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const context = session.memory.get(0x03000a20).slice();
  context[1] = 2;
  new DataView(context.buffer).setUint32(4, 0x0800e001, true);
  session.put(0x03000a20, context);
  session.put(0x03000a94, Uint8Array.from([1]));
  let observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "pc-menu",
  });
  let observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.ui.fieldDialog, null);
  assert.deepEqual(observation.playerMemory.ui.storage, {
    stage: "pc-menu",
    option: 1,
    selected: "deposit",
    boxOption: null,
    cursorArea: null,
    cursorPosition: null,
    currentBox: null,
    movingPokemon: null,
    depositBox: null,
  });

  tasks = new Uint8Array(640);
  taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x08017001, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08015001, true);
  session.put(0x03000100, main);
  session.put(0x02000e80, u32(0x02003000));
  session.put(0x02003000, Uint8Array.from([0, 1]));
  session.put(0x03000b00, u32(0x02004000));
  const pokemonStorage = new Uint8Array(4 + 14 * 30 * 80);
  pokemonStorage[0] = 2;
  session.put(0x02004000, pokemonStorage);
  session.put(0x02000e84, Uint8Array.from([1]));
  session.put(0x02000e85, Uint8Array.from([1]));
  session.put(0x02000e86, Uint8Array.from([0]));
  session.put(0x02000e87, Uint8Array.from([0]));
  session.put(0x02000e88, Uint8Array.from([1]));
  session.put(0x02000e89, Uint8Array.from([2]));
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "storage-main",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.storage, {
    stage: "storage-main",
    option: null,
    selected: null,
    boxOption: "deposit",
    cursorArea: "party",
    cursorPosition: 0,
    currentBox: 2,
    movingPokemon: false,
    depositBox: 2,
  });

  tasks = new Uint8Array(640);
  taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x08018001, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "storage-closing",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "transition");
  assert.ok(observation.phaseReasons.includes("storage-transition"));
  assert.equal(observation.playerMemory.ui.storage, null);

  session.put(0x02003000, Uint8Array.from([2, 1]));
  const storageMenu = session.memory.get(0x02000320).slice();
  storageMenu[2] = 0;
  session.put(0x02000320, storageMenu);
  observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "storage-confirm-continue",
  });
  observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.storage, {
    stage: "confirm-continue",
    option: 0,
    selected: "yes",
    boxOption: "deposit",
    cursorArea: "party",
    cursorPosition: 0,
    currentBox: 2,
    movingPokemon: false,
    depositBox: 2,
  });
});

test("the deposit box UI exposes the live chooser instead of the last used box", () => {
  const session = stableSession();
  const tasks = new Uint8Array(640);
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(4 * 40, 0x08017201, true);
  tasks[4 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08015001, true);
  session.put(0x03000100, main);
  session.put(0x02000e80, u32(0x02003000));
  session.put(0x02003000, Uint8Array.from([1, 1]));
  session.put(0x03000b00, u32(0x02004000));
  session.put(0x02004000, new Uint8Array(4 + 14 * 30 * 80));
  session.put(0x02000e89, Uint8Array.from([0]));
  session.put(0x02000e8c, u32(0x02005000));
  // ChooseBoxMenu.curBox is at 0x244 in the pinned FireRed structure.
  session.put(0x02005244, Uint8Array.from([1]));

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "storage-deposit-live-box",
  }).capture();

  assert.equal(observation.phase, "stable");
  assert.equal(observation.playerMemory.ui.storage.stage, "deposit-box");
  assert.equal(observation.playerMemory.ui.storage.depositBox, 1);
});

test("the observer decodes boxed Pokemon from FireRed's aligned storage layout", () => {
  const session = stableSession();
  const boxPokemonBytes = 80;
  const pokemonPerBox = 30;
  const boxCount = 14;
  // PokemonStorage.currentBox is followed by three alignment bytes before the
  // BoxPokemon array. The subsequent boxNames field begins at 0x8344.
  const storage = new Uint8Array(4 + boxCount * pokemonPerBox * boxPokemonBytes);
  storage[0] = 2;
  storage.set(
    partyPokemon({
      species: 43,
      moves: [71, 77, 78, 79],
      pp: [25, 35, 30, 15],
    }).slice(0, boxPokemonBytes),
    4 + (2 * pokemonPerBox + 7) * boxPokemonBytes,
  );
  storage.set(
    partyPokemon({ species: 84, moves: [64, 45], pp: [35, 40] })
      .slice(0, boxPokemonBytes),
    4 + (9 * pokemonPerBox + 3) * boxPokemonBytes,
  );
  session.put(0x03000b00, u32(0x02004000));
  session.put(0x02004000, storage);

  const observation = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "boxed-pokemon",
  }).capture();

  assert.deepEqual(observation.playerMemory.trainer.storage, {
    currentBox: 2,
    validity: "valid", unknownSlots: 0,
    boxCounts: [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    pokemon: [{
      ...zeroIdentity,
      box: 2,
      slot: 7,
      species: 43,
      heldItem: 0,
      experience: 0,
      ppBonuses: 0,
      moves: [71, 77, 78, 79],
      pp: [25, 35, 30, 15],
    }, {
      ...zeroIdentity,
      box: 9,
      slot: 3,
      species: 84,
      heldItem: 0,
      experience: 0,
      ppBonuses: 0,
      moves: [64, 45, 0, 0],
      pp: [35, 40, 0, 0],
    }],
  });
});

test("the native-save confirmation exposes its callback and default Yes choice", () => {
  const session = stableSession();
  const tasks = session.memory.get(0x03000600).slice();
  const taskView = new DataView(tasks.buffer);
  taskView.setUint32(3 * 40, 0x08004001, true);
  taskView.setInt16(3 * 40 + 8, 1, true);
  tasks[3 * 40 + 4] = 1;
  session.put(0x03000600, tasks);
  session.put(0x02000300, Uint8Array.from([4]));
  session.put(0x02000310, u32(0x0800a001));
  session.put(0x03000a00, u32(0x0800b001));
  const menu = session.memory.get(0x02000320).slice();
  menu[2] = 0;
  session.put(0x02000320, menu);
  const observer = createFireRedObserver({
    session,
    runtime: fixtureRuntime(),
    runId: "save-confirmation",
  });

  const observation = observer.capture();
  assert.equal(observation.phase, "stable");
  assert.deepEqual(observation.playerMemory.ui.saveDialog, {
    callback: "SaveDialogCB_AskSaveHandleInput",
    stage: "confirm-save",
    printing: false,
    delay: 0,
    cursor: 0,
    selected: "yes",
    attemptStatus: 0,
    attemptResult: null,
  });
});

test('opening another save cannot reuse the previous save success callback',()=>{
 const session=stableSession(),runtime=fixtureRuntime();
 runtime.data.symbols.StartCB_Save1={address:0x0800a100,size:20,region:'ROM'};
 const tasks=session.memory.get(0x03000600).slice(),view=new DataView(tasks.buffer);
 view.setUint32(3*40,0x08004001,true);view.setInt16(3*40+8,1,true);tasks[3*40+4]=1;
 session.put(0x03000600,tasks);
 session.put(0x02000310,u32(0x0800a101));
 session.put(0x03000a00,u32(0x0800d001));
 session.put(0x0300000a,Uint8Array.from([1,0]));
 const o=createFireRedObserver({session,runtime,runId:'stale-save-success'}).capture();
 assert.equal(o.phase,'transition');
 assert.equal(o.playerMemory.ui.saveDialog.stage,'initializing');
 assert.equal(o.playerMemory.ui.saveDialog.attemptResult,null);
});

test("native-save writing is transient and successful completion is observable", () => {
  for (const state of [
    {
      callback: 0x0800c001,
      phase: "transition",
      reason: "save-dialog-transition",
      stage: "saving",
      attemptStatus: 0,
      attemptResult: null,
    },
    {
      callback: 0x0800d001,
      phase: "stable",
      reason: null,
      stage: "success",
      attemptStatus: 1,
      attemptResult: "ok",
    },
  ]) {
    const session = stableSession();
    const tasks = session.memory.get(0x03000600).slice();
    const taskView = new DataView(tasks.buffer);
    taskView.setUint32(3 * 40, 0x08004001, true);
    taskView.setInt16(3 * 40 + 8, 1, true);
    tasks[3 * 40 + 4] = 1;
    session.put(0x03000600, tasks);
    session.put(0x02000310, u32(0x0800a001));
    session.put(0x03000a00, u32(state.callback));
    session.put(
      0x0300000a,
      Uint8Array.from([state.attemptStatus, 0]),
    );
    const observer = createFireRedObserver({
      session,
      runtime: fixtureRuntime(),
      runId: `save-${state.stage}`,
    });

    const observation = observer.capture();
    assert.equal(observation.phase, state.phase);
    if (state.reason) assert.ok(observation.phaseReasons.includes(state.reason));
    assert.equal(observation.playerMemory.ui.saveDialog.stage, state.stage);
    assert.equal(
      observation.playerMemory.ui.saveDialog.attemptStatus,
      state.attemptStatus,
    );
    assert.equal(
      observation.playerMemory.ui.saveDialog.attemptResult,
      state.attemptResult,
    );
  }
});

test('watched ferry page variables come from live special-variable RAM, not the save block',()=>{
 const session=stableSession(),runtime=fixtureRuntime();
 runtime.data.symbols.gSpecialVar_0x8005={address:0x02007800,size:2};session.memory.set(0x02007800,new Uint8Array([1,0]));
 const observer=createFireRedObserver({session,runtime,storyWatch:{variables:[0x8005,0x8006]},runId:'native-ferry-page'});
 let o=observer.capture();assert.equal(o.playerMemory.storyState.variableIds?.[0x8005],1);assert.equal(o.playerMemory.storyState.variableIds?.[0x8006],undefined);
 session.memory.get(0x02007800)[0]=0;o=observer.capture();assert.equal(o.playerMemory.storyState.variableIds?.[0x8005],0);
});

test('native save menu exposes the highlighted option without treating New Game as Continue', () => {
 const session=stableSession(),runtime=fixtureRuntime();
 runtime.data.symbols.CB2_MainMenu={address:0x08002580,size:20,region:'ROM'};
 runtime.data.symbols.Task_HandleMenuInput={address:0x08004900,size:20,region:'ROM'};
 const main=session.memory.get(0x03000100).slice();new DataView(main.buffer).setUint32(4,0x08002581,true);session.put(0x03000100,main);
 const tasks=new Uint8Array(16*40),data=new DataView(tasks.buffer);
 data.setUint32(0,0x08004901,true);tasks[4]=1;data.setInt16(8,2,true);data.setInt16(10,2,true);session.put(0x03000600,tasks);
 session.put(0x03000008,Uint8Array.from([1,0]));
 const o=createFireRedObserver({session,runtime,runId:'native-save-menu'}).capture();
 assert.deepEqual(o.playerMemory.ui.mainMenu,{stage:'choose-save',cursor:2,options:['continue','new-game','mystery-gift'],selected:'mystery-gift',continueAvailable:true,saveStatus:1});
});

test("battle observations expose each battler's committed action for the turn", () => {
  // gChosenActionByBattler: the trainer AI commits its action (0 move, 1 item)
  // before the player's action menu is answered.
  const session = stableSession(), runtime = fixtureRuntime();
  runtime.data.symbols.gChosenActionByBattler = { address: 0x0200b180, size: 4 };
  session.put(0x0200b180, new Uint8Array([0xff, 1, 0xff, 0xff]));
  const main = session.memory.get(0x03000100).slice();
  new DataView(main.buffer).setUint32(4, 0x08009201, true);
  main[0x439] = 2; // gMain.inBattle.
  session.put(0x03000100, main);
  const observation = createFireRedObserver({ session, runtime, runId: "battle-chosen-actions" }).capture();
  assert.equal(observation.emulator.mode, "battle");
  assert.deepEqual(observation.playerMemory.battle.chosenActions, [255, 1, 255, 255]);
  // A runtime without the symbol leaves the action unobserved.
  const unobserved = createFireRedObserver({ session, runtime: fixtureRuntime(), runId: "battle-no-actions" }).capture();
  assert.equal(unobserved.playerMemory.battle.chosenActions, undefined);
});
