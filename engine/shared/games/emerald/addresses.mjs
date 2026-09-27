/**
 * Runtime symbols for Pokemon Emerald (U), validated against the pinned
 * pokeemerald-symbols revision. These are RAM addresses, never ROM offsets.
 */
export const SYMBOL_SOURCE = Object.freeze({
  path: 'vendor/pokeemerald-symbols/pokeemerald.sym',
  commit: 'dba968c67d85caf9595abe12a51ff739d4dc5937',
});

export const REQUIRED_SYMBOLS = Object.freeze([
  'gBattleTypeFlags', 'gBattleOutcome', 'gPlayerPartyCount', 'gPlayerParty',
  'gTrainerBattleOpponent_A', 'gMain', 'gSaveBlock1Ptr', 'gSaveBlock2Ptr', 'gTasks',
  'CB2_MainMenu', 'CB2_NewGame', 'CB2_NamingScreen', 'CB2_ChooseStarter',
  'Task_TitleScreenPhase3', 'Task_HandleMainMenuInput',
  'Task_NewGameBirchSpeech_ChooseGender',
  'Task_NewGameBirchSpeech_WaitPressBeforeNameChoice',
  'Task_NewGameBirchSpeech_ProcessNameYesNoMenu',
  'Task_HandleStarterChooseInput', 'Task_HandleConfirmStarterInput',
]);

// Parsed from SYMBOL_SOURCE at the pinned revision; tests re-derive this map.
export const EMERALD_ADDRESS_MANIFEST = Object.freeze({
  gBattleTypeFlags: 0x02022fec,
  gBattleOutcome: 0x0202433a,
  gPlayerPartyCount: 0x020244e9,
  gPlayerParty: 0x020244ec,
  gTrainerBattleOpponent_A: 0x02038bca,
  gMain: 0x030022c0,
  gSaveBlock1Ptr: 0x03005d8c,
  gSaveBlock2Ptr: 0x03005d90,
  gTasks: 0x03005e00,
  CB2_MainMenu: 0x0802f6b0,
  CB2_NewGame: 0x08085ef8,
  CB2_NamingScreen: 0x080e4f58,
  CB2_ChooseStarter: 0x08133f0c,
  Task_TitleScreenPhase3: 0x080aad64,
  Task_HandleMainMenuInput: 0x0803024c,
  Task_NewGameBirchSpeech_ChooseGender: 0x08030e38,
  Task_NewGameBirchSpeech_WaitPressBeforeNameChoice: 0x08031040,
  Task_NewGameBirchSpeech_ProcessNameYesNoMenu: 0x08031188,
  Task_HandleStarterChooseInput: 0x0813425c,
  Task_HandleConfirmStarterInput: 0x08134400,
});

export function parseSymbolMap(symbolText) {
  if (typeof symbolText !== 'string') throw new TypeError('symbolText must be a string');
  const symbols = new Map();
  for (const line of symbolText.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{8})\s+\S+\s+[0-9a-fA-F]+\s+(\S+)\s*$/);
    if (match) symbols.set(match[2], Number.parseInt(match[1], 16));
  }
  return symbols;
}

export function createAddressManifest(symbols) {
  if (!(symbols instanceof Map)) throw new TypeError('symbols must be a Map returned by parseSymbolMap');
  const missing = REQUIRED_SYMBOLS.filter(symbol => !symbols.has(symbol));
  if (missing.length) throw new Error(`Missing required Emerald symbols: ${missing.join(', ')}`);
  return Object.freeze(Object.fromEntries(REQUIRED_SYMBOLS.map(symbol => [symbol, symbols.get(symbol)])));
}
