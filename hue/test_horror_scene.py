import asyncio
import random
import unittest
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from horror_scene import WHITE, PURPLE, horror_scene, roles, strokes, warm_states, compact_events, prepare_compact_audio, SCENE_SECONDS, aftermath_events, volume_cues
from hue import HueError


class HorrorScheduleTests(unittest.TestCase):
    def test_roles_are_exact_and_mask_uses_ct(self):
        settings = {'lights': ['a', 'b', 'm'], 'scene_roles': {'flashers': ['a', 'b'], 'mask': 'm'}}
        self.assertEqual(roles(settings), (['a', 'b'], 'm'))
        self.assertNotIn('xy', warm_states(settings)['m'])
        for bad in [['a', 'b', 'other'], ['a', 'b'], ['a', 'b', 'm', 'other']]:
            with self.assertRaises(HueError):
                roles({**settings, 'lights': bad})

    def test_independent_colours_and_budget_over_many_schedules(self):
        signatures = set()
        for seed in range(500):
            events = strokes(['a', 'b'], 8, rng=random.Random(seed), finale=True)
            signatures.add(tuple(round(t, 3) for t, _ in events))
            for t, _ in events:
                # Leave one extra slot for mask activation/final darkness.
                self.assertLessEqual(sum(len(s) for u, s in events if t <= u < t + 1), 8)
            for lamp in ['a', 'b']:
                lit = [(t, s[lamp]) for t, s in events if lamp in s and s[lamp]['bri'] == 254]
                self.assertIn(WHITE, [s['xy'] for _, s in lit])
                self.assertIn(PURPLE, [s['xy'] for _, s in lit])
                self.assertTrue(all(s['transitiontime'] == 0 for _, s in lit))
            self.assertNotEqual([t for t, s in events if 'a' in s], [t for t, s in events if 'b' in s])
        self.assertGreater(len(signatures), 490)

    def test_compact_chaos_budget_and_fast_reveal(self):
        for seed in range(500):
            events = compact_events(['a','b'],'m',random.Random(seed))
            self.assertEqual([(t,p) for t,p,_ in events if p], [(0,'storm'),(2.6,'reveal'),(5.5,'storm'),(9.2,'finale')])
            for t,_,_ in events:
                self.assertLessEqual(sum(len(s) for u,_,s in events if t <= u < t+1), 10)
            self.assertTrue(all(t < SCENE_SECONDS for t,_,_ in events))
            peaks = [s for _,_,s in events if any(v.get('bri')==254 and 'xy' in v for v in s.values())]
            self.assertGreaterEqual(len(peaks), 20)

    def test_three_colour_bulbs_get_both_colours_without_exceeding_budget(self):
        lamps=['a','b','c'];settings={'lights':[*lamps,'m'], 'scene_roles':{'flashers':lamps,'mask':'m'}}
        self.assertEqual(roles(settings),(lamps,'m'))
        for seed in range(500):
            events=compact_events(lamps,'m',random.Random(seed))+aftermath_events(lamps,'m',random.Random(seed))
            for t,_,_ in events:
                self.assertLessEqual(sum(len(states) for u,_,states in events if t <= u < t+1),10)
            for lamp in lamps:
                colors=[states[lamp].get('xy') for _,_,states in events
                        if lamp in states and states[lamp].get('bri')==254]
                self.assertIn(WHITE,colors);self.assertIn(PURPLE,colors)
            self.assertTrue(all('xy' not in states['m'] for _,_,states in events if 'm' in states))
            test=strokes(lamps,4,rng=random.Random(seed))
            self.assertEqual({key for _,states in test for key in states},set(lamps))

    def test_aftermath_is_bounded_varied_and_volume_windows_match_voices(self):
        signatures=set()
        for seed in range(500):
            opening=compact_events(['a','b'],'m',random.Random(seed))
            ending=aftermath_events(['a','b'],'m',random.Random(seed))
            events=opening+ending
            self.assertTrue(all(14 <= t < 44 for t,_,_ in ending))
            self.assertEqual([(t,p) for t,p,_ in ending if p],
                             [(14,'aftermath'),(20,'reveal'),(27.5,'storm'),(33,'finale'),(41,'tail')])
            for t,_,_ in events:
                self.assertLessEqual(sum(len(s) for u,_,s in events if t <= u < t+1),10)
            signatures.add(tuple(round(t,3) for t,_,_ in ending))
        self.assertEqual(len(signatures),500)
        self.assertEqual(volume_cues(54),[(0,100),(2.5,70),(5.5,100),(9.1,54),
                                         (14,100),(19.9,70),(27.4,100),(32.9,54),(41,100)])

    def test_compact_audio_has_overlaps_bounded_peaks_and_faded_end(self):
        from sound_library import SoundLibrary, read_pcm, RATE
        from lightning import load_soundtracks
        with tempfile.TemporaryDirectory() as directory:
            root=Path(__file__).parent
            library=SoundLibrary(root/'sounds/catalog.json',directory)
            tracks=load_soundtracks(root/'audio/full/catalog.json')[:2]
            path=prepare_compact_audio(library,tracks,random.Random(5))
            pcm=read_pcm(path)
            self.assertEqual(len(pcm),44*RATE)
            self.assertLessEqual(max(map(abs,pcm)),32700)
            self.assertEqual(pcm[-1],0)
            self.assertEqual(library.files[path.name],path)
            self.assertEqual(prepare_compact_audio(library,tracks,random.Random(5)),path)


