import asyncio
import unittest
from unittest.mock import AsyncMock

from lightning import Controller
from control_actions import dispatch


class IdleGlowTests(unittest.IsolatedAsyncioTestCase):
    def controller(self):
        c=Controller({'host':'bridge.local','username':'test'},
                     {'lights':['rgb','white','mask'],'idle_glow':{
                         'rgb':{'on':True,'bri':89,'xy':[.50,.42]},
                         'white':{'on':True,'bri':89,'ct':454}}})
        c.write_lights=AsyncMock()
        return c

    async def test_idle_baseline_is_warm_at_35_percent_and_mask_is_off(self):
        c=self.controller();await c.idle_lights()
        states=c.write_lights.await_args.args[0]
        self.assertEqual(states['rgb']['bri'],89);self.assertEqual(states['white']['bri'],89)
        self.assertFalse(states['mask']['on']);self.assertTrue(c.health['idle_glow'])

    async def test_stop_keeps_dark_until_an_explicit_reenable(self):
        c=self.controller();await dispatch(c,{'action':'stop'});await c.control_task
        self.assertFalse(c.idle_glow_enabled)
        await c.idle_lights()
        self.assertTrue(all(not s['on'] for s in c.write_lights.await_args.args[0].values()))
        await dispatch(c,{'action':'arm','enabled':True});await c.control_task
        self.assertTrue(c.motion_armed);self.assertTrue(c.idle_glow_enabled)
        self.assertEqual(c.write_lights.await_args.args[0]['white']['bri'],89)

    async def test_pausing_motion_preserves_the_glow(self):
        c=self.controller();await dispatch(c,{'action':'arm','enabled':False});await c.control_task
        self.assertFalse(c.motion_armed);self.assertTrue(c.idle_glow_enabled)
        self.assertEqual(c.write_lights.await_args.args[0]['rgb']['bri'],89)
