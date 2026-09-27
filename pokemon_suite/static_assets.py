"""Neutral artwork for source releases that do not distribute game sprites."""
from pathlib import PurePosixPath


def fallback_icon(path):
    path=PurePosixPath(path.lstrip('/'))
    if '..' in path.parts or any(p.startswith('.') for p in path.parts):return None
    name=path.as_posix()
    if name in {'assets/pokemon/ui/pokemon-neutral.svg','assets/pokemon/ui/trainer-neutral.svg'}:
        return 'trainer' if 'trainer' in path.name else 'species'
    if path.suffix!='.png':return None
    if name.startswith(('assets/pokedex/','assets/firered/pokemon/')):return 'species'
    if name.startswith('assets/pokemon/items/'):return 'item'
    if name.startswith('assets/pokemon/ui/'):return 'category'
    if name.startswith('assets/firered/ui/'):
        if 'badge' in path.name:return 'badges'
        return 'item' if 'ball' in path.name else 'trainer'
    return None
