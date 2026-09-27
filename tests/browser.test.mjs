import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChromePage,CHROME} from './helpers/chrome-page.mjs';

test('standalone Suite opens its game catalog, Pokédex and theme without host scripts', {skip:!existsSync(CHROME),timeout:30000}, async()=>{
  const data=mkdtempSync(join(tmpdir(),'suite-web-'));
  const server=spawn(process.env.PYTHON||'python3',['-m','pokemon_suite','--data-dir',data,'serve','--port','0']);
  let page;
  try {
    const address=await new Promise((resolve,reject)=>{
      server.stdout.once('data',bytes=>{try{resolve(JSON.parse(String(bytes)).url);}catch(error){reject(error);}});
      server.once('error',reject);server.once('exit',code=>reject(Error('server exited '+code)));
    });
    page=await ChromePage.open();await page.command('Runtime.enable');await page.command('Page.enable');
    await page.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await page.command('Page.navigate',{url:address});
    await page.waitFor("document.querySelector('#suite-rom-list')?.children.length>10",'The standalone game catalog did not render');
    assert.equal(await page.evaluate('document.title'),'Pokémon Suite');
    const startup=await page.evaluate(`(async()=>{
      const stage=document.createElement('div');document.body.append(stage);
      const display=SuiteConsolePower.create({stage,recordings:async()=>({})});let waited=null,opened=false,finished=false;
      try{await display.boot({game:'firered',platform:'gba',start:async wait=>{waited=wait;return {sessionId:'release-test',bot:{enabled:true}}},open:async()=>{opened=true},finish:async()=>{finished=true}});
        return {waited,opened,finished,errorVisible:stage.querySelector('[data-phase=error]')!==null};
      }finally{display.dispose();stage.remove();}
    })()`);
    assert.deepEqual(startup,{waited:false,opened:true,finished:false,errorVisible:false});
    await page.evaluate("document.querySelector('[data-suite-view=pokedex]').click()");
    await page.waitFor("document.querySelector('#dex-grid').children.length>0",'The Pokédex did not render');
    assert.equal(await page.evaluate("document.querySelector('[data-suite-panel=pokedex]').hidden"),false);
    assert.equal(await page.evaluate("document.querySelector('#dex-shiny').hidden"),true);
    // Add a ROM while the application is open. It must replace placeholders on
    // the next visit without an emulator, page reload, network sprite pack or save.
    const fixture=spawnSync(process.env.PYTHON||'python3',['-c',"import runpy,sys;sys.stdout.buffer.write(runpy.run_path('tests/test_rom_art.py')['fixture_rom']())"]);
    assert.equal(fixture.status,0,String(fixture.stderr));
    const rom=join(data,'artwork-test.gba');
    writeFileSync(rom,process.env.ROM_ART_TEST_ROM?readFileSync(process.env.ROM_ART_TEST_ROM):fixture.stdout);
    const configPath=join(data,'config.json'),config=JSON.parse(readFileSync(configPath));
    config.library={firered:{source:rom,images:[{path:rom}],updates:[],dlc:[]}};
    writeFileSync(configPath,JSON.stringify(config));
    await page.evaluate("document.querySelector('[data-suite-view=roms]').click();document.querySelector('[data-suite-view=pokedex]').click()");
    await page.waitFor("document.querySelector('#dex-shiny')?.hidden===false",'The Pokédex did not discover the local ROM');
    try{await page.waitFor("document.querySelector('#dex-detail img')?.naturalWidth===64",'The ROM sprite did not decode in the browser');}
    catch(error){error.message+=' '+JSON.stringify(await page.evaluate(`(async()=>{const image=document.querySelector('#dex-detail img');const response=await fetch(image.src);return {src:image.src,width:image.naturalWidth,status:response.status,type:response.headers.get('Content-Type'),game:document.querySelector('#dex-game').value,detail:document.querySelector('#dex-detail').textContent.slice(0,100)}})()`));throw error;}
    await page.evaluate("document.querySelector('#dex-shiny').click()");
    const shinyUrl=new URL(await page.evaluate("document.querySelector('#dex-detail img').src"));
    assert.equal(shinyUrl.pathname,'/api/rom-art/firered/pokemon/1.png');assert.equal(shinyUrl.searchParams.get('shiny'),'1');
    assert.match(shinyUrl.searchParams.get('rom'),/^[a-f0-9]{64}$/);
    await page.waitFor("document.querySelector('#dex-detail img').complete && document.querySelector('#dex-detail img').naturalWidth===64",'The shiny ROM palette did not render');
    await page.evaluate("document.querySelector('#dex-search').value='umbreon';document.querySelector('#dex-search').dispatchEvent(new Event('input'))");
    await page.waitFor("document.querySelector('#dex-grid').textContent.toLowerCase().includes('umbreon')",'Pokédex search lost Umbreon');
    await page.waitFor("[...document.querySelectorAll('#dex-grid img')].every(img=>img.complete&&img.naturalWidth>0)",'The search result image did not load');
    if(process.env.ROM_ART_TEST_ROM)assert.equal(await page.evaluate("document.querySelector('#dex-grid img').naturalWidth"),64);
    const before=await page.evaluate('document.documentElement.dataset.pokemonTheme');
    await page.evaluate("document.querySelector('#suite-theme-toggle').click()");
    assert.notEqual(await page.evaluate('document.documentElement.dataset.pokemonTheme'),before);
    for(const [width,height,mobile] of [[1440,1000,false],[390,844,true]]){
      await page.command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
      assert.equal(await page.evaluate('document.documentElement.scrollHeight <= innerHeight+2 && document.documentElement.scrollWidth <= innerWidth+2'),true);
      mkdirSync('.local/verification',{recursive:true});
      const shot=await page.command('Page.captureScreenshot',{format:'png'});
      writeFileSync(`.local/verification/pokedex-${width}.png`,Buffer.from(shot.data,'base64'));
    }
  } finally {
    await page?.close();server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));rmSync(data,{recursive:true,force:true});
  }
});
