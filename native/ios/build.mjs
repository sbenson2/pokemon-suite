import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
if(!args['--config']||!args['--output'])throw Error('Pass --config=<local Suite profile config> and --output=<private build directory>.');
const output=resolve(args['--output']),assets=join(output,'RuntimeAssets');
const cfg=JSON.parse(await readFile(args['--config'],'utf8')).games.firered;
await mkdir(assets,{recursive:true});
const manifest=JSON.parse(await readFile(join(cfg.core,'build-manifest.json'),'utf8'));
for(const [name,key] of [['mgba.js','mgba_js_sha256'],['mgba.wasm','mgba_wasm_sha256']]){
 const value=await readFile(join(cfg.core,name));
 if(createHash('sha256').update(value).digest('hex')!==manifest[key])throw Error('Local core fingerprint mismatch: '+name);
 await writeFile(join(assets,name),value);
}
await writeFile(join(assets,'build-manifest.json'),JSON.stringify(manifest));
for(const key of ['runtime','world','story','battle'])await writeFile(join(assets,key+'.json'),JSON.stringify(JSON.parse(await readFile(cfg.inputs[key],'utf8'))));
const notices=['noble-hashes-MIT.txt','buffer-MIT.txt','base64-js-MIT.txt','ieee754-BSD-3-Clause.txt','esbuild-MIT.txt'];
await mkdir(join(assets,'Licenses'),{recursive:true});
for(const name of notices)await copyFile(join(root,'licenses/mobile-runtime',name),join(assets,'Licenses',name));
await copyFile(join(here,'Runtime/index.html'),join(assets,'index.html'));
await build({entryPoints:[join(here,'Runtime/entry.js')],outfile:join(assets,'runtime.js'),bundle:true,format:'iife',platform:'browser',target:'safari17',
 alias:{'node:crypto':join(here,'Runtime/crypto.js'),'node:util':join(here,'Runtime/util.js')},inject:[join(here,'Runtime/globals.js')],minify:true,legalComments:'eof'});
const bundle=args['--bundle-id']??'org.pokemonsuite.mobile';
const spec={name:'PokemonSuiteMobile',options:{bundleIdPrefix:'org.pokemonsuite',deploymentTarget:{iOS:'17.0'}},
 settings:{base:{SWIFT_VERSION:'5.0',DEVELOPMENT_TEAM:args['--team']??'',TARGETED_DEVICE_FAMILY:'1,2',GENERATE_INFOPLIST_FILE:'YES',
  INFOPLIST_KEY_CFBundleDisplayName:'Pokémon Suite',INFOPLIST_KEY_UIApplicationSceneManifest_Generation:'YES',INFOPLIST_KEY_UILaunchScreen_Generation:'YES',
  INFOPLIST_KEY_UIFileSharingEnabled:'YES',INFOPLIST_KEY_LSSupportsOpeningDocumentsInPlace:'YES',INFOPLIST_KEY_UISupportedInterfaceOrientations:'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight',
  MARKETING_VERSION:'0.1.0',CURRENT_PROJECT_VERSION:'1',CODE_SIGN_STYLE:'Automatic'}},
 targets:{PokemonSuiteMobile:{type:'application',platform:'iOS',sources:[{path:join(here,'App')},{path:join(here,'Core')},{path:assets,type:'folder',buildPhase:'resources'}],
  settings:{base:{PRODUCT_BUNDLE_IDENTIFIER:bundle}},
  dependencies:[{sdk:'WebKit.framework'},{sdk:'AVFoundation.framework'},{sdk:'CryptoKit.framework'}]},
 SuiteMobileUITests:{type:'bundle.ui-testing',platform:'iOS',sources:[{path:join(here,'UITests')}],dependencies:[{target:'PokemonSuiteMobile'}],
  settings:{base:{PRODUCT_BUNDLE_IDENTIFIER:bundle+'.uitests',TEST_TARGET_NAME:'PokemonSuiteMobile'}}}},
 schemes:{PokemonSuiteMobile:{build:{targets:{PokemonSuiteMobile:'all'}},test:{targets:['SuiteMobileUITests']}}}};
await writeFile(join(output,'project.json'),JSON.stringify(spec,null,2));
console.log(JSON.stringify({project:join(output,'project.json'),assets,romIncluded:false,sourceConfig:'local verified FireRed resources',bundle}));
