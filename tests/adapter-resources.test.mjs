import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));

test('Emerald reads its character map and constants root from private adapter data',()=>{
  const root=mkdtempSync(join(tmpdir(),'suite-adapter-'));
  try{
    mkdirSync(join(root,'pokeemerald'));writeFileSync(join(root,'pokeemerald/charmap.txt'),"'Z' = BB\n");
    const result=spawnSync(process.execPath,['--input-type=module','-e',`import {POKEEMERALD_ROOT} from './engine/shared/games/emerald/constants.mjs';import {loadCharmap} from './engine/shared/games/emerald/text.mjs'; console.log(JSON.stringify({root:POKEEMERALD_ROOT,glyph:(await loadCharmap()).get(187)}));`],{cwd:ROOT,env:{...process.env,POKEMON_SUITE_ADAPTER_DATA:root},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);
    assert.equal(resolve(data.root),join(root,'pokeemerald'));assert.equal(data.glyph,'Z');
  }finally{rmSync(root,{recursive:true,force:true});}
});
