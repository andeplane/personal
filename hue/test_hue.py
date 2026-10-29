import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import hue


class ControllerTests(unittest.TestCase):
    def bridge(self):
        bridge = Mock(username="private-test-key")
        bridge.request.return_value = {"1": {"state": {"reachable": True, "xy": [0.3, 0.3]}}}
        return bridge

    def test_error_in_http_success_response_is_not_success(self):
        with self.assertRaisesRegex(hue.HueError, "101|link button"):
            hue.check_response([{"error": {"type": 101, "address": "/secret"}}])

    def test_duplicate_light_selection_rejected_before_requests(self):
        bridge = self.bridge()
        with self.assertRaises(hue.HueError):
            hue.configure(bridge, ["1", "1"])
        bridge.request.assert_not_called()

    def test_unknown_light_does_not_create_zone(self):
        bridge = self.bridge()
        with self.assertRaises(hue.HueError):
            hue.configure(bridge, ["2"])
        self.assertEqual(bridge.request.call_args_list, [unittest.mock.call("GET", "/lights")])

    def test_unreachable_light_rejected(self):
        bridge = self.bridge()
        bridge.request.return_value["1"]["state"]["reachable"] = False
        with self.assertRaisesRegex(hue.HueError, "unreachable"):
            hue.configure(bridge, ["1"])

    def test_existing_different_group_is_not_overwritten(self):
        bridge = self.bridge()
        bridge.request.side_effect = [bridge.request.return_value,
                                     {"8": {"name": hue.GROUP, "lights": ["2"]}}]
        with self.assertRaisesRegex(hue.HueError, "different lights"):
            hue.configure(bridge, ["1"])
        self.assertTrue(all(c.args[0] == "GET" for c in bridge.request.call_args_list))

    def test_repeated_configuration_updates_only_owned_scenes(self):
        bridge = self.bridge()
        lights = bridge.request.return_value
        scenes = {str(i): {"name": "HW " + name, "group": "8", "owner": bridge.username}
                  for i, name in enumerate(hue.SCENES, 1)}
        scenes["99"] = {"name": "HW Normal white", "group": "8", "owner": "someone-else"}
        bridge.request.side_effect = [lights, {"8": {"name": hue.GROUP, "lights": ["1"]}},
                                      scenes, [], [], []]
        result = hue.configure(bridge, ["1"])
        self.assertEqual(result["group_id"], "8")
        writes = [c for c in bridge.request.call_args_list if c.args[0] != "GET"]
        self.assertEqual(len(writes), 3)
        self.assertTrue(all(c.args[0] == "PUT" and c.args[1] != "/scenes/99" for c in writes))
        self.assertTrue(all("/lights/" not in c.args[1] for c in writes))

    def test_reveal_attempts_off_for_every_light_after_failure(self):
        bridge = self.bridge()
        def request(method, resource, body=None):
            if method == "GET":
                return {str(i): {"state": {"reachable": True, "xy": [0.3, 0.3]}}
                        for i in (1, 2)}
            if resource == "/lights/1/state" and body["on"]:
                raise hue.HueError("test failure")
            return []
        bridge.request.side_effect = request
        with self.assertRaisesRegex(hue.HueError, "test failure"):
            hue.reveal(bridge, ["1", "2"], 0)
        off_calls = [c for c in bridge.request.call_args_list
                     if len(c.args) == 3 and c.args[2].get("on") is False]
        self.assertEqual([c.args[1] for c in off_calls], ["/lights/1/state", "/lights/2/state"])

    def test_credentials_are_owner_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bridge.json"
            path.touch(mode=0o644)
            hue.save_config(path, {"username": "private-test-key"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text())["username"], "private-test-key")

    def test_credentials_cannot_be_written_to_repository(self):
        path = Path(hue.__file__).parent / "bridge.json"
        with self.assertRaisesRegex(hue.HueError, "outside"):
            hue.save_config(path, {})

    def test_bad_hostname_cannot_inject_url_path(self):
        with self.assertRaises(hue.HueError):
            hue.Bridge("example.com/private")


if __name__ == "__main__":
    unittest.main()
