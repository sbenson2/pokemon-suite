import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Native run October 4 (postgame-politoed-kings-rock): the spare Poliwhirl hunt
// finished with the FireRed partner advertised as ready, but the worker had
// closed its postgame client for the hunt. startPostgame created a new client,
// whose partner availability starts false, and its first decision resolved the
// National Dex without the partner: "The remaining local routes failed recently"
// deferred Politoed for an hour. The availability loop only republished on its
// next tick. A new client must receive the host's current advertisement before
// it completes the hunt, resumes or decides.
test('startPostgame publishes the partner advertisement before the first postgame command',()=>{
 const source=readFileSync(new URL('../src/suite/session-worker.js',import.meta.url),'utf8');
 const start=source.slice(source.indexOf('async function startPostgame(){'));
 const body=start.slice(0,start.indexOf('\n}\n'));
 const created=body.indexOf('createPostgameClient('),published=body.indexOf('publishPartnerAvailability();');
 assert.ok(created>=0,'startPostgame creates or reuses the client');
 assert.ok(published>created,'the advertisement is published after the client exists');
 for(const call of ['postgame.completeHunt(','beginEvolution(','postgame.resume()'])
  assert.ok(published<body.indexOf(call),`the advertisement is published before ${call}`);
 // The idle loop republishes through the same helper, so both paths read the
 // same document with the same freshness rule.
 assert.equal(source.split("join(directory,'partner-availability.json')").length-1,1,'one reader of the host advertisement');
});
