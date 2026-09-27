import argparse
import json
from .bootstrap import initialize, doctor
from .paths import default_data_directory


def main():
    parser = argparse.ArgumentParser(prog='pokemon-suite', description='Pokémon Suite standalone runtime')
    parser.add_argument('--data-dir', default=None, help='Independent game profiles and saves directory')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('init', help='Initialize an empty profile without replacing existing settings')
    commands.add_parser('doctor', help='Check product resources and runtime dependencies')
    serve = commands.add_parser('serve', help='Open the standalone Suite service')
    serve.add_argument('--port', type=int, default=8765)
    serve.add_argument('--open', action='store_true', help='Open the Suite in the default browser')
    serve.add_argument('--desktop-node', help='Native host: bundled Node executable')
    add = commands.add_parser('add-firered', help='Install your verified FireRed ROM')
    add.add_argument('--rom', required=True)
    add.add_argument('--resources', help='Bot resource folder; the Mac app supplies its bundled pack')
    add.add_argument('--game-port', type=int, default=17639)
    args = parser.parse_args()
    directory = args.data_dir or default_data_directory()
    if args.command == 'add-firered':
        from .installation import install_firered
        print(json.dumps(install_firered(directory,args.rom,args.resources,args.game_port),indent=2))
        return
    if args.command == 'serve':
        from .server import SuiteServer
        server = SuiteServer(directory, args.port)
        if args.desktop_node:
            import sys
            from .desktop import runtime_overrides, watch_parent
            server.desktop = True
            server.companion.restore()
            server.pokemon_sessions.runtime_overrides = runtime_overrides(args.desktop_node)
            watch_parent(server, sys.stdin)
        print(json.dumps({'product': 'pokemon-suite', 'port': server.server_port,
                          'url': f'http://127.0.0.1:{server.server_port}/'}), flush=True)
        if args.open:
            import webbrowser
            webbrowser.open(f'http://127.0.0.1:{server.server_port}/')
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return
    result = initialize(directory) if args.command == 'init' else doctor(directory)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
