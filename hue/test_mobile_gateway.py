import unittest
from unittest.mock import AsyncMock

from aiohttp.test_utils import TestClient, TestServer

from mobile_gateway import create_app


class MobileGatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.forward=AsyncMock(return_value={'ok':True,'motion_armed':False})
        self.token='test-token-'*4
        self.client=TestClient(TestServer(create_app({'token':self.token,'socket':'/private/test.sock'},self.forward)))
        await self.client.start_server()
        self.headers={'Authorization':'Bearer '+self.token}

    async def asyncTearDown(self):
        await self.client.close()

    async def test_missing_or_wrong_auth_never_reaches_controller(self):
        for headers in ({},{'Authorization':'Bearer wrong'}):
            response=await self.client.post('/control',json={'action':'start'},headers=headers)
            self.assertEqual(response.status,401)
        self.forward.assert_not_awaited()

    async def test_controls_and_log_pagination_are_forwarded(self):
        for command in ({'action':'arm','enabled':True},{'action':'start'},
                        {'action':'stop'},{'action':'library'},{'action':'events','before':123}):
            response=await self.client.post('/control',json=command,headers=self.headers)
            self.assertEqual(response.status,200)
            self.assertTrue((await response.json())['ok'])
            self.forward.assert_awaited_with('/private/test.sock',command)

    async def test_invalid_commands_do_not_mutate_controller(self):
        for command in ({'action':'volume','value':100},{'action':'arm','enabled':'true'},
                        {'action':'events','before':False},{'action':'events','before':-1},['start']):
            response=await self.client.post('/control',json=command,headers=self.headers)
            self.assertEqual(response.status,400)
        self.forward.assert_not_awaited()

    async def test_unavailable_daemon_is_clear_and_retryable(self):
        self.forward.side_effect=ConnectionError('offline')
        response=await self.client.post('/control',json={'action':'status'},headers=self.headers)
        self.assertEqual(response.status,503)
        self.assertFalse((await response.json())['ok'])
