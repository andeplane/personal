import asyncio
import unittest
from unittest.mock import AsyncMock,Mock,patch
from lightning import Controller


class RestEffectTests(unittest.IsolatedAsyncioTestCase):
    def controller(self):
        c=Controller({'host':'bridge.local','username':'test'},{'render_backend':'rest','group':'7','lights':['4','5'],'channels':[0,1]})
        c.bridge=Mock();c.bridge.request.return_value={'lights':['4','5']}
        c.request=AsyncMock(return_value=[]);c.dark=AsyncMock()
        return c

    async def test_sparse_effect_uses_only_selected_lights_and_cleans_up(self):
        c=self.controller();await c.effect([('normal',.03),('dark',.01)],sound=False)
        puts=[call for call in c.bridge.request.call_args_list if call.args[0]=='PUT']
        self.assertTrue(puts)
        self.assertTrue(all(call.args[1] in ('/lights/4/state','/lights/5/state') for call in puts))
        self.assertTrue(all(call.args[2]['transitiontime']==0 for call in puts))
        self.assertTrue(all(set(call.args[2]) <= {'on','transitiontime'} for call in puts if not call.args[2]['on']))
        self.assertFalse(c.busy);c.dark.assert_awaited_once()
        self.assertTrue(any(call.args[2].get('on') and call.args[2]['xy']==[.50,.42] for call in puts))

    async def test_another_stream_is_left_alone(self):
        c=self.controller();c.request.return_value=[{'status':'active'}]
        self.assertFalse(await c.effect([('normal',.03)],sound=False))
        self.assertFalse(any(call.args[0]=='PUT' for call in c.bridge.request.call_args_list))
        c.dark.assert_not_awaited()

    async def test_ui_phases_advance_even_when_lamps_need_no_network_change(self):
        c=self.controller();c.status=Mock(wraps=c.status)
        plan=[('steady',.01),('steady',.01),('steady',.01),('lightning',.03),('steady',.01)]
        with patch('lightning.lightning_patterns',return_value={3:{0:[],1:[]}}):
            await c.effect(plan,sound=False)
        phases=[call.kwargs['phase'] for call in c.status.call_args_list if 'phase' in call.kwargs]
        self.assertEqual(phases,['preparing','steady','steady','steady','lightning','steady'])
