import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from pokemon_suite.server import SuiteServer


class ReleaseAssetTests(unittest.TestCase):
    def test_missing_game_art_uses_local_neutral_icons_without_exposing_other_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);static=root/'static';icons=static/'assets/suite';icons.mkdir(parents=True)
            for name in ['species','trainer','item','category','badges']:
                (icons/(name+'.svg')).write_text('<svg xmlns="http://www.w3.org/2000/svg"><title>'+name+'</title></svg>')
            with patch('pokemon_suite.server.STATIC',static):
                server=SuiteServer(root/'profile');thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
                try:
                    connection=http.client.HTTPConnection('127.0.0.1',server.server_port)
                    connection.request('GET','/api/presentation-assets',headers={'Cookie':'pokemon-suite-session='+server.token})
                    response=connection.getresponse();body=response.read();connection.close()
                    self.assertEqual(response.status,200)
                    self.assertEqual(json.loads(body)['recordings'],{})
                    for path,expected in [('/assets/pokedex/firered/1.png','species'),('/assets/firered/ui/red-trainer.png','trainer'),('/assets/pokemon/items/ultra_ball.png','item'),('/assets/pokemon/ui/cat_icon_type.png','category')]:
                        connection=http.client.HTTPConnection('127.0.0.1',server.server_port)
                        connection.request('GET',path);response=connection.getresponse();body=response.read()
                        self.assertEqual(response.status,200,path);self.assertEqual(response.getheader('Content-Type'),'image/svg+xml')
                        self.assertIn(expected.encode(),body);connection.close()
                    for path in ['/assets/pokedex/../../profile/config.json','/assets/pokedex/missing.json','/anything.png']:
                        connection=http.client.HTTPConnection('127.0.0.1',server.server_port);connection.request('GET',path)
                        response=connection.getresponse();response.read();self.assertEqual(response.status,404,path);connection.close()
                finally:server.shutdown();server.server_close();thread.join()
