import asyncio
import threading
import unittest
from unittest.mock import AsyncMock, Mock
from warm_session import WarmSession


class WarmSessionTests(unittest.IsolatedAsyncioTestCase):
    def session(self, **kwargs):
        streamer = Mock(is_connected=False)
        def connect():streamer.is_connected = True
        def disconnect():streamer.is_connected = False
        streamer.disconnect.side_effect = disconnect
        session = WarmSession(streamer, AsyncMock(return_value=True), AsyncMock(),
                              Mock(side_effect=connect), lambda: ['black'],
                              warmup=kwargs.pop('warmup', 0), **kwargs)
        return session

    async def test_effects_reuse_one_connection_until_stop(self):
        session = self.session()
        for _ in range(2):
            self.assertTrue(await session.ensure())
            self.assertTrue(session.ready)
        session.connect.assert_called_once()
        session.acquire.assert_awaited_once()
        await session.stop()
        self.assertFalse(session.ready)
        self.assertFalse(session.owned)
        session.streamer.disconnect.assert_called_once()
        session.release.assert_awaited_once()
        await session.stop()
        session.release.assert_awaited_once()

    async def test_another_owner_is_not_connected_or_released(self):
        session = self.session()
        session.acquire.return_value = False
        self.assertFalse(await session.ensure())
        self.assertFalse(session.ready)
        session.connect.assert_not_called()
        await session.stop()
        session.release.assert_not_awaited()
        session.streamer.disconnect.assert_not_called()

    async def test_failed_connection_cleans_up_and_can_retry(self):
        session = self.session()
        session.connect.side_effect = OSError('network unavailable')
        with self.assertRaises(OSError):await session.ensure()
        self.assertFalse(session.ready)
        session.release.assert_awaited_once()
        session.streamer.disconnect.assert_called_once()
        session.connect.side_effect = lambda:setattr(session.streamer, 'is_connected', True)
        self.assertTrue(await session.ensure())
        await session.stop()

    async def test_cancelled_connect_is_drained_before_disconnect(self):
        session = self.session()
        entered, finish = threading.Event(), threading.Event()
        ordering = []
        def connect():
            entered.set()
            finish.wait(2)
            session.streamer.is_connected = True
            ordering.append('connected')
        def disconnect():
            ordering.append('disconnected')
            session.streamer.is_connected = False
        session.connect.side_effect = connect
        session.streamer.disconnect.side_effect = disconnect
        task = asyncio.create_task(session.ensure())
        self.assertTrue(await asyncio.to_thread(entered.wait, 1))
        task.cancel()
        await asyncio.sleep(.01)
        self.assertFalse(task.done())
        session.streamer.disconnect.assert_not_called()
        finish.set()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertEqual(ordering, ['connected', 'disconnected'])
        self.assertFalse(session.streamer.is_connected)
        session.release.assert_awaited_once()

    async def test_stop_interrupts_warmup_and_releases(self):
        session = self.session(warmup=1)
        prepare = asyncio.create_task(session.ensure())
        for _ in range(100):
            if session.streamer.send_colors.called:break
            await asyncio.sleep(.002)
        self.assertTrue(session.streamer.send_colors.called)
        await asyncio.wait_for(session.stop(), .5)
        with self.assertRaises(asyncio.CancelledError):await prepare
        self.assertFalse(session.ready)
        session.release.assert_awaited_once()

    async def test_idle_pumps_black_but_busy_effect_is_not_overwritten(self):
        busy = False
        session = self.session(busy=lambda:busy, verify=AsyncMock(), idle_hz=100)
        await session.ensure()
        loop = asyncio.create_task(session.loop())
        await asyncio.sleep(.025)
        self.assertGreaterEqual(session.streamer.send_colors.call_count, 2)
        self.assertTrue(all(call.args == (['black'],) for call in session.streamer.send_colors.call_args_list))
        busy = True
        before = session.streamer.send_colors.call_count
        await asyncio.sleep(.025)
        self.assertEqual(session.streamer.send_colors.call_count, before)
        loop.cancel()
        with self.assertRaises(asyncio.CancelledError):await loop
        self.assertFalse(session.ready)
        session.release.assert_awaited_once()

    async def test_changed_owner_verification_releases_and_stops_pumping(self):
        verify = AsyncMock()
        session = self.session(verify=verify, idle_hz=100)
        await session.ensure()
        verify.side_effect = ConnectionError('owner changed')
        loop = asyncio.create_task(session.loop())
        for _ in range(100):
            if session.last_error:break
            await asyncio.sleep(.002)
        self.assertIsInstance(session.last_error, ConnectionError)
        self.assertFalse(session.ready)
        self.assertFalse(session.owned)
        session.streamer.send_colors.assert_not_called()
        session.release.assert_awaited_once()
        loop.cancel()
        with self.assertRaises(asyncio.CancelledError):await loop
        session.release.assert_awaited_once()

    async def test_cancelled_area_acquisition_still_releases_a_late_success(self):
        session = self.session()
        entered, finish = asyncio.Event(), asyncio.Event()
        async def acquire():
            entered.set()
            await finish.wait()
            return True
        session.acquire = AsyncMock(side_effect=acquire)
        task = asyncio.create_task(session.ensure())
        await entered.wait()
        task.cancel()
        await asyncio.sleep(.001)
        self.assertFalse(task.done())
        finish.set()
        with self.assertRaises(asyncio.CancelledError):await task
        session.connect.assert_not_called()
        session.release.assert_awaited_once()
        self.assertFalse(session.owned)
