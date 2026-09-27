// L1.1 web "Why it stopped" card: rendering, escaping, and the one-tap fix (no browser needed).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../pokemon_suite/static/pokemon-stop-triage.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../pokemon_suite/static/index.html',import.meta.url),'utf8');
const load=()=>{const window={};runInNewContext(source,{window});return window.SuiteStopTriage;};

const safe={action:'postgame-checklist',safe:true,why:'Nothing was changed at the stopped step.',label:'Restart the postgame checklist',
  confirm:'Restarts the postgame checklist from this save.',playerTask:'postgame',token:'abc123'};
const triage=(action=safe)=>({schema:'pokemon-suite/stop-triage/v1',bucket:'known-bug-family',family:'evolution-step-source-lookup',
  title:'Held-item evolution route stopped at its first step',explanation:'An evolution route <b>stopped</b>.',
  evidence:['Stop: The source Pokémon is missing, duplicated, or evolved outside the expected step.'],suggestedAction:action});

test('the card explains the stop and escapes host text', ()=>{
  const html=load().html(triage());
  assert.match(html,/Why it stopped/);
  assert.match(html,/Held-item evolution route stopped at its first step/);
  assert.match(html,/Known bug/);
  assert.match(html,/&lt;b&gt;stopped&lt;\/b&gt;/);
  assert.doesNotMatch(html,/<b>stopped/);
  assert.match(html,/Evidence/);
});

test('a safe suggestion shows what it will do and one button', ()=>{
  const html=load().html(triage());
  assert.match(html,/Restarts the postgame checklist from this save\./);
  assert.match(html,/data-triage-action="postgame"/);
  assert.match(html,/data-triage-token="abc123"/);
  assert.equal((html.match(/<button/g)||[]).length,1);
});

test('an unsafe or missing suggestion never renders a button', ()=>{
  const cards=[{...safe,safe:false,why:'The retained checkpoint could not be read.'},{action:'none',safe:false,why:'Install engine build 108 or later.'},
    {...safe,token:''},{...safe,playerTask:null}];
  for(const action of cards){
    const html=load().html(triage(action));
    assert.doesNotMatch(html,/<button/,JSON.stringify(action));
  }
  assert.match(load().html(triage(cards[1])),/Install engine build 108 or later\./);
  assert.equal(load().html(null),'');
});

test('the page loads the card before the suite script and has its host', ()=>{
  assert.ok(index.indexOf('pokemon-stop-triage.js')>0&&index.indexOf('pokemon-stop-triage.js')<index.indexOf('pokemon-suite.js'));
  assert.match(index,/id="suite-bot-triage"[^>]*hidden/);
});
