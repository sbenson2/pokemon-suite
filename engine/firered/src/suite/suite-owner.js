// Suite owners. The owner key names a save's directory, run lock, port, status
// and RFU owner identity; the title is its cartridge. A second FireRed save is
// a declared partner owner (e.g. 'firered-partner', title 'firered'). Save
// identities keep the title, so a banked FireRed save stays compatible.
import {join} from 'node:path';

export function resolveSuiteOwner(config,owner){
 const cfg=config?.games?.[owner],title=cfg?.title??owner,partner=title==='firered'&&cfg?.role==='partner';
 if(!cfg||!/^[a-z0-9][a-z0-9-]{0,39}$/.test(owner??'')||!['firered','emerald','crystal'].includes(title)||owner!==title&&!partner||partner&&owner==='firered')throw new Error('Unknown configured Suite game.');
 const directory=join(config.directory,owner);
 return {owner,title,partner,cfg,directory,lockPath:join(directory,'owner.lock')};
}
