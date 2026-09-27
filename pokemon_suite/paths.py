"""Installation resources and per-user data have independent lifetimes."""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def default_data_directory():
    override = os.environ.get('POKEMON_SUITE_DATA')
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData/Local')) / 'PokemonSuite'
    if sys.platform == 'darwin':
        return Path.home() / 'Library/Application Support/PokemonSuite'
    return Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'pokemon-suite'
