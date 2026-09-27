import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../pokemon_suite/static/master-red-live-panel.js';

test('team art follows the current game and shiny identity rather than telemetry image URLs',()=>{
  for(const game of ['firered','emerald','crystal']){
    const result=SuiteLivePanel.projectProgressDeck({game:{id:'pokemon-'+game},spectator:{
      trainer:{name:'Player',gender:'female',portrait:'https://example.invalid/trainer.png'},
      party:[{speciesName:'Snorlax',name:'Nickname',shiny:true,level:30,hp:80,maxHp:100,sprite:'./assets/firered/pokemon/wrong-front.png'}]
    }});
    assert.equal(result.team[0].sprite,`./api/rom-art/${game}/pokemon/snorlax.png?shiny=1`);
    assert.equal(result.trainerCard.portrait,`./api/rom-art/${game}/trainer/female.png`);
  }
});

test('team resource keys preserve gendered names and punctuation',()=>{
  for(const [name,key] of [['Nidoran♀','nidoran-f'],['Mr. Mime','mr-mime'],['Farfetch’d','farfetchd']]){
    const result=SuiteLivePanel.projectProgressDeck({spectator:{party:[{speciesName:name}]}});
    assert.equal(result.team[0].sprite,`./api/rom-art/firered/pokemon/${key}.png`);
  }
});
