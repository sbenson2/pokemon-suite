#!/usr/bin/env node
import {readInventorySnapshot} from './inventory-snapshot.js';
try{
 let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>1024*1024)throw Error('Inventory configuration is too large.');}
 process.stdout.write(JSON.stringify(await readInventorySnapshot(JSON.parse(text)))+'\n');
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
