# Hue lighting and Halloween window

Local tools for the existing Hue Bridge; Home Assistant is optional for the first
lighting setup. Python 3.9+ and the standard library are sufficient.

## Intended layout

| Location | Bulbs | Purpose |
| --- | --- | --- |
| Halloween/window room | 3 GU10 colour + 1 E27 colour | Normal room lighting and window reveal |
| Another room | 1 E27 colour | Independent room lighting |
| Outside | 1 E27 colour | Independent dusk-to-dawn lighting |

Select only the window room's actual installed light IDs. If only three bulbs
are installed, configure those three first; add the fourth later deliberately.
Do not put the outside or other-room bulbs in the Halloween zone.

The outdoor motion sensor also measures daylight. Keep its daylight view away
from the controlled lamp to prevent feedback. Check the outdoor fixture and
bulb environmental requirements before installing an ordinary E27 bulb outside.
Hue lamps need permanent, undimmed mains power; dim them through Hue.

## Pair and inspect

First use the Hue app to add the Bridge and bulbs, with the bulbs powered on.
Bulbs controlled only over Bluetooth are not necessarily paired to the Bridge.
The controller never factory-resets or unpairs devices.

Press the physical Bridge link button and run:

```sh
python3 hue/hue.py pair --bridge BRIDGE_LOCAL_ADDRESS
python3 hue/hue.py inventory
```

The credential is saved to `~/.config/hue-halloween/bridge.json`, with owner-only
permissions, outside Git. Pairing refuses to replace an existing credential.
An existing credential at that path is reused by all other commands. Do not
commit credentials, private hostnames/IPs, device serials, or inventory dumps.
The tool uses the Bridge's local HTTP API; use it only on the trusted home LAN.
It does not expose a web server or configure remote access.

If powered bulbs are missing:

```sh
python3 hue/hue.py search
# Allow the Bridge to finish discovery before reading the result.
python3 hue/hue.py search-result
python3 hue/hue.py inventory
```

If nothing is discovered, add the bulbs in Hue app **Settings → Devices → +**,
using their QR codes or serial numbers when necessary. Leave them powered on.

## Save scenes without switching lights

Replace the example IDs below with IDs from `inventory`:

```sh
python3 hue/hue.py configure --lights 1 2 3
```

This creates the **Halloween (Codex)** zone and **HW Normal white**, **HW Scary
purple**, and **HW Scary red** scenes. It does not recall a scene or change the
lights' current state. Recall a saved scene from the Hue app when wanted.
Repeat configuration updates this credential's existing scenes, without creating
duplicates or overwriting someone else's scenes. A different existing zone
membership is rejected rather than silently changed.

After confirming which lights are in the zone, a visible test is available:

```sh
python3 hue/hue.py reveal --lights 1 2 3 --seconds 4
```

This briefly illuminates the selected lights in white, changes to red for four
seconds, and finishes with those lights **off**. It does not restore their
previous state. There is no rapid strobe. Interrupted or failed tests attempt
to turn off every selected light, reporting if that fails. The Mac must remain
running for the test; this command does not install a persistent automation.

## Automation plan and commissioning

- Start with Hue app sensor settings for a simple motion → scene → timeout
  setup, after the sensor and window-room light membership are verified.
- With Home Assistant Green, add the existing Hue Bridge integration. Keep the
  bulbs and motion sensor paired to Hue; no extra Zigbee adapter is needed for
  that path.
- A dedicated arm switch and evening time window gate the Halloween effect.
  Motion starts the reveal and a short local thunder recording, then returns
  the window lights to darkness. Ignore retriggers during the effect and for
  30 seconds afterward. Disable the Hue app's competing motion action when
  Home Assistant takes ownership of this effect.
- Test first using the existing Sonos indoors, with low announcement volume.
  Speaker startup latency must be checked physically before claiming sync.
- Use a separate daylight automation for the outside bulb: sustained low light
  turns it on, sustained daylight turns it off. Use different on/off thresholds,
  plus startup reconciliation, and tune the thresholds after mounting.

Actual sensor IDs, daylight thresholds, timing, physical lamp placement, and
speaker selection remain commissioning inputs. No motion rules are installed
by this tool, and no sound file or persistent runtime is bundled yet.

## Validation

```sh
python3 -m unittest discover -s hue -p 'test_*.py' -v
```

Tests cover failed requests, wrong/unreachable light selection, preservation of
existing groups and other owners' scenes, idempotency, credential handling, and
off cleanup after reveal errors. They do not establish physical light response.

Reference: [Philips Hue local API getting started](https://developers.meethue.com/develop/get-started-2/).

## Motion-triggered Entertainment lightning

`lightning.py` uses Hue's DTLS Entertainment stream for rapid updates and the
local SSE event stream for motion. It controls only the explicitly selected
room's bulbs. It never stops another active Entertainment session. It pins the
Bridge certificate during setup; pairing stores an mDNS hostname so DHCP address
changes are resolved on startup. All credentials and selected device identifiers
stay in the private config folder outside Git.

Install the extra runtime in a private virtual environment:

```sh
uv venv ~/.config/hue-halloween/venv --python 3.13
uv pip install --python ~/.config/hue-halloween/venv/bin/python -r hue/requirements.txt
~/.config/hue-halloween/venv/bin/python hue/lightning.py pair
# Press the round Bridge button while pairing waits.
~/.config/hue-halloween/venv/bin/python hue/lightning.py setup --room ROOM_ID --sensor MOTION_SENSOR_ID
~/.config/hue-halloween/venv/bin/python hue/lightning.py test
~/.config/hue-halloween/venv/bin/python hue/lightning.py listen
```

The sequence starts with four seconds of irregular white lightning, holds soft
warm-white light for a randomly chosen 5–10 seconds, and plays a second four-second
lightning burst. It then holds the warm-white light for five minutes, adding
four-second lightning bursts after randomly chosen 20–40-second steady intervals.
The five-minute phase has a fixed end, including its bursts; the total sequence
lasts 5 minutes 13–18 seconds. It finishes off and stays off while idle.
Every completed or interrupted effect attempts to stop streaming and switch its
bulbs off. `listen` first switches the selected bulbs off, then waits for a fresh
false-to-true motion event. It ignores motion throughout the sequence and for 30 seconds
afterward; additional motion cannot extend the five-minute phase or queue a replay. It runs whenever this command is
running, without a daylight or evening restriction. Stop with Ctrl-C.

The listener must run on an awake computer with LAN access. It is not a Bridge
rule and is not installed on Home Assistant Green. Thunder audio is not included.
A Bridge-button-authorized streaming credential and a successful physical test
are required before calling the effect commissioned. On macOS, `listen --keep-awake`
prevents idle sleep while listening. A local LaunchAgent can run this command at login;
it must launch Python directly so launchd tracks the listener process. A process lock prevents two
copies of this controller running together. Certificate changes require deliberate
setup again. After loss of the Bridge connection it reconnects the event stream;
restart the process to resolve an IP change during an existing run.
