import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pokemon_suite.rom_integrity import compare_roms, verify_corpus_roms


def identity(data, ranges=()):
    return {'bytes': len(data), 'sha1': hashlib.sha1(data).hexdigest(),
            'sha256': hashlib.sha256(data).hexdigest(), 'ranges': ranges}


class RomIntegrityTests(unittest.TestCase):
    def setUp(self):
        # Artificial bytes, never copyrighted ROM content. Only offsets 4..7
        # belong to this fixture's reviewed patch; offset 6 stays unchanged.
        self.base = b'0123456789abcdef'
        self.trade = b'0123AB6D89abcdef'
        self.original = identity(self.base)
        self.approved = identity(self.trade, [(4, 8)])

    def test_partner_uses_a_reviewed_stock_rom_and_rejects_self_approved_changes(self):
        from pokemon_suite import rom_integrity
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'emerald.gba';path.write_bytes(self.base)
            policy={**self.original,'id':'emerald-us'}
            config={'cartridge':{**policy,'path':str(path)}}
            with patch.object(rom_integrity,'STOCK_PARTNER_ROMS',{'emerald':policy},create=True):
                verify=getattr(rom_integrity,'verify_stock_partner',lambda *args:None)
                self.assertEqual(verify('emerald',config),{'game':'emerald','profile':'emerald-us','romSha256':self.original['sha256']})
                path.write_bytes(self.trade);config['cartridge'].update(identity(self.trade))
                with self.assertRaisesRegex(ValueError,'partner ROM'):verify('emerald',config)

    def test_stock_and_exact_trade_patch_pass(self):
        self.assertEqual(compare_roms(self.base, self.base, self.original, self.original)['changedBytes'], 0)
        self.assertEqual(compare_roms(self.base, self.trade, self.original, self.approved)['changedBytes'], 3)

    def test_changes_outside_patch_boundaries_are_rejected(self):
        for offset in (0, 3, 8, 15):
            candidate = bytearray(self.trade); candidate[offset] ^= 1
            # Even a mistakenly approved full hash cannot broaden the ranges.
            claimed = {**self.approved, 'sha256': hashlib.sha256(candidate).hexdigest()}
            with self.subTest(offset=offset), self.assertRaisesRegex(ValueError, 'outside'):
                compare_roms(self.base, candidate, self.original, claimed)

    def test_range_permission_does_not_allow_different_patch_instructions(self):
        for offset in (4, 6, 7):
            candidate = bytearray(self.trade); candidate[offset] ^= 1
            with self.subTest(offset=offset), self.assertRaisesRegex(ValueError, 'approved ROM fingerprint'):
                compare_roms(self.base, candidate, self.original, self.approved)

    def test_modified_baseline_and_resized_roms_are_rejected(self):
        for original, candidate in ((self.trade, self.trade), (self.base[:-1], self.trade),
                                     (self.base, self.trade+b'!'), (self.base, self.trade[:-1])):
            with self.subTest(original=original, candidate=candidate), self.assertRaisesRegex(ValueError, 'ROM'):
                compare_roms(original, candidate, self.original, self.approved)

    def test_corpus_uses_reviewed_policy_instead_of_config_or_sidecar_claims(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'base.gba').write_bytes(self.base)
            (root/'trade.gba').write_bytes(self.trade)
            base_config = {**self.original, 'id': 'firered-rev1', 'path': str(root/'base.gba')}
            trade_config = {**self.approved, 'id': 'firered-rev1-peer-trade-v2', 'path': str(root/'trade.gba')}
            config = {'games': {'firered': {'cartridge': base_config, 'nativeRadio': {'cartridge': trade_config}}}}
            corpus = root/'corpus.json'
            corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1', 'cases': [
                {'id': 'stock', 'config': 'config.json', 'nativeRadio': False},
                {'id': 'trade', 'config': 'config.json', 'nativeRadio': True}]}))
            policies = {'firered-rev1': self.original, 'firered-rev1-peer-trade-v2': self.approved}
            with patch('pokemon_suite.rom_integrity.FIRERED_ROMS', policies):
                (root/'config.json').write_text(json.dumps(config))
                receipt = verify_corpus_roms(corpus)
                self.assertEqual([c['changedBytes'] for c in receipt['cases']], [0, 3])
                self.assertEqual([c['profile'] for c in receipt['cases']], ['firered-rev1', 'firered-rev1-peer-trade-v2'])
                changed = bytearray(self.trade); changed[6] ^= 1
                (root/'trade.gba').write_bytes(changed)
                forged = {**trade_config, **identity(changed, [(0, 16)])}
                config['games']['firered']['nativeRadio']['cartridge'] = forged
                (root/'config.json').write_text(json.dumps(config))
                (root/'trade.manifest.json').write_text(json.dumps(forged))
                with self.assertRaisesRegex(ValueError, 'approved ROM fingerprint'):
                    verify_corpus_roms(corpus)

    def test_a_firered_partner_owner_must_run_the_same_reviewed_cartridges_as_its_case(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'base.gba').write_bytes(self.base); (root/'trade.gba').write_bytes(self.trade)
            base_config = {**self.original, 'id': 'firered-rev1', 'path': str(root/'base.gba')}
            trade_config = {**self.approved, 'id': 'firered-rev1-peer-trade-v2', 'path': str(root/'trade.gba')}
            main = {'cartridge': base_config, 'nativeRadio': {'cartridge': trade_config}}
            partner = {'title': 'firered', 'role': 'partner', 'cartridge': dict(base_config), 'nativeRadio': {'cartridge': dict(trade_config)}}
            corpus = root/'corpus.json'
            corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1', 'cases': [
                {'id': 'pair', 'config': 'config.json', 'nativeRadio': True, 'partnerOwner': 'firered-partner'}]}))
            with patch('pokemon_suite.rom_integrity.FIRERED_ROMS', {'firered-rev1': self.original, 'firered-rev1-peer-trade-v2': self.approved}):
                (root/'config.json').write_text(json.dumps({'games': {'firered': main, 'firered-partner': partner}}))
                receipt = verify_corpus_roms(corpus)
                self.assertEqual(receipt['cases'][0]['partner'], {'game': 'firered', 'owner': 'firered-partner',
                    'profile': 'firered-rev1-peer-trade-v2', 'romSha256': self.approved['sha256']})
                # A partner owner cannot bring its own (unreviewed) cartridge or skip being a declared partner.
                (root/'other.gba').write_bytes(self.base)
                for change in (lambda c: c['nativeRadio']['cartridge'].update(path=str(root/'other.gba')),
                               lambda c: c['cartridge'].update(sha1='0'*40),
                               lambda c: c.pop('role'),
                               lambda c: c.update(title='emerald')):
                    broken = json.loads(json.dumps(partner)); change(broken)
                    (root/'config.json').write_text(json.dumps({'games': {'firered': main, 'firered-partner': broken}}))
                    with self.subTest(partner=broken), self.assertRaisesRegex(ValueError, 'partner'):
                        verify_corpus_roms(corpus)

    def test_unknown_profiles_and_other_games_are_not_implicitly_approved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); corpus = root/'corpus.json'
            for case in ({'id': 'unknown', 'game': 'emerald', 'config': 'config.json', 'nativeRadio': False},
                         {'id': 'unknown', 'config': 'config.json', 'nativeRadio': 'false'}):
                corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1', 'cases': [case]}))
                with self.subTest(case=case), self.assertRaisesRegex(ValueError, 'ROM'):
                    verify_corpus_roms(corpus)
            (root/'config.json').write_text(json.dumps({'games': {'firered': {'cartridge': {'id': 'custom'}}}}))
            case['nativeRadio'] = False
            corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1', 'cases': [case]}))
            with self.assertRaisesRegex(ValueError, 'ROM profile'):
                verify_corpus_roms(corpus)

    def test_a_change_after_replay_cannot_leave_a_passing_gate_report(self):
        spec = importlib.util.spec_from_file_location('verify_bot', Path(__file__).resolve().parents[1]/'scripts/verify-bot.py')
        runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
        for mutation in ('rom', 'config', 'receipt'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                (root/'base.gba').write_bytes(self.base); (root/'trade.gba').write_bytes(self.trade)
                config = {'games': {'firered': {
                    'cartridge': {**self.original, 'id': 'firered-rev1', 'path': str(root/'base.gba')},
                    'nativeRadio': {'cartridge': {**self.approved, 'id': 'firered-rev1-peer-trade-v2', 'path': str(root/'trade.gba')}}}}}
                (root/'config.json').write_text(json.dumps(config))
                corpus = root/'corpus.json'
                corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1', 'cases': [
                    {'id': 'test', 'config': 'config.json', 'nativeRadio': True}]}))
                output = root/'verification'

                def finished_suite(identifier, command, cwd, destination):
                    # Substitute only the expensive emulator/browser processes;
                    # the verifier, files and final release report remain real.
                    if identifier == 'native-replays':
                        if mutation == 'rom': (root/'trade.gba').write_bytes(self.base)
                        elif mutation == 'config':
                            with (root/'config.json').open('a') as stream: stream.write(' ')
                        else:
                            with (output/'rom-integrity.json').open('a') as stream: stream.write(' ')
                    return {'id': identifier, 'tests': 1, 'passed': 1, 'failed': 0, 'skipped': 0}

                files = {'engine/firered/test-support/native-regressions.json': b'{"required":["test"]}'}
                with patch('pokemon_suite.rom_integrity.FIRERED_ROMS', {
                        'firered-rev1': self.original, 'firered-rev1-peer-trade-v2': self.approved}), \
                     patch.object(runner, 'reviewed', return_value=files), \
                     patch.object(runner, 'run_check', side_effect=finished_suite):
                    with self.assertRaisesRegex(ValueError, 'ROM'):
                        runner.verify(root, corpus, output)
                report = json.loads((output/'report.json').read_text())
                self.assertEqual(report['status'], 'failed')
                check = next(c for c in report['checks'] if c['id'] == 'rom-integrity')
                self.assertEqual((check['passed'], check['failed']), (0, 1))
