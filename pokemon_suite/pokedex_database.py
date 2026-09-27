"""Read-only, version-aware queries over the complete local Pokédex snapshot."""
from contextlib import contextmanager
import json
from pathlib import Path
import re
import sqlite3
from .data_provider import BUNDLED,CURRENT

class Pokedex:
    def __init__(self,path=None,game='firered'):
        snapshot=CURRENT.get()
        self.path=Path(path) if path else snapshot.resource_path('pokedex/master.sqlite3',game) if snapshot else BUNDLED/'pokedex/master.sqlite3'
    @contextmanager
    def connection(self):
        db=sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True)
        db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
        try:yield db
        finally:db.close()
    def rows(self,sql,args=()):
        with self.connection() as db:return [dict(row) for row in db.execute(sql,args)]
    def one(self,table,key):
        if table not in {'pokemon_species','pokemon','items','moves','types','version_groups','versions'}:raise ValueError('Unknown resource')
        col='id' if isinstance(key,int) or str(key).isdigit() else 'identifier'
        result=self.rows(f'SELECT * FROM {table} WHERE {col}=?',(key,))
        if not result:raise ValueError('Unknown '+table+' entry')
        return result[0]
    def coverage(self):
        return {r['key']:json.loads(r['value']) for r in self.rows('SELECT key,value FROM metadata')}
    def search(self,query,limit=30):
        words=re.findall(r'[\w-]+',str(query),re.UNICODE)
        if not words:return []
        expression=' AND '.join('"'+w.replace('"','')+'"*' for w in words)
        return self.rows('SELECT kind,entity_id,identifier FROM search WHERE search MATCH ? ORDER BY rank LIMIT ?',(expression,max(1,min(100,int(limit)))))
    def species(self,key):return self.one('pokemon_species',key)
    def forms(self,species,*,generation=None,game=None):
        if game:generation=self.game_context(game)['generation']
        if generation is not None:self.generation(generation)
        return self.rows('SELECT p.* FROM pokemon p WHERE species_id=?'+(' AND EXISTS (SELECT 1 FROM pokemon_forms f JOIN version_groups g ON g.id=f.introduced_in_version_group_id WHERE f.pokemon_id=p.id AND g.generation_id<=?)' if generation is not None else '')+' ORDER BY id',(self.species(species)['id'],generation) if generation is not None else (self.species(species)['id'],))
    def generation(self,generation):
        if type(generation) is not int or not 1<=generation<=9:raise ValueError('Choose a supported generation.')
        return generation
    def game_context(self,game):
        alias={'black2':'black-2','white2':'white-2','green':'red'}
        version=self.one('versions',alias.get(game,game))
        group=self.one('version_groups',version['version_group_id'])
        return {'generation':group['generation_id'],'version_group':group['identifier'],'version':version['identifier']}
    def pokemon(self,key,*,generation=None,version_group=None,game=None):
        if game:
            context=self.game_context(game)
            if generation is not None and generation!=context['generation']:raise ValueError('Game and generation disagree.')
            generation=context['generation'];version_group=version_group or context['version_group']
        generation=9 if generation is None else generation
        generation=self.generation(generation);p=self.one('pokemon',key);pid=p['id'];species=self.species(p['species_id'])
        if species['generation_id']>generation:raise ValueError('Pokémon unavailable in this generation.')
        if pid==386 and game in {'firered','leafgreen','emerald'}:
            p=self.one('pokemon',{'firered':'deoxys-attack','leafgreen':'deoxys-defense','emerald':'deoxys-speed'}[game]);pid=p['id']
        introduced=self.rows('SELECT MIN(g.generation_id) AS generation FROM pokemon_forms f JOIN version_groups g ON g.id=f.introduced_in_version_group_id WHERE f.pokemon_id=?',(pid,))[0]['generation']
        if introduced and introduced>generation:raise ValueError('Form unavailable in this generation.')
        types=self.rows('SELECT t.identifier,p.slot FROM pokemon_types p JOIN types t ON t.id=p.type_id WHERE pokemon_id=? ORDER BY slot',(pid,))
        past=self.rows('SELECT t.identifier,p.slot,p.generation_id FROM pokemon_types_past p JOIN types t ON t.id=p.type_id WHERE pokemon_id=? AND p.generation_id>=? ORDER BY p.generation_id,p.slot',(pid,generation))
        if past:types=[r for r in past if r['generation_id']==past[0]['generation_id']]
        p['types']=[r['identifier'] for r in types]
        stats=self.rows('SELECT s.identifier,p.base_stat,p.stat_id FROM pokemon_stats p JOIN stats s ON s.id=p.stat_id WHERE pokemon_id=?',(pid,))
        paststats=self.rows('SELECT s.identifier,p.base_stat,p.stat_id,p.generation_id FROM pokemon_stats_past p JOIN stats s ON s.id=p.stat_id WHERE pokemon_id=? AND p.generation_id>=? ORDER BY p.generation_id',(pid,generation))
        history={}
        for r in paststats:history.setdefault(r['stat_id'],r)
        p['stats']={r['identifier']:history.get(r['stat_id'],r)['base_stat'] for r in stats}
        if generation==1:
            p['stats']['special']=history.get(9,{}).get('base_stat',p['stats']['special-attack'])
            p['stats'].pop('special-attack',None);p['stats'].pop('special-defense',None)
        abilities=self.rows('SELECT a.identifier,p.slot,p.is_hidden FROM pokemon_abilities p JOIN abilities a ON a.id=p.ability_id WHERE pokemon_id=?',(pid,))
        past=self.rows('SELECT a.identifier,p.slot,p.is_hidden,p.generation_id FROM pokemon_abilities_past p LEFT JOIN abilities a ON a.id=p.ability_id WHERE pokemon_id=? AND p.generation_id>=? ORDER BY p.generation_id',(pid,generation))
        byslot={r['slot']:r for r in abilities};seen=set()
        for r in past:
            if r['slot'] not in seen:byslot[r['slot']]=r;seen.add(r['slot'])
        p['abilities']=[r['identifier'] for r in byslot.values() if r['identifier'] and (generation>=5 or not r['is_hidden'])] if generation>=3 else []
        p['held_items']=self.rows('SELECT pi.*,i.identifier FROM pokemon_items pi JOIN items i ON i.id=pi.item_id JOIN versions v ON v.id=pi.version_id JOIN version_groups g ON g.id=v.version_group_id WHERE pi.pokemon_id=? AND g.generation_id=?',(pid,generation))
        if version_group:
            group=self.one('version_groups',version_group)
            if group['generation_id']!=generation:raise ValueError('Version group and generation disagree.')
            p['learnset']=self.rows('SELECT pm.move_id,m.identifier,pm.pokemon_move_method_id,pm.level,pm."order" FROM pokemon_moves pm JOIN moves m ON m.id=pm.move_id WHERE pm.pokemon_id=? AND pm.version_group_id=? ORDER BY pm.level,m.id',(pid,group['id']))
        return p
    def evolutions(self,species):
        return self.rows('SELECT * FROM pokemon_evolution WHERE evolved_species_id=?',(self.species(species)['id'],))
    def item(self,key):
        item=self.one('items',key);item['game_indices']=self.rows('SELECT * FROM item_game_indices WHERE item_id=?',(item['id'],));item['holders']=self.rows('SELECT * FROM pokemon_items WHERE item_id=?',(item['id'],));return item
    def type_matchup(self,attack,defenders,*,generation=9):
        generation=self.generation(generation);a=self.one('types',attack);result=1
        for t in [a]+[self.one('types',d) for d in set(defenders)]:
            if t['generation_id'] is None or t['generation_id']>generation:raise ValueError('Type unavailable in this generation.')
        for d in set(defenders):
            target=self.one('types',d)
            past=self.rows('SELECT damage_factor FROM type_efficacy_past WHERE damage_type_id=? AND target_type_id=? AND generation_id>=? ORDER BY generation_id LIMIT 1',(a['id'],target['id'],generation))
            current=self.rows('SELECT damage_factor FROM type_efficacy WHERE damage_type_id=? AND target_type_id=?',(a['id'],target['id']))
            if not (past or current):raise ValueError('Unknown type relationship.')
            result*=(past or current)[0]['damage_factor']/100
        return result
    def move(self,key,*,generation=9,version_group=None):
        generation=self.generation(generation);m=self.one('moves',key)
        if m['generation_id']>generation:raise ValueError('Move unavailable in this generation.')
        group=self.one('version_groups',version_group) if version_group else self.rows('SELECT * FROM version_groups WHERE generation_id=? ORDER BY "order" DESC LIMIT 1',(generation,))[0]
        if group['generation_id']!=generation:raise ValueError('Version group and generation disagree.')
        changes=self.rows('SELECT c.* FROM move_changelog c JOIN version_groups v ON v.id=c.changed_in_version_group_id WHERE c.move_id=? AND v."order">? ORDER BY v."order"',(m['id'],group['order']))
        assigned=set()
        for c in changes:
            for k,v in c.items():
                if k in m and k not in assigned and v is not None:m[k]=v;assigned.add(k)
        t=self.one('types',m['type_id']);m['type']=t['identifier']
        physical={'normal','fighting','flying','poison','ground','rock','bug','ghost','steel'}
        m['damage_class']='status' if m['damage_class_id']==1 else ('physical' if t['identifier'] in physical else 'special') if generation<=3 else 'physical' if m['damage_class_id']==2 else 'special'
        m['metadata']=self.rows('SELECT * FROM move_meta WHERE move_id=?',(m['id'],))
        return m
    def encounters(self,pokemon,version=None):
        pid=self.one('pokemon',pokemon)['id'];params=[pid];where='e.pokemon_id=?'
        if version:where+=' AND e.version_id=?';params.append(self.one('versions',version)['id'])
        return self.rows('SELECT e.*,a.identifier AS area FROM encounters e JOIN location_areas a ON a.id=e.location_area_id WHERE '+where,params)

