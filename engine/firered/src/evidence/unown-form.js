// GET_UNOWN_LETTER in the unmodified Generation III cartridge.
export function unownForm(p){
 if(p?.validity!=='valid'||p.species!==201||!Number.isInteger(p.personality))return null;
 const n=p.personality;
 return (((n&0x3000000)>>>18)|((n&0x30000)>>>12)|((n&0x300)>>>6)|(n&3))%28;
}
