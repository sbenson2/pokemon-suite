"""Game-aware acquisition paths. A valid game path is not an executor claim."""
from __future__ import annotations
import re
from .pokemon_evolution import evolution_rule

GENERATION={'firered':3,'leafgreen':3,'emerald':3,'crystal':2}

def evolution_step(game, parent, target, condition):
    rule=evolution_rule(game,parent,target)
    if rule is None:raise ValueError(f'No verified {game} evolution rule for {parent} → {target}.')
    step={'kind':'evolve','game':game,'condition':condition,**rule}
    if step.get('item'):step['requiredItem']=step['item'];step['item']=step['item']['name']
    return step

def acquisition_routes(request, catalogs, available_games=None, statics=None):
    """statics: the engine's static encounters by species (FireRed); their story
    gates become route prerequisites so a goal can play the story first."""
    statics=statics or {}
    game=request['game'];target=request['speciesId']
    available_games=set(available_games) if available_games is not None else {'firered','emerald','crystal'}
    dex={g:{m['id']:m for m in d['species']} for g,d in catalogs.items()}
    if game not in dex or target not in dex[game]:return []
    def sources(g,pid,seen=frozenset()):
        key=(g,pid)
        if key in seen or pid not in dex.get(g,{}):return []
        seen=seen|{key};mon=dex[g][pid];routes=[]
        for encounter in mon['encounters']:
            # Native NPC trades use fixed identities, not a random shiny roll.
            if encounter['method']=='trade' and request['shiny']=='required':continue
            if request['locationId']!='any' and encounter['id']!=request['locationId']:continue
            if encounter['minLevel']>request['encounterLevel']['max'] or encounter['maxLevel']<request['encounterLevel']['min']:continue
            ball=request['ball']
            if ball['requirement']=='required' and ball['id']!='any':
                if encounter['safari'] and ball['id']!='safari-ball':continue
                if not encounter['safari'] and ball['id']=='safari-ball':continue
                if encounter['method'] in ('gift','gift-egg','trade') and ball['id']!='poke-ball':continue
            source={'game':g,'gameLabel':catalogs[g]['label'],'speciesId':pid,'name':mon['name'],'shiny':request['shiny'],**encounter}
            routes.append({'source':source,'steps':[{'kind':'acquire','game':g,'speciesId':pid,'method':encounter['method'],'locationId':encounter['id'],'location':encounter['location'],'shiny':request['shiny']}]})
        parent=mon.get('evolvesFrom')
        if parent in dex[g]:
            edges=[e for e in dex[g][parent]['evolutions'] if e['speciesId']==pid]
            for edge in edges:
                for route in sources(g,parent,seen):
                    steps=list(route['steps'])
                    rule=evolution_rule(g,parent,pid)
                    if rule is None:continue
                    external=rule.get('evolutionGame') or (rule.get('preparationGame') if rule.get('preparationGame')!=g else None)
                    if external:
                        if 'emerald' not in dex:continue
                        steps += [
                            {'kind':'trade','fromGame':g,'toGame':'emerald','speciesId':parent,'reason':'This evolution needs the other game’s clock or preparation facilities.'},
                            evolution_step('emerald',parent,pid,edge['condition']),
                            {'kind':'trade','fromGame':'emerald','toGame':g,'speciesId':pid,'reason':'Return the evolved Pokémon to the selected game.'}]
                    elif rule['trigger']=='trade':
                        partner=game if game!=g else next((p for p in ('leafgreen','firered','emerald') if p!=g and p in available_games and GENERATION[g]==3),'crystal-partner' if g=='crystal' else 'gen3-partner')
                        if rule.get('heldItem'):steps.append({'kind':'equip-evolution-item','game':g,'speciesId':parent,'item':rule['heldItem'],'verifyIdentity':True,'verifyEquipped':True})
                        steps += [{'kind':'trade','fromGame':g,'toGame':partner,'speciesId':parent,'evolution':evolution_step(partner if partner in dex else g,parent,pid,edge['condition']),'verifyConsumedItem':bool(rule.get('heldItem'))},
                                  {'kind':'trade','fromGame':partner,'toGame':g,'speciesId':pid,'reason':'Return the evolved Pokémon to the selected game.'}]
                    else:steps.append(evolution_step(g,parent,pid,edge['condition']))
                    routes.append({'source':route['source'],'steps':steps})
        return routes
    routes=sources(game,target)
    # Version-exclusive sources stay within a generation's real link boundary.
    # Crystal cannot supply a FireRed cartridge through a Gen II → III trade.
    if not routes and request['locationId']=='any':
        for other in dex:
            if other==game or GENERATION.get(other)!=GENERATION.get(game):continue
            for route in sources(other,target):
                routes.append({'source':route['source'],'steps':route['steps']+[{'kind':'trade','fromGame':other,'toGame':game,'speciesId':target,'reason':'Obtain the version-exclusive Pokémon in the selected game.'}]})
    for route in routes:
        steps=[]
        for step in route['steps']:
            prior=steps[-1] if steps else {}
            if step['kind']==prior.get('kind')=='trade' and not step.get('evolution') and not prior.get('evolution') and step['speciesId']==prior['speciesId'] and step['fromGame']==prior['toGame'] and step['toGame']==prior['fromGame']:
                steps.pop()
            else:steps.append(step)
        route['steps']=steps
        minimum=max(route['source']['minLevel'],request['encounterLevel']['min'])
        for step in route['steps']:
            if step['kind']=='evolve':
                minimum=max(minimum+1,step.get('level',0)) if step['trigger']=='level-up' else minimum
        route['minimumFinalLevel']=minimum
        prerequisites=[]
        def require(g,key,label):
            item={'game':g,'key':key,'label':label}
            if item not in prerequisites:prerequisites.append(item)
        for step in route['steps']:
            if step['kind']=='acquire' and step['game']=='firered' and step['method']=='static' and step['speciesId'] in statics:
                for gate in statics[step['speciesId']]['requires']:require('firered',gate['key'],gate['label'])
            if step.get('nationalDexRequired'):require(step['game'],'nationalDex','Unlock the National Pokédex')
            if step['kind']=='trade':
                step.update(requiresSeparateOwner=True,partnerGeneration=GENERATION[game],verifyBothSaves=True,verifyLinkExit=True,preserveIdentity=True,friendshipAfterTrade=70)
                pair={step['fromGame'],step['toGame']}
                for g in pair:
                    if g not in catalogs:require(game,'partner-game','Connect another compatible game with its own save and trade partner Pokémon')
                    elif g not in available_games:require(g,'configured','Configure this game with its own ROM and current save')
                if step.get('evolution',{}).get('nationalDexRequired'):require(step['toGame'],'nationalDex','Unlock the receiving game’s National Pokédex before evolution')
                if 'emerald' in pair and pair & {'firered','leafgreen'}:
                    require('emerald','leagueComplete','Become Champion in Emerald')
                    require('emerald','nationalDex','Unlock the National Pokédex in Emerald')
                    for g in pair & {'firered','leafgreen'}:
                        require(g,'canLinkNationally',f"Complete Celio’s Ruby and Sapphire quest in {catalogs[g]['label']}")
                        require(g,'nationalDex',f"Unlock the National Pokédex in {catalogs[g]['label']}")
        route['resources']=[]
        for step in route['steps']:
            resource=step.get('requiredItem') or (step.get('item') if step['kind']=='equip-evolution-item' else None)
            if resource:route['resources'].append({'game':step['game'],'item':resource,'quantity':request.get('quantity',1),'purpose':'evolution','consumed':True,'reserveBeforeStarting':True})
        if request.get('finalLevel') is not None:route['steps'].append({'kind':'train-final-level','game':game,'speciesId':target,'level':request['finalLevel'],'preserveEvolution':True})
        if request.get('moves'):route['steps'].append({'kind':'prepare-final-moves','game':game,'speciesId':target,'moves':request['moves'],'requiresCombinedMovePlan':True})
        if request.get('heldItemId') is not None:
            item=next((i for i in catalogs[game]['heldItems'] if i['id']==request['heldItemId']),None)
            if item:
                route['steps'].append({'kind':'equip-final-item','game':game,'speciesId':target,'item':item,'verifyEquipped':True})
                route['resources'].append({'game':game,'item':item,'quantity':request.get('quantity',1),'purpose':'finished-held-item','consumed':False,'reserveBeforeStarting':True})
        route['prerequisites']=prerequisites
        route['destination']={'game':game,'speciesId':target,'name':dex[game][target]['name']}
        route['steps'].append({'kind':'verify','game':game,'speciesId':target,'shiny':request['shiny'],'nativeSaveRequired':True})
        route['summary']=describe_route(route,catalogs)
    routes=[r for r in routes if r['minimumFinalLevel']<=100 and (request.get('finalLevel') is None or r['minimumFinalLevel']<=request['finalLevel'])]
    return sorted(routes,key=lambda r:(sum(s['kind']=='trade' or s.get('requiresTrade',False) for s in r['steps']),len(r['steps']),r['source']['safari'],-r['source']['chance'],r['source']['id']))[:64]

