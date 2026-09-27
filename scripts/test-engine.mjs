import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../engine/firered/',import.meta.url));
const files=readdirSync(new URL('../engine/firered/test/',import.meta.url)).filter(name=>name.endsWith('.test.js')).map(name=>'test/'+name);
const result=spawnSync(process.execPath,['--test',...files],{cwd,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
