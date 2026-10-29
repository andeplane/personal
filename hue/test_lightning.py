import unittest
from unittest.mock import AsyncMock, Mock
from lightning import Controller, MotionGate, intensity


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
        gate.update(False, 2)
        self.assertFalse(gate.update(True, 10))
        self.assertFalse(gate.update(True, 40))
        gate.update(False, 41)
        self.assertTrue(gate.update(True, 42))

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
