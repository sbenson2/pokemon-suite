"""Cartridge-backed routes offered by the current wild encounter executor."""
from .data_provider import read_data
import copy
from functools import lru_cache
import json
from pathlib import Path

def land_routes():
    return read_data('pokedex/firered-hunt-routes.json','firered')['routes']

def wild_capability(r):
    result={'supported':False,'setup':'current-game','reason':None}
    if r['game']!='firered':result['reason']='This game needs its own capture and RNG executor.';return result
    if not 1<=r['quantity']<=99:result['reason']='Choose a quantity from 1 to 99.';return result
    if r['moves'] or r['heldItemId'] is not None or r['finalLevel'] is not None:
        result['reason']='Wild hunts save each Pokémon as caught. Final leveling, moves and held items need a preparation task.';return result
    routes=[x for x in land_routes() if x['speciesId']==r['speciesId'] and (r['locationId']=='any' or x['locationId']==r['locationId']) and x['minLevel']<=r['encounterLevel']['max'] and x['maxLevel']>=r['encounterLevel']['min']]
    ball=r['ball'];required=ball.get('requirement')=='required'
    routes=[x for x in routes if not required or ball['id'] in ({'any','safari-ball'} if x['method']=='safari-land' else {'any','poke-ball','great-ball','ultra-ball','master-ball'})]
    if not routes:
        result['reason']='No supported land encounter matches these settings in FireRed. Evolution, trade, fishing, gifts and special encounters need their own acquisition route.';return result
    # Prefer ordinary capture controls, then the highest encounter share. The
    # worker verifies reachability and measures RNG timing in the current game.
    route=min(routes,key=lambda x:(x['method']=='safari-land',-x['chance'],x['map']))
    return {**result,'supported':True,'method':route['method'],'route':route}


@lru_cache(maxsize=1)
def _static_projection():
    return json.loads((Path(__file__).parent/'firered_static_encounters.json').read_text())


def static_encounters():
    """The engine's one-time static encounters (projection of its static mission table).

    Executor capability, like the roamer/gift rules above, not pinned game data."""
    return copy.deepcopy(_static_projection()['encounters'])


def static_encounter(species_id):
    return next((e for e in static_encounters() if e['speciesId']==species_id),None)


def static_capability(r, encounter):
    """A request for an engine static; the live save's availability is checked separately."""
    name=encounter['name'];reason=None
    if r['quantity']!=1:reason=f"Each FireRed save has one {name} encounter. Set quantity to 1."
    elif r['locationId']!='any':reason=f"Choose any location; {name} appears only at {encounter['location']}."
    elif not r['encounterLevel']['min']<=encounter['level']<=r['encounterLevel']['max']:reason=f"The FireRed {name} encounter is level {encounter['level']}."
    elif r['moves'] or r['heldItemId'] is not None or r['finalLevel'] is not None:reason='Final moves, leveling and held items need a separate preparation task.'
    elif r['ball']['requirement']=='required' and r['ball']['id'] not in encounter['balls']:reason='This legendary workflow supports Poké, Great and Ultra Balls.'
    route={'method':'static',**{k:encounter[k] for k in ('speciesId','nativeSpecies','name','map','flag','level','locationId','location')}}
    return {'supported':reason is None,'reason':reason,'setup':'current-game','method':'static','route':route,'requires':[{k:g[k] for k in ('key','flag','label','need')} for g in encounter['requires']]}
