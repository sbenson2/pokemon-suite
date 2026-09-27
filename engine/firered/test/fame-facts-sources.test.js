import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Every Fame Checker source the postgame visits must award the facts it is
// listed for. The fixture is extracted from the pinned pokefirered scripts by
// scripts/extract-fame-script-awards.py. Live Sept 25: the table listed the
// Pewter City Museum Guide (object 1) for Brock fact 2, a script with no
// famechecker call, and the owner looped on it (approach, dialog, led away).
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const table=read('../src/suite/postgame-fame-facts.json');
const awards=read('../test-support/fame-script-awards.json');

test('the Fame awards fixture comes from the pinned pokefirered source and covers every listed script', ()=>{
 assert.equal(awards.source.project,'pokefirered');
 assert.equal(awards.source.commit,'c75f352304d529f6ba92d4f74b9cf8b5c3810788');
 assert.deepEqual(awards.people,table.people);
 assert.deepEqual(awards.missingLabels,[]);
 for(const target of table.targets)assert.ok(Array.isArray(awards.scripts[target.script]),`no extracted awards for ${target.script}`);
});

test('every visited Fame source awards each fact it is listed for', ()=>{
 const bogus=[];
 for(const target of table.targets){
  // Map-arrival labels are empty native MapScripts; the postgame never visits
  // them (postgame-collection-extras.js) and their facts come from objects.
  if(target.kind==='map-arrival')continue;
  const given=new Set(awards.scripts[target.script].map(([person,index])=>`${person}:${index}`));
  for(const [person,index] of target.entries)
   if(!given.has(`${person}:${index}`))bogus.push(`${target.map}:${target.kind}:${target.index} ${target.script} ${table.people[person]}:${index}`);
 }
 assert.deepEqual(bogus,[],'Fame sources that never award their listed facts');
});

test('Brock fact 2 in Pewter City comes from the Fat Man, not the Museum Guide', ()=>{
 const pewter=table.targets.filter(t=>t.map==='MAP_PEWTER_CITY'&&t.kind==='object');
 assert.equal(pewter.some(t=>t.script==='PewterCity_EventScript_MuseumGuide'),false);
 assert.ok(pewter.some(t=>t.script==='PewterCity_EventScript_FatMan'&&t.entries.some(([p,i])=>p===2&&i===2)));
});
