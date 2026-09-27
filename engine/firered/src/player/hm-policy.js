export const HM_MOVE_IDS = new Set([15, 19, 57, 70, 127, 148, 249, 291]);
const COMBAT_HMS = new Set([19, 57, 70]);

export function isHmUtilityCarrier(pokemon, teamPlan) {
  const species = Number(pokemon?.species);
  const includes = family => (family ?? []).some(id => Number(id) === species);
  // A combat role takes precedence even in a legacy plan with overlapping
  // assignments. Knowing an HM never changes the role of a team member.
  if (includes(teamPlan?.starterFamily) ||
      (teamPlan?.permanentFamilies ?? []).some(includes) ||
      (teamPlan?.acquisitions ?? []).some(a => a.permanentRoster !== false && includes(a.family)) ||
      (teamPlan?.temporaryAcquisitions ?? []).some(a => a.helperRole !== 'field' && includes(a.family))) return false;
  return [...(teamPlan?.utilityAcquisitions ?? []), ...(teamPlan?.fieldUtilityAlternatives ?? [])].some(a => includes(a.family));
}

export function fieldCarrierSpecies(teamPlan, move) {
  if (!['cut','flash','rockSmash'].includes(move)) return [...(teamPlan?.fieldMoves?.[move] ?? [])];
  return [...new Set([...(teamPlan?.fieldMoves?.[move] ?? []),
    ...(teamPlan?.fieldUtilityAlternatives ?? []).filter(a=>a.fieldCapabilities.includes(move)).flatMap(a=>a.family)])];
}

export function mayLearnMove(pokemon, moveId, teamPlan) {
  const id = Number(moveId);
  return !HM_MOVE_IDS.has(id) || COMBAT_HMS.has(id) || isHmUtilityCarrier(pokemon, teamPlan);
}
