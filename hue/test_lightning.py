import unittest
import random
from unittest.mock import AsyncMock, Mock, patch
from lightning import (ANCHOR, Controller, MotionGate, STEADY, color_at, frame_at,
                       intensity, lightning_patterns, sequence)


class CleanupTests(unittest.IsolatedAsyncioTestCase):
    def controller(self):
        c = Controller({'host': 'bridge.local', 'username': 'test', 'clientkey': 'test'},
                       {'group': '7', 'lights': ['4', '5'], 'area': 'area', 'channels': [0, 1]})
        c.bridge = Mock()
        c.bridge.request.return_value = {'lights': ['4', '5']}
        c.streamer = Mock()
        c.dark = AsyncMock()
        return c

    async def test_failed_handshake_releases_area_and_turns_off(self):
        c = self.controller()
        c.request = AsyncMock(side_effect=[
            [{'id': 'area', 'status': 'inactive', 'channels': [{'channel_id': 0}, {'channel_id': 1}]}],
            [], []])
        c.streamer.connect.side_effect = OSError('handshake failed')
        with self.assertRaises(OSError):
            await c.effect()
        c.dark.assert_awaited_once()
        self.assertEqual(c.request.await_args_list[-1].args[-1], {'action': 'stop'})
        self.assertFalse(c.busy)

    async def test_another_active_stream_is_left_alone(self):
        c = self.controller()
        c.request = AsyncMock(return_value=[{'id': 'other', 'status': 'active'}])
        await c.effect()
        c.streamer.connect.assert_not_called()
        c.dark.assert_not_awaited()

    async def test_changed_membership_cannot_control_new_lights(self):
        c = self.controller()
        c.bridge.request.return_value = {'lights': ['4', '3']}
        c.request = AsyncMock()
        with self.assertRaises(Exception):
            await c.effect()
        c.request.assert_not_awaited()
        c.dark.assert_not_awaited()

    async def test_complete_storm_streams_steady_and_dark_then_cleans_up(self):
        c = self.controller()
        c.request = AsyncMock(side_effect=[
            [{'id': 'area', 'status': 'inactive', 'channels': [{'channel_id': 0}, {'channel_id': 1}]}],
            [], []])
        plan = sequence(random.Random(1))
        patterns = lightning_patterns(plan, [0, 1], random.Random(2))
        strike = 2.5 + patterns[2][1][0][0] + 0.01
        ticks = iter([0, 0, 2.1, strike, 6.1, 8, 20, 45, 120, 127])
        with patch('lightning.CLOCK', side_effect=lambda: next(ticks, 400)), \
                patch('lightning.sequence', return_value=plan), \
                patch('lightning.lightning_patterns', return_value=patterns), \
                patch('lightning.asyncio.sleep', new=AsyncMock()):
            await c.effect()
        frames = [call.args[0] for call in c.streamer.send_colors.call_args_list]
        self.assertTrue(any(f[1].red == 0 for f in frames))
        self.assertEqual((frames[0][0].red, frames[0][0].green, frames[0][0].blue), STEADY)
        self.assertTrue(any(f[1].red > STEADY[0] for f in frames))
        self.assertTrue(all(len(f) == 2 for f in frames))
        c.dark.assert_awaited_once()
        self.assertFalse(c.busy)