class HorrorRuntimeTests(unittest.IsolatedAsyncioTestCase):
    def controller(self):
        c = Mock()
        c.settings = {'lights': ['a', 'b', 'm'], 'group': 'scene',
                      'scene_roles': {'flashers': ['a', 'b'], 'mask': 'm'},
                      'thunder_catalog': 'catalog', 'audio_lead_seconds': .35}
        def request(method, path):
            if path.startswith('/groups/'):
                return {'lights': ['a', 'b', 'm']}
            return {'state': {'reachable': True, 'ct': 300, **({'xy': WHITE} if path[-1] != 'm' else {})}}
        c.bridge.request = Mock(side_effect=request)
        c.request = AsyncMock(return_value=[])
        c.dark = AsyncMock(); c.write_lights = AsyncMock(); c.thunder = AsyncMock()
        c.sonos.close = AsyncMock(); c.sound_override = False
        c.sonos.config = {'volume':54}; c.sonos.last_uri = 'scene.wav'; c.sonos.scene_volume = AsyncMock(); c.health = {}
        c.library.by_id = {'evil-laugh-deep': ({'duration': 6}, Path('laugh.wav')),
                           'jump-scream': ({'duration': 8}, Path('scream.wav'))}
        return c

    async def test_fast_opening_then_thirty_second_aftermath(self):
        c = self.controller(); clock = [0.0]; audio_times = []
        async def sleep(duration): clock[0] += duration
        async def audio(path): audio_times.append((clock[0], path))
        c.thunder.side_effect = audio
        track = {'audio_duration': 11.5, 'audio_file': 'thunder.wav', 'strikes': [(0.18, .32, 1), (1.2, 1.4, 1), (2.8, 3, 1)]}
        with patch('horror_scene.prepare_compact_audio', return_value=Path('scene.wav')), \
             patch('lightning.load_soundtracks', return_value=[track]), \
             patch('horror_scene.time.monotonic', side_effect=lambda: clock[0]), \
             patch('horror_scene.asyncio.sleep', side_effect=sleep):
            await horror_scene(c)
        self.assertEqual([p for _, p in audio_times], ['scene.wav'])
        self.assertGreaterEqual(clock[0], 44)
        self.assertLessEqual(clock[0], 45)
        phases = [call.kwargs['phase'] for call in c.status.call_args_list if 'phase' in call.kwargs]
        self.assertEqual(phases, ['preparing', 'storm', 'reveal', 'storm', 'finale', 'aftermath', 'reveal', 'storm', 'finale', 'tail'])
        self.assertEqual(c.dark.await_count, 2)
        self.assertFalse(c.busy); c.sonos.close.assert_awaited_once()
        self.assertTrue(all(set(call.args[0]) <= {'a', 'b', 'm'} for call in c.write_lights.await_args_list))
        self.assertTrue(all('xy' not in call.args[0]['m'] for call in c.write_lights.await_args_list if 'm' in call.args[0]))

    async def test_quick_lightning_never_lights_mask_or_plays_audio(self):
        c = self.controller()
        with patch('horror_scene.asyncio.sleep', new=AsyncMock()):
            await horror_scene(c, lightning_only=True, sound=False)
        c.thunder.assert_not_awaited()
        self.assertTrue(all('m' not in call.args[0] for call in c.write_lights.await_args_list))

    async def test_cancellation_and_write_failure_clean_up(self):
        for error in [asyncio.CancelledError(), OSError('network')]:
            c = self.controller(); c.write_lights.side_effect = error
            with patch('horror_scene.asyncio.sleep', new=AsyncMock()):
                with self.assertRaises(type(error)):
                    await horror_scene(c, lightning_only=True, sound=False)
            self.assertEqual(c.dark.await_count, 2)
            c.sonos.close.assert_awaited_once(); self.assertFalse(c.busy)

    async def test_other_entertainment_owner_and_changed_group_are_not_touched(self):
        c = self.controller(); c.request.return_value = [{'status': 'active'}]
        self.assertFalse(await horror_scene(c))
        c.dark.assert_not_awaited(); c.write_lights.assert_not_awaited()
        c = self.controller(); c.bridge.request.side_effect = None
        c.bridge.request.return_value = {'lights': ['a', 'b', 'other']}
        with self.assertRaises(HueError): await horror_scene(c)
        c.dark.assert_not_awaited()
