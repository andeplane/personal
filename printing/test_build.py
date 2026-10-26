"""Partial terminal records must not turn selection or live progress into completion."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('print_history_build', Path(__file__).with_name('build.py'))
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)

class PartialOutcomeTests(unittest.TestCase):
    def record(self):
        return {
            'id': 'trial', 'status': 'completed_partial', 'title': 'Trial',
            'project': 'Example', 'printer': 'Example printer', 'jobName': 'Trial',
            'material': 'PLA', 'notes': 'Physical fit remains unverified.',
            'parts': ['body', 'cover'], 'color': '#161616', 'source': {'sha256': None},
            'recordedAt': '2026-10-21T00:00:00Z', 'startedAt': None, 'finishedAt': None,
            'estimatedSeconds': 60, 'actualSeconds': None, 'estimatedGrams': 1,
            'actualGrams': None, 'estimatedMeters': 1,
            'preview': None, 'layout': None, 'snapshots': [],
            'terminalEvidence': {'printerState': 'FINISH'}, 'skippedParts': ['body'],
        }

    def build_record(self, record):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'records').mkdir()
            (root / 'records/trial.json').write_text(json.dumps(record))
            with patch.object(ledger, 'ROOT', root), contextlib.redirect_stdout(io.StringIO()):
                ledger.build()
            return json.loads((root / 'records.json').read_text())[0]

    def test_index_binds_current_renderer_bytes(self):
        folder = Path(__file__).parent
        version = hashlib.sha256((folder / 'printing.js').read_bytes()).hexdigest()[:12]
        self.assertIn('src="printing.js?v=' + version + '"', (folder / 'index.html').read_text())

        self.assertEqual(self.build_record(self.record())['status'], 'completed_partial')

    def test_running_or_paused_skip_selection_is_not_terminal(self):
        for state in ['RUNNING', 'PAUSE']:
            run = self.record()
            run['terminalEvidence']['printerState'] = state
            with self.subTest(state=state), self.assertRaises(AssertionError):
                self.build_record(run)

    def test_skipped_parts_must_be_a_nonempty_proper_inventory_subset(self):
        for skipped in [[], ['unknown'], ['body', 'cover']]:
            run = self.record()
            run['skippedParts'] = skipped
            with self.subTest(skipped=skipped), self.assertRaises(AssertionError):
                self.build_record(run)

    def paused_record(self):
        run = self.record()
        run['status'] = 'paused'
        run.pop('terminalEvidence')
        run.pop('skippedParts')
        run['pauseEvidence'] = {'printerState': 'PAUSE', 'printError': 117473302,
                                'observedAt': '2026-10-25T23:49:06Z'}
        return run

    def test_live_pause_is_preserved_without_inventing_terminal_completion(self):
        result = self.build_record(self.paused_record())
        self.assertEqual(result['status'], 'paused')
        self.assertIsNone(result['finishedAt'])

    def test_paused_status_requires_actual_pause_evidence(self):
        for state in ['RUNNING', 'FINISH', 'FAILED', None]:
            run = self.paused_record()
            run['pauseEvidence']['printerState'] = state
            with self.subTest(state=state), self.assertRaises(AssertionError):
                self.build_record(run)

    def test_pause_cannot_be_given_a_finished_timestamp(self):
        run = self.paused_record()
        run['finishedAt'] = '2026-10-25T23:49:06Z'
        with self.assertRaises(AssertionError):
            self.build_record(run)

    def test_pause_requires_valid_observation_and_numeric_error(self):
        for key, value in [('observedAt', 'unknown'), ('printError', '0700-8016'),
                           ('printError', -1), ('printError', True)]:
            run = self.paused_record()
            run['pauseEvidence'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises((AssertionError, ValueError)):
                self.build_record(run)

if __name__ == '__main__':
    unittest.main()