class LightningTests(unittest.TestCase):
    def test_white_flash_has_full_power_plateau_and_background_is_yellow(self):
        self.assertEqual(intensity(0.16, [(0.15, 0.35, 1)]), 1)
        self.assertEqual(intensity(0.25, [(0.15, 0.35, 1)]), 1)
        self.assertGreater(STEADY[0], STEADY[1])
        self.assertGreater(STEADY[1], STEADY[2])
        self.assertGreater(ANCHOR[0], ANCHOR[1])
        self.assertGreater(ANCHOR[1], ANCHOR[2])
        plan = sequence(random.Random(1))
        patterns = lightning_patterns(plan, [0, 1], random.Random(1))
        colors = [frame_at(2.5+t/50, plan, patterns, [0, 1])[1] for t in range(200)]
        self.assertIn((65535, 65535, 65535), colors)
        self.assertIn((0, 0, 0), colors)

    def test_no_extra_cooldown_after_sequence_finishes(self):
        gate = MotionGate()
        gate.update(False, 0)
        self.assertTrue(gate.update(True, 1))
        gate.finish(127.5)
        gate.update(False, 127.6)
        self.assertTrue(gate.update(True, 127.7))

    def test_opening_and_anchor_during_two_minute_phase(self):
        plan = sequence(random.Random(1))
        channels = [0, 1, 2]
        patterns = lightning_patterns(plan, channels, random.Random(2))
        self.assertEqual(frame_at(0, plan, patterns, channels), {c: STEADY for c in channels})
        self.assertEqual(frame_at(1.99, plan, patterns, channels), {c: STEADY for c in channels})
        self.assertEqual(frame_at(2, plan, patterns, channels), {c: (0, 0, 0) for c in channels})
        self.assertEqual(frame_at(2.49, plan, patterns, channels), {c: (0, 0, 0) for c in channels})
        opening = [frame_at(2.5 + tick / 50, plan, patterns, channels) for tick in range(200)]
        self.assertTrue(any(f[0] == (0, 0, 0) for f in opening))
        self.assertTrue(any(f[0][0] > STEADY[0] for f in opening))
        independent = shared = False
        for tick in range(6000):
            frame = frame_at(6.5 + tick / 50, plan, patterns, channels)
            self.assertEqual(frame[0], ANCHOR)
            independent |= frame[1] != frame[2]
            shared |= frame[1] == frame[2] and frame[1][0] > 0
        self.assertTrue(independent)
        self.assertTrue(shared)
        self.assertEqual(frame_at(6.5, plan, patterns, channels), {0: ANCHOR, 1: (0, 0, 0), 2: (0, 0, 0)})
        self.assertIsNone(frame_at(126.5, plan, patterns, channels))

    def test_random_strikes_fit_each_burst_and_change_between_bursts(self):
        plan = sequence(random.Random(1))
        for seed in range(50):
            patterns = lightning_patterns(plan, [0, 1, 2], random.Random(seed))
            self.assertNotEqual(patterns[2][1], patterns[4][1])
            for bulbs in patterns.values():
                for strikes in bulbs.values():
                    self.assertTrue(4 <= len(strikes) <= 8)
                    for start, end, peak in strikes:
                        self.assertTrue(0 <= start < end <= 4)
                        self.assertEqual(peak, 1)

    def test_startup_presence_does_not_trigger(self):
        gate = MotionGate(cooldown=30)
        self.assertFalse(gate.update(True, 100))
        self.assertFalse(gate.update(True, 101))
        self.assertFalse(gate.update(False, 102))
        self.assertTrue(gate.update(True, 103))

    def test_cooldown_does_not_queue_stale_motion(self):
        gate = MotionGate(cooldown=30)
        gate.update(False, 0)
        self.assertTrue(gate.update(True, 1))
        gate.finish(5)
        gate.update(False, 2)
        self.assertFalse(gate.update(True, 10))
        self.assertFalse(gate.update(True, 40))
        gate.update(False, 41)
        self.assertTrue(gate.update(True, 42))

    def test_motion_does_not_restart_or_extend_active_storm(self):
        gate = MotionGate(cooldown=30)
        gate.update(False, 0)
        self.assertTrue(gate.update(True, 1))
        for now in (30, 100, 300):
            gate.update(False, now)
            self.assertFalse(gate.update(True, now + 1))
        gate.finish(319)
        gate.update(False, 320)
        self.assertFalse(gate.update(True, 348))
        self.assertFalse(gate.update(True, 350))
        gate.update(False, 351)
        self.assertTrue(gate.update(True, 352))

    def test_tiny_fade_values_cannot_reexpand_to_white_in_sdk(self):
        self.assertEqual(color_at(.199999, [('lightning', 1)], {0:{0:[(0,.2,1)]}}, 0), (0,0,0))

    def test_every_automatic_thunder_tail_can_finish_before_lights_off(self):
        for seed in range(100):
            plan = sequence(random.Random(seed))
            elapsed = 0
            total = sum(duration for _, duration in plan)
            for mode, duration in plan:
                if mode == 'lightning':
                    self.assertGreaterEqual(total-elapsed, 11.5)
                elapsed += duration

    def test_storm_timing_and_random_intervals(self):
        for seed in range(100):
            plan = sequence(random.Random(seed))
            self.assertEqual(plan[0], ('normal', 2))
            self.assertEqual(plan[1], ('dark', 0.5))
            self.assertEqual(plan[2], ('lightning', 4))
            self.assertAlmostEqual(sum(d for _, d in plan[3:]), 120)
            for n, (mode, duration) in enumerate(plan[3:], start=3):
                if mode == 'lightning':
                    self.assertEqual(duration, 4)
                    self.assertEqual(plan[n-1][0], 'steady')
                    self.assertTrue(8 <= plan[n-1][1] <= 15)
            self.assertEqual(color_at(0.1, plan), STEADY)
            self.assertIsNone(color_at(sum(d for _, d in plan) + 0.01, plan))

    def test_brief_strikes_with_dark_gaps(self):
        self.assertEqual(intensity(0), 0)
        self.assertGreater(intensity(0.16), 0)
        self.assertEqual(intensity(0.5), 0)
        self.assertGreater(intensity(1.3), 0)
        self.assertEqual(intensity(2), 0)
        self.assertGreater(intensity(2.9), 0)
        self.assertEqual(intensity(4), 0)


if __name__ == '__main__':
    unittest.main()
