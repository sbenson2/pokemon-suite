(() => {
  'use strict';
  function create({root,openGame}) {
    const list=root.querySelector('#suite-shiny-list'),message=root.querySelector('#suite-shiny-message');
    let active=false,owner=false,busy=false,loading=false,records=[],signature='';
    const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!=null)node.textContent=text;return node;};
    async function api(path,body){
      const response=await fetch('./api/pokemon-suite/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
      const result=await response.json();if(!response.ok||result.ok===false)throw new Error(result.error||'Could not read the game’s saved captures.');return result;
    }
    async function command(path,body){
      if(busy||!owner)return;busy=true;render();
      message.textContent=path==='trade-shiny'?'Sending the selected Pokémon to its game’s trade routine…':'Stopping the trade routine…';
      try{await api(path,body);message.textContent=path==='trade-shiny'?'Trade routine started. The bot will retrieve this Pokémon, heal and save, then open a Leader lobby.':'Trade routine stopped with its current progress preserved.';await refresh();}
      catch(error){message.textContent=error.message;}
      finally{busy=false;render();}
    }
    function render(){
      const key=JSON.stringify([records,owner,busy]);if(signature===key)return;signature=key;list.replaceChildren();
      if(!owner){list.append(el('p','suite-empty','Sign in as the host owner to view caught shinies and manage trades.'));return;}
      if(!records.length){list.append(el('p','suite-empty','Shinies appear here after the bot catches them and verifies an in-game save. Start a hunt from Farming.'));return;}
      for(const r of records){
        const row=el('article','suite-shiny-row');row.dataset.shinyId=r.id;row.dataset.owned=String(Boolean(r.owned));row.dataset.game=r.game;
        const sprite=el('img','suite-shiny-sprite');sprite.src='./'+r.sprite;sprite.alt='Shiny '+r.name;sprite.width=96;sprite.height=96;
        const info=el('div','suite-shiny-info'),heading=el('div','suite-shiny-heading');
        heading.append(el('h2','',r.name),el('span','suite-shiny-state',r.state==='traded'?'Traded':r.owned?'Saved shiny':'Not in current save'));
        info.append(heading,el('p','suite-shiny-location',`${r.gameLabel}${r.pokemon.level?' · Level '+r.pokemon.level:''}${r.location?' · '+r.location:''}`));
        info.append(el('p','suite-shiny-traits',[r.pokemon.nature?.name,r.ability].filter(Boolean).join(' · ')));
        const stats=el('dl','suite-shiny-ivs');
        for(const [key,label] of Object.entries({hp:'HP',attack:'Attack',defense:'Defense',spAttack:'Sp. Atk',spDefense:'Sp. Def',speed:'Speed'})){
          const stat=el('div','');stat.append(el('dt','',label),el('dd','',String(r.pokemon.ivs?.[key]??'—')));stats.append(stat);
        }
        info.append(el('p','suite-shiny-iv-label','IVs'),stats);
        if(r.traits?.unmet?.length)info.append(el('p','suite-shiny-note','Caught and preserved; requested traits not met: '+r.traits.unmet.join(', ')+'.'));
        const actions=el('div','suite-shiny-actions');
        if(r.owned){
          const trade=el('button','suite-primary',r.trade&&r.trade.phase!=='complete'?'Resume trade':'Open trade lobby');trade.type='button';trade.dataset.shinyTrade=r.id;trade.disabled=busy||!r.canTrade;
          trade.addEventListener('click',()=>command('trade-shiny',{game:r.game,shinyId:r.id}));actions.append(trade);
          const viewer=el('button','suite-text-button','Open game');viewer.type='button';viewer.addEventListener('click',async()=>{try{await openGame(r.game);}catch(e){message.textContent=e.message;}});actions.append(viewer);
        }
        const trade=r.trade;
        if(trade){
          const phase=trade.phase==='complete'?'Trade complete; save and normal exit verified':trade.advertising?'Leader lobby open — join this game':String(trade.phase||'Preparing trade').replaceAll('-',' ');
          info.append(el('p','suite-shiny-trade-status',phase));
        }
        if(!trade&&r.preparation&&r.taskState==='running')info.append(el('p','suite-shiny-trade-status','Preparing the selected Pokémon for trading'));
        if((trade||r.preparation)&&r.taskState==='running'){const stop=el('button','suite-secondary','Stop trade');stop.type='button';stop.disabled=busy;stop.addEventListener('click',()=>command('stop-trade',{game:r.game}));actions.append(stop);}
        if(r.taskReason&&r.taskState==='blocked')info.append(el('p','suite-shiny-note',r.taskReason));
        row.append(sprite,info,actions);list.append(row);
      }
    }
    async function refresh(){if(!owner||loading)return;loading=true;try{records=(await api('shinies')).shinies||[];render();}catch(e){message.textContent=e.message;}finally{loading=false;}}
    root.querySelector('#suite-shiny-refresh').addEventListener('click',refresh);
    setInterval(()=>{if(active&&owner&&!document.hidden)void refresh();},3000);
    return {update(next){const wasActive=active;owner=next.controlAvailable;active=next.active;if(active&&!wasActive)void refresh();render();}};
  }
  window.SuiteShinies={create};
})();
