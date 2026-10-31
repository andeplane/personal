import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch
from sonos_audio import SonosAudio, audio_starts, play_timeline


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.connect_patch = patch('sonos_audio._can_connect', return_value=True)
        self.connect_patch.start()
        self.addCleanup(self.connect_patch.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'sonos.json'
        self.path.write_text(json.dumps({'host': 'speaker.local', 'uid': 'selected', 'volume': 10,
                                        'url_base': 'https://example.com/audio/'}))
        self.audio = SonosAudio(self.path)
        self.speaker = Mock()
        self.speaker.uid = 'selected'
        self.speaker.group.members = {self.speaker}
        self.speaker.volume = 22
        self.speaker.get_current_transport_info.return_value = {'current_transport_state': 'STOPPED'}
        self.speaker.get_current_track_info.return_value = {'uri': ''}
        self.audio.speaker = self.speaker

    def tearDown(self):
        self.temp.cleanup()

    def test_only_selected_speaker_and_prepared_clip_are_used(self):
        self.audio._play('/private/close-crack.wav')
        self.speaker.play_uri.assert_called_once_with('https://example.com/audio/close-crack.wav', title='Halloween thunder')
        self.assertEqual(self.speaker.volume, 10)
        for path in ('other.wav', '../secret.json'):
            with self.assertRaises(ValueError):self.audio._play(path)

    def test_explicit_volume_50_is_supported(self):
        self.audio.config['volume'] = 50
        self.audio._play('close-crack.wav')
        self.assertEqual(self.speaker.volume, 50)
        config = json.loads(self.path.read_text())
        config['volume'] = 50
        self.path.write_text(json.dumps(config))
        self.assertEqual(SonosAudio(self.path).config['volume'], 50)

    def test_regrouped_or_wrong_speaker_never_plays(self):
        self.speaker.group.members = {self.speaker, Mock()}
        with self.assertRaises(ValueError):self.audio._play('close-crack.wav')
        self.speaker.group.members = {self.speaker}
        self.speaker.uid = 'someone-else'
        with self.assertRaises(ValueError):self.audio._play('close-crack.wav')
        self.speaker.play_uri.assert_not_called()

    def test_other_music_is_preserved(self):
        self.speaker.get_current_transport_info.return_value = {'current_transport_state': 'PLAYING'}
        self.speaker.get_current_track_info.return_value = {'uri': 'music://other'}
        with self.assertRaises(ValueError):self.audio._play('close-crack.wav')
        self.speaker.play_uri.assert_not_called()
        self.assertEqual(self.speaker.volume, 22)

    def test_sleeping_speaker_is_skipped_before_description_request(self):
        self.audio.speaker = None
        candidate = Mock()
        with patch('sonos_audio._can_connect', return_value=False), \
             patch('sonos_audio.SoCo', return_value=candidate), \
             patch('sonos_audio.discover', return_value=[candidate]) as discovery:
            with self.assertRaises(ConnectionError):
                self.audio._resolve()
        discovery.assert_called_once_with(timeout=2)
        candidate.play_uri.assert_not_called()

    def test_cleanup_stops_our_clip_and_restores_volume(self):
        self.audio._play('close-crack.wav')
        self.speaker.get_current_transport_info.return_value = {'current_transport_state': 'PLAYING'}
        self.speaker.get_current_track_info.return_value = {'uri': self.audio.last_uri}
        self.audio._close()
        self.speaker.stop.assert_called_once()
        self.assertEqual(self.speaker.volume, 22)
        self.assertIsNone(self.audio.original_volume)

    def test_thunder_boost_is_temporary_and_voice_setting_is_preserved(self):
        self.audio.config['volume'] = 54
        self.audio._play('close-crack.wav')
        self.speaker.get_current_track_info.return_value = {'uri': self.audio.last_uri}
        self.audio._scene_volume(85)
        self.assertEqual(self.speaker.volume, 85)
        self.assertEqual(self.audio.config['volume'], 54)
        self.audio._close()
        self.assertEqual(self.speaker.volume, 22)

    def test_scene_volume_never_changes_other_music(self):
        self.audio._play('close-crack.wav')
        self.speaker.get_current_track_info.return_value = {'uri': 'music://someone-else'}
        self.audio._scene_volume(85)
        self.assertEqual(self.speaker.volume, 10)

    def test_cleanup_leaves_new_music_and_manual_volume_alone(self):
        self.audio._play('close-crack.wav')
        self.speaker.get_current_track_info.return_value = {'uri': 'music://new'}
        self.speaker.volume = 18
        self.audio._close()
        self.speaker.stop.assert_not_called()
        self.assertEqual(self.speaker.volume, 18)


class TimingTests(unittest.IsolatedAsyncioTestCase):
    async def test_commands_are_sent_ahead_on_absolute_sequence_timeline(self):
        plan = [('normal', 2), ('dark', 0.5), ('lightning', 4), ('steady', 20), ('lightning', 4)]
        self.assertEqual(list(audio_starts(plan)), [(2, 2.5), (4, 26.5)])
        now = 100.0
        played = []
        async def sleep(delay):
            nonlocal now
            now += delay
        async def play(path):
            played.append((path, now))
        with patch('sonos_audio.asyncio.sleep', side_effect=sleep):
            await play_timeline(plan, {2:'a.wav', 4:'b.wav'}, 100, 0.35, play, lambda:now)
        self.assertEqual([p for p,_ in played], ['a.wav', 'b.wav'])
        self.assertAlmostEqual(played[0][1], 102.15)
        self.assertAlmostEqual(played[1][1], 126.15)

    async def test_invalid_lead_never_plays(self):
        play = AsyncMock()
        with self.assertRaises(ValueError):
            await play_timeline([], {}, 0, 3, play, lambda:0)
        play.assert_not_called()
