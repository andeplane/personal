import unittest
import random
from unittest.mock import AsyncMock, Mock, patch
from lightning import Controller, MotionGate, STEADY, color_at, intensity, sequence


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
        ticks = iter([0, 0, 0.16, 4.1, 10, 20, 45, 120, 299, 400])
        with patch('lightning.time.monotonic', side_effect=lambda: next(ticks, 400)), \
                patch('lightning.sequence', return_value=plan), \
                patch('lightning.asyncio.sleep', new=AsyncMock()):
            await c.effect()
        frames = [call.args[0] for call in c.streamer.send_colors.call_args_list]
        self.assertTrue(any(f[0].red == 0 for f in frames))
        self.assertTrue(any((f[0].red, f[0].green, f[0].blue) == STEADY for f in frames))
        self.assertTrue(any(f[0].red > STEADY[0] for f in frames))
        self.assertTrue(all(len(f) == 2 for f in frames))
        c.dark.assert_awaited_once()
        self.assertFalse(c.busy)


class LightningTests(unittest.TestCase):
    def test_startup_presence_does_not_trigger(self):
        gate = MotionGate()
        self.assertFalse(gate.update(True, 100))
        self.assertFalse(gate.update(True, 101))
        self.assertFalse(gate.update(False, 102))
        self.assertTrue(gate.update(True, 103))

    def test_cooldown_does_not_queue_stale_motion(self):
        gate = MotionGate()
        gate.update(False, 0)
        self.assertTrue(gate.update(True, 1))
        gate.finish(5)
        gate.update(False, 2)
        self.assertFalse(gate.update(True, 10))
        self.assertFalse(gate.update(True, 40))
        gate.update(False, 41)
        self.assertTrue(gate.update(True, 42))

    def test_motion_does_not_restart_or_extend_active_storm(self):
        gate = MotionGate()
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

    def test_storm_timing_and_random_intervals(self):
        for seed in range(100):
            plan = sequence(random.Random(seed))
            self.assertEqual(plan[0], ('lightning', 4))
            self.assertEqual(plan[2], ('lightning', 4))
            self.assertEqual(plan[1][0], 'steady')
            self.assertTrue(5 <= plan[1][1] <= 10)
            self.assertAlmostEqual(sum(d for _, d in plan[3:]), 300)
            for n, (mode, duration) in enumerate(plan[3:], start=3):
                if mode == 'lightning':
                    self.assertEqual(duration, 4)
                    self.assertEqual(plan[n-1][0], 'steady')
                    self.assertTrue(20 <= plan[n-1][1] <= 40)
            self.assertEqual(color_at(4.1, plan), STEADY)
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
