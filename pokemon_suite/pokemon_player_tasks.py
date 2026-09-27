"""Game-aware player task options and validation at the Suite boundary."""
import json
import uuid
from pathlib import Path
from .pokemon_farming import fields,integer,choice

EV_STATS={'hp','attack','defense','speed','spAttack','spDefense'}

def effort_inventory(library,game):
    if game!='firered':raise ValueError('Exact EV training is currently available for FireRed.')
    from .pokemon_farming import catalog
    snapshot=library._snapshot(game)  # Current native save only; no radio probe or save switch.
    names={p['id']:p['name'] for p in catalog(game)['species']}
    return {'game':game,'validity':snapshot['validity'],'pokemon':[
        {**p,'name':names.get(p.get('nationalSpeciesId'),str(p.get('species')))} for p in snapshot.get('pokemon',[])
        if snapshot['validity']=='valid' and p.get('fingerprint') and not p.get('identityConflict') and not p.get('isEgg')]}

def validate_effort_task(value):
    fields(value,{'kind','fingerprint','evs','ivRanges'},'EV training')
    fields(value['evs'],EV_STATS,'EV targets')
    for stat,n in value['evs'].items():integer(n,0,255,stat)
    if sum(value['evs'].values())>510:raise ValueError('EV targets cannot exceed 510 in total.')
    try:identity=json.loads(value['fingerprint'])
    except (ValueError,TypeError):raise ValueError('Choose an individual from the current game.')
    if not isinstance(identity,list) or len(identity)!=9 or any(type(n) is not int for n in identity):raise ValueError('Choose a verified Pokémon identity.')
    integer(identity[0],1,411,'Species')
    for n in identity[1:3]:integer(n,0,0xffffffff,'Identity')
    for n in identity[3:]:integer(n,0,31,'IV')
    if not isinstance(value['ivRanges'],dict) or not set(value['ivRanges'])<=EV_STATS:raise ValueError('Choose valid IV ranges.')
    for stat,r in value['ivRanges'].items():
        fields(r,{'min','max'},'IV range');integer(r['min'],0,31,stat);integer(r['max'],r['min'],31,stat)
    return value

def options(sessions,game):
    cfg=sessions.config()['games'].get(game)
    if cfg is None:raise ValueError('Choose a configured game.')
    from .capabilities import game_features
    from .pokemon_main_series import MAIN_GAMES
    feature=game_features(game,MAIN_GAMES[game],cfg)['travel']
    if feature['support']=='unimplemented' or feature['readiness']!='ready':return {'game':game,'supported':False,'reason':feature['reason'],'locations':[],'items':[]}
    if game!='firered':return {'game':game,'supported':False,'locations':[],'items':[]}
    with open(cfg['inputs']['world']) as source:world=json.load(source)
    with open(cfg['inputs']['battle']) as source:mechanics=json.load(source)
    maps=world.get('data',world).get('maps',[])
    items=mechanics.get('data',mechanics).get('items',[])
    if not items:items=json.loads((Path(__file__).parent/'static/data/pokedex/firered-items.json').read_text())['items']
    if isinstance(items,dict):items=list(items.values())
    profiles=[]
    for path in sorted((sessions.directory/game/'save-profiles').glob('*.json')):
        try:record=json.loads(path.read_text());profiles.append({k:record[k] for k in ['id','label','createdAt']})
        except (ValueError,KeyError):continue
    return {'game':game,'supported':True,'profiles':sorted(profiles,key=lambda p:p['createdAt'],reverse=True),
            'locations':sorted([{'id':m['id'],'name':m['id'].removeprefix('MAP_').replace('_',' ').title()} for m in maps if m.get('layout')],key=lambda m:m['name']),
            'items':sorted([{'id':i['id'],'name':i.get('name',str(i['id']))} for i in items if isinstance(i.get('id'),int) and i['id']>0],key=lambda i:i['name'])}

def validate(sessions,game,value):
    supported=options(sessions,game)
    if not supported['supported']:raise ValueError('Player task automation is currently available for FireRed.')
    if not isinstance(value,dict):raise ValueError('Choose a player task.')
    kind=value.get('kind');choice(kind,['travel','item','heal','save','ev-training'],'Task')
    if kind=='ev-training':return {'id':uuid.uuid4().hex,**validate_effort_task(value)}
    fields(value,{'kind','map'} if kind=='travel' else {'kind','itemId','quantity'} if kind=='item' else {'kind'},'Task')
    if kind=='travel':choice(value['map'],[m['id'] for m in supported['locations']],'Location')
    if kind=='item':
        choice(value['itemId'],[i['id'] for i in supported['items']],'Item');integer(value['quantity'],1,99,'Quantity')
    return {'id':uuid.uuid4().hex,**value}
