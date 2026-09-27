"""Compile game-specific UI/farming facts from the pinned offline reference.

Native battle tables remain authoritative for the qualified FireRed engine.
Existing encounter/acquisition routes and artwork references are preserved.
"""
import hashlib
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from pokemon_suite.pokedex_database import Pokedex

def sync(root=ROOT):
    folder=root/'pokemon_suite/static/data/pokedex';dex=Pokedex(folder/'master.sqlite3')
    def generated(name):return json.loads((root/f'engine/firered/src/data/{name}-catalog.js').read_text().split('export default ',1)[1].rstrip().removesuffix(';'))
    items=generated('item');moves={m['id']:m for m in generated('move')['moves']}
    names={r['item_id']:r['name'] for r in dex.rows('SELECT item_id,name FROM item_names WHERE local_language_id=9')}
    move_names={r['move_id']:r['name'] for r in dex.rows('SELECT move_id,name FROM move_names WHERE local_language_id=9')}
    native={r['game_index']:r['item_id'] for r in dex.rows('SELECT game_index,item_id FROM item_game_indices WHERE generation_id=3')}
    reference={'schema':'pokemon-suite/pokedex/v1','sha256':hashlib.sha256(dex.path.read_bytes()).hexdigest(),'source':dex.coverage()['source']['commit']}
    for game in ['firered','leafgreen','emerald','crystal']:
        path=folder/f'{game}.json';profile=json.loads(path.read_text());context=dex.game_context(game)
        for mon in profile['species']:
            facts=dex.pokemon(mon['id'],game=game)
            mon['types']=facts['types'];mon['stats']={k.replace('special-attack','specialAttack').replace('special-defense','specialDefense'):v for k,v in facts['stats'].items()}
        old={m['id']:m for m in profile['moves']};profile['moves']=[]
        # Shadow moves from the GameCube titles remain in the master database;
        # they are not cartridge move IDs in these four game profiles.
        for row in dex.rows('SELECT id FROM moves WHERE generation_id<=? AND id<10000 ORDER BY id',(context['generation'],)):
            m=dex.move(row['id'],generation=context['generation'],version_group=context['version_group'])
            entry={**old.get(m['id'],{}),'id':m['id'],'name':move_names[m['id']],'type':m['type'],'power':m['power'],'accuracy':m['accuracy'],'pp':m['pp'],'category':m['damage_class']}
            if game in {'firered','leafgreen'}:
                entry['nativeRule']={k:v for k,v in moves[m['id']].items() if k in {'effect','target','priority','flags'}}
            profile['moves'].append(entry)
        if context['generation']==3:
            held={i['nativeId']:i for i in profile['heldItems']}
            for item in items['items']:
                if item['reserved'] or not item['effectId']:continue
                pid=native.get(item['id'])
                if pid is None:raise ValueError('Missing native item mapping: '+item['name'])
                entry=held.setdefault(item['id'],{'id':pid,'name':names[pid],'nativeId':item['id']})
                entry['heldEffect']={'name':item['effect'],'id':item['effectId'],'param':item['param'],'generation':3}
            profile['heldItems']=sorted(held.values(),key=lambda i:i['nativeId'])
        profile['reference']=reference
        profile.pop('revision',None)
        profile['revision']=hashlib.sha256(json.dumps(profile,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        path.write_text(json.dumps(profile,separators=(',',':'),ensure_ascii=False)+'\n')
        print(json.dumps({'game':game,'species':len(profile['species']),'moves':len(profile['moves']),'heldItems':len(profile['heldItems'])}))

if __name__=='__main__':sync()
