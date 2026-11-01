import asyncio
import unittest
from unittest.mock import AsyncMock,Mock
from lightning import Controller


class PersistentControllerTests(unittest.IsolatedAsyncioTestCase):
    def controller(self):
        c=Controller({'host':'bridge.local','username':'test','clientkey':'test'},
            {'group':'7','lights':['4','5'],'area':'area','channels':[0,1],
             'persistent_stream':True,'stream_warmup_seconds':0})
        c.bridge=Mock();c.bridge.request.return_value={'lights':['4','5']}
        c.streamer=Mock(is_connected=False)
        c.streamer.connect.side_effect=lambda *args:setattr(c.streamer,'is_connected',True)
        c.streamer.disconnect.side_effect=lambda:setattr(c.streamer,'is_connected',False)
        c.session.streamer=c.streamer
        c.dark=AsyncMock();c.refresh_host=AsyncMock()
        c.test_active=False;c.test_owner={'rid':'ours','rtype':'auth_v1'}
        async def request(method,path,body=None):
            if method=='PUT':
                c.test_active=body['action']=='start';return []
            return [{'id':'area','status':'active' if c.test_active else 'inactive',
                     'active_streamer':c.test_owner,'channels':[{'channel_id':0},{'channel_id':1}]}]
        c.request=AsyncMock(side_effect=request)
        return c

    async def test_successive_effects_and_idle_share_ready_connection(self):
        c=self.controller()
        await c.session.ensure()
        pump=asyncio.create_task(c.session.loop())
        try:
            for _ in range(2):
                await c.effect([('normal',.04)],sound=False)
                self.assertTrue(c.session.ready)
                await asyncio.sleep(.05)
            c.streamer.connect.assert_called_once()
            c.streamer.disconnect.assert_not_called()
            c.dark.assert_not_awaited()
            self.assertTrue(any(all(command.red==command.green==command.blue==0 for command in call.args[0])
                                for call in c.streamer.send_colors.call_args_list))
        finally:
            pump.cancel()
            with self.assertRaises(asyncio.CancelledError):await pump
        c.dark.assert_awaited_once()
        c.streamer.disconnect.assert_called_once()

    async def test_changed_owner_is_not_stopped_or_darkened_during_cleanup(self):
        c=self.controller();await c.session.ensure()
        c.test_owner={'rid':'other','rtype':'auth_v1'}
        c.request.reset_mock()
        await c.session.stop()
        self.assertFalse(any(call.args[0]=='PUT' for call in c.request.await_args_list))
        c.dark.assert_not_awaited()
        c.streamer.disconnect.assert_called_once()

    async def test_explicit_stop_releases_stream_and_pauses_motion(self):
        c=self.controller();await c.session.ensure()
        result=await c.control({'action':'stop'})
        await c.control_task
        self.assertFalse(result['motion_armed'])
        self.assertFalse(c.session.ready)
        self.assertFalse(c.test_active)
        self.assertTrue(c.dark.await_count>=1)

    async def test_control_canceling_preparation_does_not_cancel_listener(self):
        c=self.controller();c.settings['motion']='sensor'
        c.http=Mock();c.http.get.side_effect=OSError('offline events')
        def ensure():
            c.motion_armed=False
            raise asyncio.CancelledError
        c.session.ensure=AsyncMock(side_effect=ensure)
        async def hold():await asyncio.Future()
        c.session.loop=hold
        c.request=AsyncMock(return_value=[{'motion':{'motion':False}}])
        listener=asyncio.create_task(c.listen())
        try:
            await asyncio.sleep(.1)
            self.assertFalse(listener.done())
            c.session.ensure.assert_awaited_once()
        finally:
            listener.cancel()
            with self.assertRaises(asyncio.CancelledError):await listener