def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('resource',choices=['coverage','search','pokemon','species','forms','evolutions','move','item','encounters','type'])
    parser.add_argument('key',nargs='?');parser.add_argument('--game');parser.add_argument('--generation',type=int)
    parser.add_argument('--defenders',nargs='+');args=parser.parse_args();dex=Pokedex()
    context=dex.game_context(args.game) if args.game else {}
    generation=args.generation if args.generation is not None else context.get('generation',9)
    if context and generation!=context['generation']:parser.error('Game and generation disagree.')
    try:
        if args.resource=='coverage':result=dex.coverage()
        elif args.resource=='search':result=dex.search(args.key or '')
        elif args.resource=='pokemon':result=dex.pokemon(args.key,generation=generation,game=args.game)
        elif args.resource=='move':result=dex.move(args.key,generation=generation,version_group=context.get('version_group'))
        elif args.resource=='type':result={'multiplier':dex.type_matchup(args.key,args.defenders or [],generation=generation)}
        elif args.resource=='encounters':result=dex.encounters(args.key,context.get('version'))
        elif args.resource=='forms':result=dex.forms(args.key,generation=generation,game=args.game)
        else:result=getattr(dex,args.resource)(args.key)
    except (ValueError,TypeError,KeyError,OSError) as error:parser.error(str(error))
    print(json.dumps(result,indent=2,ensure_ascii=False))

if __name__=='__main__':main()
