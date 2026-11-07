"""Integrity and audition-readiness checks for the added laughter recordings."""
import array
import hashlib
import json
from pathlib import Path
import unittest
import wave


ROOT = Path(__file__).parent / 'sounds'
LAUGHS = {
    'evil-laugh-deep': ('ckvoiceover', '401332'),
    'villain-cackle': ('el_boss', '650618'),
    'demonic-chuckle': ('scorpion67890', '169317'),
    'sinister-laugh': ('pepv', '212579'),
    'cartoon-villain-laugh': ('riippumattog', '704363'),
    'haunted-laugh': ('tchild', '319766'),
}


class EvilLaughterTests(unittest.TestCase):
    def test_six_distinct_licensed_laughs_and_existing_witch_are_available(self):
        clips = {clip['id']: clip for clip in json.loads((ROOT/'catalog.json').read_text())['clips']}
        self.assertIn('witch-laugh', clips)
        self.assertFalse({'human-scream', 'horror-scream'}.intersection(clips))
        self.assertEqual(len({clips[ident]['sha256'] for ident in LAUGHS}), 6)
        for ident, (author, number) in LAUGHS.items():
            with self.subTest(ident=ident):
                clip = clips[ident]
                self.assertEqual(clip['category'], 'Laugh')
                self.assertEqual(clip['source'], f'https://freesound.org/people/{author}/sounds/{number}/')
                self.assertEqual(clip['license'], 'CC0-1.0')
                self.assertEqual(clip['license_url'], 'https://creativecommons.org/publicdomain/zero/1.0/')
                self.assertEqual(clip['source_offset_seconds'], 0)
                self.assertTrue(1 < clip['duration'] < 8)
                self.assertEqual(len(clip['preview_sha256']), 64)
                path = ROOT/clip['file']
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), clip['sha256'])
                with wave.open(str(path)) as wav:
                    self.assertEqual((wav.getnchannels(),wav.getsampwidth(),wav.getframerate()), (1,2,24000))
                    samples = array.array('h', wav.readframes(wav.getnframes()))
                self.assertAlmostEqual(len(samples)/24000, clip['duration'], places=6)
                self.assertTrue(20000 <= max(map(abs,samples)) <= 24000)
