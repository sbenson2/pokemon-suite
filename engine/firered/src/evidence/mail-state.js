// Read-only decoders for FireRed's Mail storage, Easy Chat screen and the
// party-menu Mail prompts (pret/pokefirered c75f352). Pure functions over
// captured bytes so the observer and tests share one definition.

export const MAIL_BYTES = 0x24;         // struct Mail
export const MAIL_COUNT = 16;           // 6 party slots + 10 PC mailbox slots
export const PARTY_MAIL_SLOTS = 6;      // GiveMailToMon searches only these
export const PARTY_MAIL_ID_OFFSET = 0x55; // struct Pokemon.mail
export const MAIL_NONE = 0xff;
export const FIRST_MAIL_ITEM = 121;     // ITEM_ORANGE_MAIL
export const LAST_MAIL_ITEM = 132;      // ITEM_RETRO_MAIL
// gPokemonStorage: u8 currentBox (+3 padding), then boxes[14][30] of 80 bytes.
export const BOX3_SLOT1_OFFSET = 4 + 2 * 30 * 80;
export const itemIsMail = id => Number.isInteger(id) && id >= FIRST_MAIL_ITEM && id <= LAST_MAIL_ITEM;

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// mail[] slots, each party member's MON_DATA_MAIL link, and the allocated
// party slots nothing references (the "orphans" the QMM glitch relies on).
export function decodeMailState({save1, mailOffset, partyBytes, party = [], storageBytes = null}) {
  if (!save1 || !Number.isSafeInteger(mailOffset) || mailOffset < 0 || mailOffset + MAIL_BYTES * MAIL_COUNT > save1.length) return null;
  const slots = Array.from({length: MAIL_COUNT}, (_, slot) => {
    const o = mailOffset + slot * MAIL_BYTES;
    return {slot, itemId: u16(save1, o + 0x20), species: u16(save1, o + 0x1e),
      words: Array.from({length: 9}, (_, i) => u16(save1, o + i * 2))};
  });
  const members = party.map(p => {
    const mailId = partyBytes && partyBytes.length >= (p.slot + 1) * 100 ? partyBytes[p.slot * 100 + PARTY_MAIL_ID_OFFSET] : null;
    const holdsMail = itemIsMail(p.heldItem);
    return {slot: p.slot, heldItem: p.heldItem ?? 0, mailId,
      // MonHasMail: a Mail item and a mail link; the link names a live record.
      hasMail: holdsMail && mailId !== null && mailId !== MAIL_NONE,
      linked: holdsMail && mailId !== null && mailId < PARTY_MAIL_SLOTS && slots[mailId]?.itemId === p.heldItem};
  });
  const referenced = new Set(members.filter(m => m.hasMail).map(m => m.mailId));
  const allocated = slots.slice(0, PARTY_MAIL_SLOTS).filter(s => s.itemId !== 0);
  let box3Slot1 = null;
  if (storageBytes && storageBytes.length >= BOX3_SLOT1_OFFSET + 80) {
    const record = storageBytes.subarray(BOX3_SLOT1_OFFSET, BOX3_SLOT1_OFFSET + 80);
    box3Slot1 = {empty: record.every(v => v === 0), head: Array.from(record.subarray(0, 18))};
  }
  return {
    slots: slots.map(({slot, itemId, species}) => ({slot, itemId, species})),
    party: members,
    allocatedPartySlots: allocated.length,
    orphanSlots: allocated.filter(s => !referenced.has(s.slot)).map(s => s.slot),
    partyHoldsMail: members.some(m => itemIsMail(m.heldItem)),
    box3Slot1,
  };
}

// struct EasyChatScreen (src/easy_chat_2.c): state at +4, cursor at +5/+6,
// words pointer at +0x14, edit buffer at +0x18. Input is accepted only in
// Task_RunEasyChat state 1 without a palette fade.
const EASY_CHAT_STAGES = ['field', 'footer', 'group', 'word', 'confirm-quit', 'confirm-delete-all', 'confirm-message'];
export function decodeEasyChatState({screen, menuCursor = null, taskState = null, fading = false, saveBlock1Pointer = null, mailOffset = null, storagePointer = null, words = null}) {
  if (!screen || screen.length < 0x2a) return null;
  const state = screen[4], wordsAddress = u32(screen, 0x14);
  const buffer = Array.from({length: 9}, (_, i) => u16(screen, 0x18 + i * 2));
  const mailBase = Number.isSafeInteger(saveBlock1Pointer) && Number.isSafeInteger(mailOffset) ? saveBlock1Pointer + mailOffset : null;
  const offset = mailBase === null ? null : wordsAddress - mailBase;
  const mailIndex = offset !== null && offset >= 0 && offset % MAIL_BYTES === 0 ? offset / MAIL_BYTES : null;
  const box3Slot1Address = Number.isSafeInteger(storagePointer) ? storagePointer + BOX3_SLOT1_OFFSET : null;
  const original = Array.isArray(words) ? words : null;
  return {
    stage: EASY_CHAT_STAGES[state] ?? `state-${state}`,
    type: screen[0], numWords: screen[7],
    cursor: {column: (screen[5] << 24) >> 24, row: (screen[6] << 24) >> 24},
    inputReady: taskState === 1 && !fading,
    menuCursor: [4, 5, 6].includes(state) ? menuCursor : null,
    wordsAddress, mailIndex,
    // mail[0xFF] aliases Box 3 slot 1 (SB1+0x2CD0+255*0x24 = storage+0x12C4).
    aliasesBox3Slot1: box3Slot1Address !== null && wordsAddress === box3Slot1Address,
    edited: original ? buffer.some((w, i) => i < screen[7] && w !== original[i]) : null,
    buffer,
  };
}

// Party-menu Yes/No prompts that the generic stage decoder did not own.
export const PARTY_PROMPT_TASKS = Object.freeze({
  Task_HandleSwitchItemsYesNoInput: 'confirm-switch-item',
  Task_HandleSwitchItemsFromBagYesNoInput: 'confirm-switch-item',
  Task_HandleSendMailToPCYesNoInput: 'confirm-send-mail-to-pc',
  Task_HandleLoseMailMessageYesNoInput: 'confirm-lose-mail',
});
export const PARTY_PROMPT_TEXT_TASKS = Object.freeze(new Set([
  'Task_SwitchItemsYesNo', 'Task_SwitchItemsFromBagYesNo', 'Task_SendMailToPCYesNo', 'Task_LoseMailMessageYesNo',
]));
export function partyPromptStage(taskNames) {
  for (const name of taskNames) if (PARTY_PROMPT_TASKS[name]) return PARTY_PROMPT_TASKS[name];
  return null;
}

// gBattleStruct->usedHeldItems (+0xB8) and gWishFutureKnock.knockedOffMons (+41).
export function decodeBattleItemState(battleStruct, wishFutureKnock) {
  return {
    usedHeldItems: battleStruct && battleStruct.length >= 0xc0 ? Array.from({length: 4}, (_, i) => u16(battleStruct, 0xb8 + i * 2)) : null,
    knockedOffMons: wishFutureKnock && wishFutureKnock.length >= 43 ? [wishFutureKnock[41], wishFutureKnock[42]] : null,
  };
}
