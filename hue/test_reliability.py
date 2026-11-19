import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

from lightning import Controller, MotionGate, StreamDisconnected, motion_sample
import test_lightning


class MotionReportTests(unittest.TestCase):
    def test_report_only_payload_is_a_real_motion_event(self):
        sample = motion_sample({'motion': {'motion_report': {'motion': True, 'changed': '2026-10-31T08:00:00Z'}}})
        self.assertEqual(sample, (True, 1793433600))
        self.assertIsNone(motion_sample({'motion': {'motion_valid': False, 'motion': True}}))

    def test_new_detection_can_trigger_after_finish_without_false_transition(self):
        gate = MotionGate()
        gate.update(False, 0, 100)
        self.assertTrue(gate.update(True, 1, 101))
        self.assertFalse(gate.update(True, 2, 102))
        gate.finish(130)
        self.assertFalse(gate.update(True, 131, 102))
        self.assertTrue(gate.update(True, 132, 103))

    def test_replayed_or_out_of_order_reports_cannot_retrigger(self):
        gate = MotionGate()
        gate.update(False, 0, 100)
        self.assertTrue(gate.update(True, 1, 102))
        gate.finish(130)
        self.assertFalse(gate.update(False, 131, 101))
        self.assertFalse(gate.update(True, 132, 102))
        self.assertTrue(gate.update(True, 133, 103))


class RecoveryTests(unittest.IsolatedAsyncioTestCase):
    def controller(self):
        return test_lightning.CleanupTests().controller()

    async def test_dead_sender_is_failure_and_still_turns_bulbs_off(self):
        c = self.controller()
        c.streamer.is_connected = False
        c.request = AsyncMock(side_effect=[
            [{'id': 'area', 'status': 'inactive', 'channels': [{'channel_id': 0}, {'channel_id': 1}]}], [], []])
        with self.assertRaises(StreamDisconnected):
            await c.effect()
        c.dark.assert_awaited_once()
        c.streamer.send_colors.assert_not_called()

    async def test_bridge_stopping_stream_is_detected(self):
        c = self.controller()
        c.streamer.is_connected = True
        c.request = AsyncMock(return_value=[{'status': 'inactive'}])
        with self.assertRaises(StreamDisconnected):
            await c.verify_stream()

    async def test_one_failed_stream_retries_without_another_motion(self):
        c = self.controller()
        c.refresh_host = AsyncMock()
        c.effect = AsyncMock(side_effect=[StreamDisconnected('lost'), None])
        gate = MotionGate();gate.present=False;gate.update(True, 0)
        with patch('lightning.asyncio.sleep', new=AsyncMock()):
            await c.trigger(gate)
        self.assertEqual(c.effect.await_count, 2)
        self.assertEqual(c.health['state'], 'idle')
        self.assertNotEqual(gate.ready_at, float('inf'))

    async def test_two_failed_streams_do_not_retry_forever(self):
        c = self.controller()
        c.refresh_host = AsyncMock()
        c.effect = AsyncMock(side_effect=StreamDisconnected('lost'))
        gate = MotionGate()
        with patch('lightning.asyncio.sleep', new=AsyncMock()):
            await c.trigger(gate)
        self.assertEqual(c.effect.await_count, 2)
        self.assertEqual(c.health['state'], 'failed')

    async def test_poll_recovers_motion_when_push_stream_is_unavailable(self):
        c = self.controller()
        c.settings['motion'] = 'sensor'
        c.http = Mock()
        c.http.get.side_effect = OSError('event channel disconnected')
        c.refresh_host = AsyncMock()
        c.request = AsyncMock(side_effect=[
            [{'motion': {'motion_report': {'motion': False, 'changed': '2026-10-31T08:00:00Z'}}}],
            [{'motion': {'motion_report': {'motion': True, 'changed': '2026-10-31T08:00:01Z'}}}]])
        started = asyncio.Event()
        async def effect():
            started.set()
        c.effect = AsyncMock(side_effect=effect)
        listener = asyncio.create_task(c.listen())
        try:
            await asyncio.wait_for(started.wait(), 4)
            c.effect.assert_awaited_once()
        finally:
            listener.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await listener
