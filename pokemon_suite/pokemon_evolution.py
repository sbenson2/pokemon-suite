"""Original-generation evolution requirements shared by planning and execution."""
from copy import deepcopy
from .data_provider import read_data
import json
from pathlib import Path


def evolution_rules(game='firered'):
    return read_data('pokedex/evolution-rules.json',game)


def evolution_rule(game, parent, target):
    return next((deepcopy(r) for r in evolution_rules(game)['games'].get(game,[]) if r['fromSpecies']==parent and r['speciesId']==target),None)
