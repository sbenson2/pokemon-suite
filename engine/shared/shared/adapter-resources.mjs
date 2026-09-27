// Optional cartridge-derived adapter inputs belong to the user's installation.
import {readFile} from 'node:fs/promises';
import {isAbsolute,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(process.env.POKEMON_SUITE_ADAPTER_DATA||fileURLToPath(new URL('../vendor/',import.meta.url)));
export function adapterPath(relative){
  const target=resolve(root,relative);
  if(isAbsolute(relative)||!(target===root||target.startsWith(root+sep)))throw new Error('Invalid adapter resource path.');
  return target;
}
export async function readAdapterFile(relative,encoding='utf8'){
  try{return await readFile(adapterPath(relative),encoding);}
  catch(error){
    if(error.code==='ENOENT')throw new Error(`Missing private adapter data: ${relative}. Set POKEMON_SUITE_ADAPTER_DATA to your verified adapter-data directory.`,{cause:error});
    throw error;
  }
}
