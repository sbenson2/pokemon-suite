// FireRed's ChoosePartyMon special opens CHOOSE_SINGLE_MON (3) with
// CHOOSE_AND_CLOSE (11). Medicine, switching, and held-item pickers share the
// screen and input task, but not these identifiers. The objective's NPC map is
// also required: another script may use the same generic selection special.
export function isInGameTradePartyMenu(observation, targetMap) {
  const memory = observation?.playerMemory;
  const party = memory?.ui?.party;
  return observation?.emulator?.mode === "party" &&
    typeof targetMap === "string" && memory?.map?.id === targetMap &&
    party?.menuType === 3 && party.actionId === 11 &&
    ["choose-pokemon", "message"].includes(party.stage);
}