def describe_route(route,catalogs):
    names={g:{s['id']:s['name'] for s in d['species']} for g,d in catalogs.items()}
    labels={g:d['label'] for g,d in catalogs.items()}
    labels.update({'crystal-partner':'a separate compatible Gen II game','gen3-partner':'a separate compatible Gen III game'})
    name=lambda g,p:names.get(g,names[route['destination']['game']])[p]
    result=[]
    for step in route['steps']:
        kind=step['kind'];game=step.get('game');species=step['speciesId']
        if kind=='acquire':
            prefix='shiny ' if step['shiny']=='required' else ''
            result.append(f"Obtain {prefix}{name(game,species)} in {labels[game]} at {step['location']}")
        elif kind=='trade':
            evolution=step.get('evolution');ending=f", evolve into {name(step['toGame'],evolution['speciesId'])}" if evolution else ''
            if step.get('verifyConsumedItem'):ending+=' and verify the evolution item was consumed'
            result.append(('Remove Everstone, then trade ' if evolution and evolution.get('removeEverstone') else 'Trade ')+f"{name(step['fromGame'],species)} from {labels[step['fromGame']]} to {labels[step['toGame']]}{ending}, then verify both native saves and the completed link exit")
        elif kind in ('equip-evolution-item','equip-final-item'):
            result.append(f"Obtain and give {step['item']['name']} to {name(game,species)} in {labels[game]}"+(' before trading; this item is consumed by evolution' if kind=='equip-evolution-item' else ' after evolution and return trades'))
        elif kind=='train-final-level':result.append(f"Train {name(game,species)} to level {step['level']} in {labels[game]}")
        elif kind=='prepare-final-moves':result.append('Prepare and verify the requested final moves together, including their TM, tutor or breeding requirements')
        elif kind=='evolve':
            requirement=step['condition']
            if step.get('friendship'):
                requirement=f"friendship {step['friendship']} and a level-up"
                if step.get('hours'):
                    start,end=step['hours'];requirement+=f" between {start:02}:00 and {end:02}:00 on {labels[game]}'s game clock"
            if step.get('beauty'):requirement=f"plan dry Pokéblocks to reach Beauty {step['beauty']} before Sheen reaches 255, then level up"
            if step.get('extraPartySlot'):requirement+='; leave a free party slot and verify both Ninjask and Shedinja'
            if step.get('personalityRemainders'):requirement+='; verify the individual’s fixed personality branch before training'
            result.append(f"Evolve {names[game][step['fromSpecies']]} into {names[game][species]} in {labels[game]}: {requirement}"+('; remove Everstone first' if step.get('removeEverstone') else ''))
        else:result.append(f"Save in {labels[game]} and verify the finished {'shiny ' if step['shiny']=='required' else ''}{names[game][species]} and its original identity")
    return result
