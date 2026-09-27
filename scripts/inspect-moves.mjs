// Offline lookup of the same Gen III facts and rules used by battle policy.
import {readFileSync} from 'node:fs';
import {moveCatalog,describeMove} from '../engine/firered/src/player/move-knowledge.js';
const query=process.argv[2]??'--coverage';
if(query==='--coverage'){
  const rules=moveCatalog.moves.map(describeMove),reference=JSON.parse(readFileSync(new URL('../engine/firered/src/data/pokeapi-move-reference.json',import.meta.url)));
  const counts=Object.fromEntries(['damage','support','requires-plan'].map(k=>[k,rules.filter(m=>m.planning===k).length]));
  console.log(JSON.stringify({game:'firered',generation:3,moves:rules.length,effects:new Set(rules.map(m=>m.effect)).size,unclassified:rules.filter(m=>!m.known).map(m=>m.id),planning:counts,referenceMoves:reference.tables.moves.length,versionChanges:reference.tables.move_changelog.length,source:moveCatalog.source},null,2));
}else{
  const normalized=query.toUpperCase().replaceAll(/[^A-Z0-9]+/g,'_').replace(/^MOVE_/,'');
  const move=moveCatalog.moves.find(m=>String(m.id)===query||m.name==='MOVE_'+normalized);
  if(!move){console.error('Move unavailable in FireRed. Use --coverage to inspect the local catalog.');process.exitCode=2;}
  else console.log(JSON.stringify(describeMove(move),null,2));
}
