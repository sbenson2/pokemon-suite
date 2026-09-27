/* Shared update controls. Paths refer to the computer running the local service. */
(() => {
 const root=document.querySelector('#suite-software-updates');if(!root)return;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 let game='firered',last='',busy=false;
 const status=el('p');status.setAttribute('role','status');
 async function send(action,fields={}){busy=true;status.textContent='Checking software update…';try{const response=await fetch('/api/pokemon-suite/updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...fields})});const data=await response.json();if(!response.ok)throw Error(data.error);status.textContent='Update request recorded.';return data.result;}catch(error){status.textContent=error.message;}finally{busy=false;}}
 const title=el('h2','Software updates');root.append(title,el('p','Data updates apply to new plans. Current hunts keep their data. Engine changes wait for a stable field and completed trades.'));
 function field(label,type='text'){const wrapper=el('label',label),input=el('input');input.type=type;wrapper.append(input);root.append(wrapper);return input;}
 const path=field('Signed package path on this computer');
 const importButton=el('button','Import Signed Package');importButton.type='button';importButton.onclick=()=>send('import',{path:path.value});root.append(importButton);
 const intervention=field('Allow a recorded campaign intervention','checkbox');
 root.append(el('p','A changed run cannot count as an uninterrupted qualification pass.'));
 const packages=el('div'),activity=el('div');root.append(packages,activity);
 const trust=el('details');trust.append(el('summary','Release source and trust'));
 const label=el('label','Public Ed25519 signing key'),key=el('input');label.append(key);trust.append(label);
 const trustButton=el('button','Trust Public Key');trustButton.type='button';trustButton.onclick=()=>send('trust-key',{publicKey:key.value.trim(),label:'Imported release key'});trust.append(trustButton);
 const feedLabel=el('label','HTTPS release feed'),feed=el('input');feed.type='url';feedLabel.append(feed);
 const rootLabel=el('label','Trusted TUF root file path'),rootPath=el('input');rootLabel.append(rootPath);trust.append(feedLabel,rootLabel);
 const configure=el('button','Configure Release Feed');configure.type='button';configure.onclick=()=>send('configure-feed',{url:feed.value,rootPath:rootPath.value});trust.append(configure);
 const check=el('button','Check for Packages');check.type='button';const available=el('div');check.onclick=async()=>{const result=await send('check');if(!result)return;available.replaceChildren();for(const p of result.packages){const b=el('button',`Download ${p.id} ${p.version}`);b.type='button';b.onclick=()=>send('download',{target:p.target});available.append(b);}};trust.append(check,available);root.append(trust,status);
 window.SuiteUpdates={update(state,selected){game=selected||'firered';const software=state.software||{};check.disabled=!software.feed?.configured||busy;const signature=JSON.stringify([software.installed,software.updates,game]);if(signature===last)return;last=signature;packages.replaceChildren();activity.replaceChildren();
  for(const p of software.installed||[]){if(!p.games.includes(game))continue;const row=el('section');row.append(el('h3',`${p.id} ${p.version}`));const activate=el('button',p.kind==='data'?'Use for New Plans':'Set Default');activate.type='button';activate.onclick=()=>send('activate',{game,digest:p.digest});row.append(activate);if(['engine','planner','game','emulator'].includes(p.kind)){const apply=el('button','Apply to Current Game');apply.type='button';apply.onclick=()=>send('apply',{game,digest:p.digest,requestId:crypto.randomUUID(),allowIntervention:intervention.checked});row.append(apply);}packages.append(row);}
  for(const u of (software.updates||[]).slice(0,8)){activity.append(el('p',`${u.game}: ${u.state}. ${u.detail.reason||''}`));if(u.state==='failed'){const recover=el('button','Resume Held Game');recover.type='button';recover.onclick=()=>send('recover',{id:u.id});activity.append(recover);}}
  if(!(software.installed||[]).length)packages.append(el('p','Using the engine and data included with this app.'));
 }};
})();
