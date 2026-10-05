// Suite owners. The owner key names a save's directory, run lock, port, status
// and RFU owner identity; the title is its cartridge. A second FireRed save is
// a declared partner owner (e.g. 'firered-partner', title 'firered'). Save
// identities keep the title, so a banked FireRed save stays compatible.
import {join} from 'node:path';

export function resolveSuiteOwner(config,owner){
 const cfg=config?.games?.[owner],title=cfg?.title??owner,partner=title==='firered'&&cfg?.role==='partner';
 // extra-saves: a helper FireRed save plays only its goal-driven story campaign.
 const helper=title==='firered'&&cfg?.role==='helper';
 if(!cfg||!/^[a-z0-9][a-z0-9-]{0,39}$/.test(owner??'')||!['firered','leafgreen','emerald','crystal'].includes(title)||owner!==title&&!partner&&!helper||(partner||helper)&&owner==='firered')throw new Error('Unknown configured Suite game.');
 const directory=join(config.directory,owner);
 return {owner,title,partner,helper,cfg,directory,lockPath:join(directory,'owner.lock')};
}
// A FireRed partner, and a helper save (build 126), always runs its configured
// native link pair: the reviewed peer-trade cartridge and native RFU core. A
// helper's saves become a partner's seed and trade with the main save over that
// link, so the whole lineage keeps one cartridge and core identity.
export function ownerNativePair(cfg,{partner=false,helper=false}={}){
 return (partner||helper)&&cfg?.nativeRadio?.cartridge&&cfg?.nativeRadio?.core?cfg.nativeRadio:null;
}
