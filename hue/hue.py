#!/usr/bin/env python3
"""Small local Hue Bridge controller. Credentials never belong in this repo."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

DEFAULT_CONFIG = Path.home() / ".config/hue-halloween/bridge.json"
GROUP = "Halloween (Codex)"
SCENES = {
    "Normal white": {"on": True, "bri": 200, "xy": [0.459, 0.411]},
    "Scary purple": {"on": True, "bri": 140, "xy": [0.272, 0.109]},
    "Scary red": {"on": True, "bri": 140, "xy": [0.675, 0.322]},
}


class HueError(Exception):
    pass


class Bridge:
    def __init__(self, host, username=None):
        if not re.fullmatch(r"[A-Za-z0-9.-]+", host):
            raise HueError("Use a local Bridge IPv4 address or hostname, without a URL.")
        self.host, self.username = host, username
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(self, method, resource="", body=None):
        base = "http://" + self.host + "/api"
        if self.username:
            base += "/" + self.username
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            base + resource, data=data, method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with self.opener.open(request, timeout=8) as response:
                result = json.load(response)
        except urllib.error.HTTPError as exc:
            raise HueError(f"Bridge HTTP error {exc.code}.") from None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError):
            # Exception strings can contain the credential-bearing request URL.
            raise HueError("Could not read the Bridge response; check local connectivity.") from None
        check_response(result)
        return result


def check_response(result):
    if isinstance(result, list):
        for item in result:
            if "error" in item:
                code = item["error"].get("type", "unknown")
                if code == 101:
                    raise HueError("Press the Bridge link button, then retry pairing.")
                raise HueError(f"Bridge rejected the request (Hue error {code}).")


def save_config(path, data):
    path = Path(path).expanduser().resolve()
    repo = Path(__file__).resolve().parent.parent
    if path == repo or repo in path.parents:
        raise HueError("Store credentials outside the repository.")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(data, stream)


def inventory(bridge):
    result = {}
    for kind in ("lights", "groups", "sensors"):
        result[kind] = {}
        for identifier, item in bridge.request("GET", "/" + kind).items():
            # Whitelist useful fields; never dump the full Bridge configuration.
            keys = ("name", "type", "modelid", "state", "lights")
            result[kind][identifier] = {key: item[key] for key in keys if key in item}
    return result


def validate_lights(bridge, ids):
    if not ids or len(ids) != len(set(ids)) or any(not i.isdigit() for i in ids):
        raise HueError("Select unique numeric light IDs from inventory.")
    lights = bridge.request("GET", "/lights")
    for identifier in ids:
        if identifier not in lights:
            raise HueError(f"Light {identifier} is not on this Bridge.")
        state = lights[identifier].get("state", {})
        if not state.get("reachable"):
            raise HueError(f"Light {identifier} is unreachable; turn its mains power on.")
        if "xy" not in state:
            raise HueError(f"Light {identifier} does not support the colour scenes.")


def created_id(result):
    try:
        return str(result[0]["success"]["id"])
    except (KeyError, IndexError, TypeError):
        raise HueError("Bridge did not return a created resource ID.") from None


def configure(bridge, ids):
    validate_lights(bridge, ids)
    groups = bridge.request("GET", "/groups")
    matches = [(i, g) for i, g in groups.items() if g.get("name") == GROUP]
    if len(matches) > 1:
        raise HueError("Multiple Halloween groups exist; resolve them before configuring.")
    if matches:
        group_id, group = matches[0]
        if set(group.get("lights", [])) != set(ids):
            raise HueError("Existing Halloween group has different lights; refusing to overwrite it.")
    else:
        group_id = created_id(bridge.request("POST", "/groups", {
            "name": GROUP, "type": "Zone", "lights": ids,
        }))
    scenes = bridge.request("GET", "/scenes")
    output = {"group_id": group_id, "scenes": {}}
    for label, state in SCENES.items():
        name = "HW " + label
        existing = [i for i, s in scenes.items() if s.get("name") == name
                    and s.get("group") == group_id and s.get("owner") == bridge.username]
        body = {"lightstates": {i: {**state, "transitiontime": 0} for i in ids}}
        if len(existing) > 1:
            raise HueError("Duplicate owned scenes found; resolve them before configuring.")
        if existing:
            scene_id = existing[0]
            bridge.request("PUT", "/scenes/" + scene_id, body)
        else:
            scene_id = created_id(bridge.request("POST", "/scenes", {
                "name": name, "type": "GroupScene", "group": group_id,
                "recycle": False, **body,
            }))
        output["scenes"][label] = scene_id
    return output


def reveal(bridge, ids, seconds):
    validate_lights(bridge, ids)
    try:
        for identifier in ids:
            bridge.request("PUT", f"/lights/{identifier}/state", {
                "on": True, "bri": 200, "xy": [0.313, 0.329], "transitiontime": 0,
            })
        time.sleep(0.7)
        for identifier in ids:
            bridge.request("PUT", f"/lights/{identifier}/state", {
                **SCENES["Scary red"], "transitiontime": 0,
            })
        time.sleep(seconds)
    finally:
        failed = []
        for identifier in ids:
            try:
                bridge.request("PUT", f"/lights/{identifier}/state", {
                    "on": False, "transitiontime": 0,
                })
            except HueError:
                failed.append(identifier)
        if failed:
            raise HueError("Could not switch off lights " + ", ".join(failed))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    sub = parser.add_subparsers(dest="command", required=True)
    pair = sub.add_parser("pair", help="Pair after pressing the physical Bridge button")
    pair.add_argument("--bridge", required=True)
    sub.add_parser("inventory", help="Read lights, rooms and sensor states")
    sub.add_parser("search", help="Start Bridge discovery of powered lights")
    sub.add_parser("search-result", help="Read the latest discovery result")
    setup = sub.add_parser("configure", help="Save a zone and scenes; does not activate lights")
    setup.add_argument("--lights", nargs="+", required=True)
    show = sub.add_parser("reveal", help="Run a visible reveal test, ending with lights off")
    show.add_argument("--lights", nargs="+", required=True)
    show.add_argument("--seconds", type=float, default=4)
    args = parser.parse_args(argv)
    try:
        if args.command == "pair":
            if args.config.expanduser().exists():
                raise HueError("A credential already exists. Use it or choose another config path.")
            result = Bridge(args.bridge).request("POST", body={"devicetype": "codex#halloween"})
            save_config(args.config, {"host": args.bridge, "username": result[0]["success"]["username"]})
            print("Paired. Credential saved privately outside the repository.")
            return 0
        config = json.loads(args.config.expanduser().read_text())
        bridge = Bridge(config["host"], config["username"])
        if args.command == "inventory":
            result = inventory(bridge)
        elif args.command == "search":
            result = bridge.request("POST", "/lights", {})
        elif args.command == "search-result":
            result = bridge.request("GET", "/lights/new")
        elif args.command == "configure":
            result = configure(bridge, args.lights)
        else:
            if not 0 <= args.seconds <= 30:
                raise HueError("Reveal duration must be between 0 and 30 seconds.")
            reveal(bridge, args.lights, args.seconds)
            result = {"finished": True, "lights_off": True}
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except (HueError, KeyError, OSError, ValueError) as exc:
        message = str(exc) if isinstance(exc, HueError) else "Could not read local configuration. Pair first."
        print("Error: " + message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
