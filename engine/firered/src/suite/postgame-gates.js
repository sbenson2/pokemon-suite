// Story gates the postgame agenda applies before automating an objective. The
// agenda, static availability and the host's goal planning share these facts.
export const GAME_CLEAR_FLAG=2092,NATIONAL_DEX_FLAG=2112,LINK_FLAG=2116;
// These Kanto sources can satisfy the National Dex prerequisite itself.
// Island quests and Mewtwo still require Celio's completed link quest.
export const BEFORE_LINK=new Set(['lapras','dojo-gift','old-amber','fossils','eevee','snorlax','game-corner','articuno','zapdos','moltres']);
// `label` matches the postgame checklist entry; `need` names the missing
// prerequisite in a request limitation ("Mewtwo needs: Hall of Fame").
export const POSTGAME_GATES=Object.freeze({
 leagueComplete:Object.freeze({key:'leagueComplete',flag:GAME_CLEAR_FLAG,label:'Enter the Hall of Fame',need:'Hall of Fame'}),
 nationalDex:Object.freeze({key:'nationalDex',flag:NATIONAL_DEX_FLAG,label:'Unlock the National Pokédex',need:'National Pokédex'}),
 canLinkNationally:Object.freeze({key:'canLinkNationally',flag:LINK_FLAG,label:'Complete Celio’s Ruby and Sapphire quest',need:'Celio’s link (Ruby and Sapphire quest)'}),
});
// Every agenda selection needs the game-clear flag; an entry outside
// BEFORE_LINK also needs Celio's link, which follows the National Dex upgrade.
export const postgameEntryGates=id=>[POSTGAME_GATES.leagueComplete,...(BEFORE_LINK.has(id)?[]:[POSTGAME_GATES.nationalDex,POSTGAME_GATES.canLinkNationally])];
