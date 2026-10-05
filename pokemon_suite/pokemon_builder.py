"""Competitive builder service over the read-only PC inventory.

Guidance, fixed-vs-changeable analysis, step plans and legality verdicts. It
only reads inventory snapshots and bundled data; starting a step goes through
the existing player-task and goal endpoints, never through this module.
"""
import re

from .pokemon_build_plan import describe, new_individual, normalize_target, plan as build_plan, target_from_guidance
from .pokemon_builder_knowledge import knowledge
from .pokemon_legality import check, check_inventory, save_ot_id
from .pokemon_set_guidance import guidance as species_guidance, movepool
from . import gen3_rules as rules

GAME = 'firered'
POKEMON_ID = re.compile('[a-f0-9]{64}')


def _game(game):
    if game != GAME:
        raise ValueError('The competitive builder reads FireRed saves.')
    return game


def _species(value):
    try:
        species = int(value)
    except (TypeError, ValueError):
        species = 0
    if not 1 <= species <= 386:
        raise ValueError('Choose a National Pokédex species from 1 to 386.')
    return species


def _inventory(trading, game, source):
    inventory = trading.inventory(_game(game), source)
    if not inventory.get('supported', True) or inventory.get('validity') != 'valid':
        raise ValueError(inventory.get('reason') or 'The party and PC could not be read.')
    return inventory


def _record(inventory, pokemon_id):
    if not isinstance(pokemon_id, str) or not POKEMON_ID.fullmatch(pokemon_id):
        raise ValueError('Choose a Pokémon from the PC inventory.')
    matches = [p for p in inventory['pokemon'] if p.get('id') == pokemon_id]
    if len(matches) != 1:
        raise ValueError('This Pokémon is no longer in the selected save.')
    return matches[0]


def guidance(species):
    """Set guidance for one species, each set also as a ready target."""
    species = _species(species)
    k = knowledge()
    result = species_guidance(species, k)
    for entry in result['sets']:
        entry['target'] = target_from_guidance(entry, species)
    # Choices for editing a target set (FireRed/LeafGreen movepool, held items, natures).
    pool = movepool(species, k)
    result['movepool'] = sorted(({'id': move_id, 'name': k.move_name(move_id), 'type': k.move(move_id)['type'],
                                  'category': k.move(move_id)['category'], 'power': k.move(move_id)['power'], 'source': source['label'],
                                  'needsNewIndividual': source['needsNewIndividual']} for move_id, source in pool.items()),
                                key=lambda m: m['name'])
    result['heldItems'] = sorted(({'nativeId': native, 'name': k.item_name(native), 'obtainableInFireRed': str(native) in k.facts['items']}
                                  for native, item in k.held_items.items() if item.get('heldEffect')), key=lambda i: i['name'])
    result['natures'] = [{'id': name.lower(), 'name': name, 'raised': rules.nature(index)['raised'], 'lowered': rules.nature(index)['lowered']}
                         for index, name in enumerate(rules.NATURE_NAMES)]
    result['hiddenPowerTypes'] = list(rules.HIDDEN_POWER_TYPES)
    return result


def individual(trading, game, source, pokemon_id):
    inventory = _inventory(trading, game, source)
    record = _record(inventory, pokemon_id)
    k = knowledge()
    result = describe(record, k, save_ot_id(inventory))
    return {**result, 'sourceId': inventory.get('sourceId'), 'isActiveSave': inventory.get('isActiveSave')}


def plan(trading, payload):
    if not isinstance(payload, dict) or set(payload) != {'game', 'sourceId', 'pokemonId', 'target'}:
        raise ValueError('Send game, sourceId, pokemonId and target.')
    if not isinstance(payload['sourceId'], str) or not payload['sourceId']:
        raise ValueError('Choose the save the Pokémon is in.')
    inventory = _inventory(trading, payload['game'], payload['sourceId'])
    record = _record(inventory, payload['pokemonId'])
    k = knowledge()
    source = 'current' if inventory.get('isActiveSave') else inventory.get('sourceId')
    result = build_plan(record, payload['target'], k, save_ot_id(inventory), source_id=source)
    return {**result, 'sourceId': inventory.get('sourceId'), 'isActiveSave': inventory.get('isActiveSave')}


def request(target):
    """A validated target and its new-individual goal draft, without an owned Pokémon (for the Bank's "get it")."""
    k = knowledge()
    normalized = normalize_target(target, k)
    return {'target': normalized, 'newIndividual': new_individual(k, normalized, [])}


def legality(trading, game, source, pokemon_id=None):
    inventory = _inventory(trading, game, source)
    if pokemon_id is not None:
        return {'result': check(_record(inventory, pokemon_id), save_ot_id(inventory))}
    return check_inventory(inventory)
