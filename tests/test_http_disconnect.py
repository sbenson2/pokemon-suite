from http.server import BaseHTTPRequestHandler
import unittest
from unittest.mock import patch

from pokemon_suite.server import Handler


class HTTPDisconnectTests(unittest.TestCase):
    def test_a_departed_browser_does_not_report_an_application_failure(self):
        handler=Handler.__new__(Handler)
        for error in [BrokenPipeError(),ConnectionResetError()]:
            with patch.object(BaseHTTPRequestHandler,'handle',side_effect=error):
                try:handler.handle()
                except (BrokenPipeError,ConnectionResetError):self.fail('A routine browser disconnect escaped the request boundary.')

    def test_unrelated_handler_errors_are_still_visible(self):
        handler=Handler.__new__(Handler)
        with patch.object(BaseHTTPRequestHandler,'handle',side_effect=ValueError('application failure')):
            with self.assertRaisesRegex(ValueError,'application failure'):handler.handle()
