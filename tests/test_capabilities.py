import unittest

from pokemon_suite.pokemon_main_series import describe_library


class CapabilityTests(unittest.TestCase):
    def entry(self, game, config):
        return next(x for x in describe_library({'games': {game: config}}) if x['id'] == game)

    def test_a_playback_only_core_does_not_advertise_firered_automation(self):
        entry = self.entry('firered', {'backend': 'libretro'})
        self.assertFalse(entry['capabilities']['bot'])
        self.assertFalse(entry['capabilities']['hunt'])
        self.assertFalse(entry['capabilities']['trade'])

    def test_native_save_does_not_imply_an_emulator_checkpoint(self):
        entry = self.entry('x', {'backend': 'desktop'})
        self.assertFalse(entry['capabilities']['checkpoint'])
        self.assertEqual(entry.get('features', {}).get('checkpoint', {}).get('support'), 'unimplemented')

    def test_dex_is_available_without_an_emulator_or_bot(self):
        entry = next(x for x in describe_library({'games': {}}) if x['id'] == 'leafgreen')
        self.assertTrue(entry['capabilities']['dex'])
        self.assertFalse(entry['capabilities']['bot'])
        self.assertEqual(entry.get('features', {}).get('dex', {}).get('readiness'), 'ready')

    def test_a_configured_game_with_missing_resources_is_not_ready(self):
        entry = self.entry('firered', {'cartridge': {'path': '/missing/fire.gba'}, 'core': '/missing/core'})
        self.assertFalse(entry['capabilities']['play'])
        self.assertEqual(entry.get('features', {}).get('play', {}).get('readiness'), 'needs-setup')

    def test_companion_support_does_not_claim_a_qualified_emerald_campaign(self):
        entry = self.entry('emerald', {})
        self.assertNotEqual(entry.get('features', {}).get('campaign', {}).get('support'), 'qualified')
        self.assertEqual(entry.get('features', {}).get('campaign', {}).get('support'), 'unimplemented')


if __name__ == '__main__':
    unittest.main()

class ReadinessTests(unittest.TestCase):
    def test_an_empty_configuration_never_claims_ready_playback(self):
        from pokemon_suite.capabilities import game_features
        result=game_features('firered',{'platform':'gba'},{})
        self.assertEqual(result['play']['readiness'],'needs-setup')
