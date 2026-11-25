import asyncio
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

from hue import HueError
from lightning import Controller, load_soundtracks, recorded_patterns, sequence

CATALOG = Path(__file__).parent / 'audio/catalog.json'


class SoundtrackTests(unittest.TestCase):
    def test_real_clips_have_valid_hashes_duration_and_leading_cues(self):
        catalog = load_soundtracks(CATALOG)
        self.assertEqual(len(catalog), 2)
        for item in catalog:
            self.assertEqual(item['license'], 'CC0-1.0')
            for strike, peak in zip(item['strikes'], item['audio_peak_seconds']):
                self.assertAlmostEqual(peak - strike[0], 0.1)
                self.assertGreater(strike[1], peak)

    def test_every_burst_uses_its_selected_recordings_cues(self):
        catalog = load_soundtracks(CATALOG)
        plan = sequence(random.Random(1))
        patterns, tracks = recorded_patterns(plan, [0, 1, 2], catalog, random.Random(2))
        lookup = {item['audio_file']: item for item in catalog}
        self.assertEqual(set(patterns), {i for i, (mode, _) in enumerate(plan) if mode == 'lightning'})
        for index, bulbs in patterns.items():
            source = lookup[tracks[index]]
            self.assertNotEqual(bulbs[1], bulbs[2])
            for cues in bulbs.values():
                for original in source['strikes']:
                    self.assertLessEqual(min(abs(cue[0]-original[0]) for cue in cues), 0.025001)
                for cue in cues:
                    self.assertTrue(0 <= cue[0] < cue[1] <= 4)
                    self.assertEqual(cue[2], 1)

    def test_catalog_cannot_escape_audio_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'catalog.json'
            p.write_text(json.dumps([{'file': '../outside.wav'}]))
            with self.assertRaises(HueError):
                load_soundtracks(p)


class MutedAudioTests(unittest.IsolatedAsyncioTestCase):
    async def test_prepared_recording_does_not_play_while_muted(self):
        controller = Controller({'host': 'bridge.local', 'username': 'test'}, {'audio_enabled': False})
        with patch('lightning.asyncio.create_subprocess_exec') as player:
            await controller.thunder('prepared.wav')
        player.assert_not_called()


if __name__ == '__main__':
    unittest.main()
