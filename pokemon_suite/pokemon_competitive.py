"""Sourced Champions build intent, separate from source-cartridge requirements."""
from datetime import datetime, timezone
from .data_provider import read_data
import copy
import json
from pathlib import Path

FIELDS = {'destination', 'format', 'presetId', 'catalogRevision', 'nature', 'ability', 'item', 'moves', 'statPoints'}


def catalog():
    return read_data('champions.json')


def plan(value, source_species_id, now=None):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != FIELDS:
        raise ValueError('Champions build has missing or unsupported settings.')
    data = catalog()
    if value['destination'] != 'pokemon-champions' or value['format'] not in ('singles', 'doubles'):
        raise ValueError('Choose Champions Singles or Doubles.')
    if value['catalogRevision'] != data['revision']:
        raise ValueError('The recommendations have changed. Review and choose a current build.')
    preset = next((p for p in data['presets'] if p['id'] == value['presetId']), None)
    if not preset or preset['format'] != value['format'] or source_species_id not in preset['sourceSpeciesIds']:
        raise ValueError('This Champions build does not match the Pokémon and battle format.')
    for field, options in [('nature','natures'), ('ability','abilities'), ('item','items')]:
        if value[field] not in (preset[options] or [None]):
            raise ValueError(f'Choose a recommended Champions {field}.')
    if (not isinstance(value['moves'], list) or len(value['moves']) != 4 or
            any(not isinstance(m, str) or m not in options for m, options in zip(value['moves'], preset['moves'])) or
            len(set(value['moves'])) != 4):
        raise ValueError('Choose four distinct moves from the build’s alternatives.')
    spread = value['statPoints']
    if (not isinstance(spread, dict) or not all(type(n) is int for n in spread.values()) or
            spread not in preset['spreads']):
        raise ValueError('Choose one of the recommended Champions stat-point spreads.')
    moment = datetime.fromisoformat(now.replace('Z', '+00:00')) if now else datetime.now(timezone.utc)
    review_after = datetime.fromisoformat(data['regulation']['reviewAfter'].replace('Z', '+00:00'))
    freshness = 'review-required' if moment >= review_after else 'current-snapshot'
    return {
        'destination': 'Pokémon Champions', 'pokemon': preset['pokemon'], 'name': preset['name'],
        'format': value['format'], 'selection': copy.deepcopy(value),
        'regulation': data['regulation']['id'], 'checkedAt': data['checkedAt'],
        'reviewAfter': data['regulation']['reviewAfter'], 'freshness': freshness,
        'sourceUrl': preset['sourceUrl'], 'evidence': preset['evidence'], 'onlineReady': False,
        'steps': [
            f'Prepare {preset["pokemon"]} from the captured Pokémon; verify any evolution and form requirements',
            'Verify the transfer route, Pokémon HOME acceptance, and Champions visitor eligibility',
            'Apply the chosen nature, ability, moves, item, and stat points in Champions',
            'Check the full team in the current Ranked Battle regulation before online play',
        ],
        'notes': [
            'Community build recommendation; team fit and the chosen move combination still need review.',
            'Champions uses stat points rather than source-game EVs or IVs. This build does not add catch IV requirements.',
            'The source-game catch settings, including shiny status and ball, are preserved separately.',
            ('The regulation has changed since this snapshot. Review this build before using it.' if freshness == 'review-required'
             else 'Regulation M-C begins September 9. These recommendations need review when the rules change.'),
        ],
    }
