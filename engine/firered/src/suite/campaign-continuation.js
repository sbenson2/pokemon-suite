// A campaign benchmark ends at its verified Hall of Fame. The adventure may
// continue, but never rewrites the run commitment or its completion receipt.
export function campaignPostgameHandoff({record,state,policy}) {
 if(!policy?.enabled||policy.awaitingCommand||record?.settings?.afterCampaign==='wait'||
    state?.status!=='complete'||state.completion?.playablePostgame!==true||
    state.completion.nativeHallOfFame?.nativeSaveVerified!==true||
    !/^[a-f0-9]{64}$/.test(state.completion.sramSha256??''))return null;
 return {schema:'pokemon-suite/campaign-continuation/v1',goal:'complete-firered',campaignId:record.id,
  campaignCommitment:record.commitment,leagueSaveSha256:state.completion.sramSha256,
  leagueFrame:state.completion.frame??null,teamPlan:structuredClone(record.teamPlan??null)};
}

// At the verified Hall of Fame the owner either continues into the postgame
// (afterCampaign 'postgame') or waits for commands (afterCampaign 'wait', a
// stopped or waiting policy, an unverified completion). The handoff is async:
// its result is awaited (a pending promise is always truthy). A failed handoff
// is not a request to wait: it is reported, and the owner's idle handoff
// retries it with the completed campaign intact, as after a restart.
export async function settleCompletedCampaign({handoff,awaitCommands,report=()=>{}}){
 let continued;
 try{continued=await handoff();}catch(error){report(error);return 'retry';}
 if(continued)return 'postgame';
 awaitCommands();return 'await-command';
}
