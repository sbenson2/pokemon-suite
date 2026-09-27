// FireRed's foreign-OT obedience gates (pret/pokefirered, IsMonDisobedient).
// This changes controller choices only; it never caps or edits a Pokemon.
export function obedienceRisk(member, observation) {
  const trainer=observation?.playerMemory?.trainer;
  if (!Number.isSafeInteger(member?.otId)||!Number.isSafeInteger(trainer?.otId)) return false;
  const differentName=typeof member.otName==='string'&&typeof trainer.playerName==='string'&&member.otName!==trainer.playerName;
  if(member.otId===trainer.otId&&!differentName)return false;
  const flags=observation?.playerMemory?.storyState?.flagIds??{};
  if(flags[2087]===true)return false;
  const limit=flags[2085]===true?70:flags[2083]===true?50:flags[2081]===true?30:10;
  return Number(member.level)>limit;
}

export function permanentTrainingParty(party,teamPlan) {
  const families=teamPlan?.permanentFamilies??(teamPlan?.starterFamily
    ? [teamPlan.starterFamily,...(teamPlan.acquisitions??[]).map(a=>a.family)] : null);
  return families?.length?party.filter(p=>families.some(f=>f?.includes(Number(p.species)))):party;
}

// A passive Exp. Share trainee rides along in a major-battle round without
// fighting; its objective names it by native identity (PID and OT ID), so a
// party reorder or menu order cannot confuse it with another member.
export function passiveTraineeIdentity(objective) {
  const trainee = objective?.expShareTrainee;
  return trainee && Number.isSafeInteger(Number(trainee.personality)) && Number.isSafeInteger(Number(trainee.otId))
    ? trainee : null;
}

export function isPassiveTrainee(member, trainee) {
  return Boolean(trainee && member && Number(member.personality) === Number(trainee.personality) &&
    Number(member.otId) === Number(trainee.otId));
}
