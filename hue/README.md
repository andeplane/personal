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

The bulbs stay off while idle. A fresh motion event runs this sequence:

1. Both bulbs show neutral white for exactly two seconds.
2. Both bulbs go dark for half a second.
3. Both bulbs flash irregular white lightning for four seconds.
4. For the next two minutes, the first selected channel stays neutral white at RGB 46000/46000/46000. The two-second normal opening
   uses its original brightness. The
   remaining channels stay dark between four-second lightning bursts, separated
   by randomly chosen 8–15-second intervals. Each flashing bulb gets its own
   pattern and brightness, with occasional shared strikes.
5. All selected bulbs switch off. The complete sequence lasts 126.5 seconds.

Motion cannot restart or extend an active sequence. There is no added cooldown
once it finishes; a new timestamped detection (or false-to-true state change) is required.
Reports seen while a sequence is running are ignored and cannot queue a replay. Stop with Ctrl-C.
The `test` command runs the same complete sequence. `listen` first switches all
selected bulbs off, then listens for fresh motion. A third bulb can be added
deliberately to the Entertainment area with setup rerun; it becomes another
independently flashing bulb, while the first channel remains the steady anchor.

Two real CC0 thunder excerpts and audio-derived flash cues are prepared in
[audio/README.md](audio/README.md). Selecting a private `thunder_catalog` uses
the matched cues while `audio_enabled: false` keeps playback muted. Each burst
chooses one recording and its matching timing. Speaker latency remains to be
calibrated; Sonos playback is not yet implemented.

Alternatively, generate an original four-second thunder file with `python3 hue/thunder.py`.
For playback through this Mac, set `thunder_file` in the private `lightning.json`
to that file's absolute path. Playback uses `afplay` at 40% of the system volume
at the beginning of each lightning burst. Audio is optional and disabled until
the output speaker is chosen. Sonos playback is not implemented by this runtime.
Actual audible timing must be checked on the selected speaker.

The listener must run on an awake computer with LAN access. It is not a Bridge
rule and is not installed on Home Assistant Green. An original thunder generator is included; speaker playback must be configured.
A Bridge-button-authorized streaming credential and a successful physical test
are required before calling the effect commissioned. On macOS, `listen --keep-awake`
prevents idle sleep while listening. A local LaunchAgent can run this command at login;
it must launch Python directly so launchd tracks the listener process. A process lock prevents two
copies of this controller running together. Certificate changes require deliberate
setup again. The listener resolves mDNS on reconnect and also reconciles motion
reports every two seconds. It accepts `motion_report` updates as well as the older
boolean-only payload, deduplicating repeated and out-of-order reports. Recent
motion can be reconciled at startup without replaying stale cached detections.

The Entertainment sender and Bridge status are monitored throughout the sequence.
A failed stream is not logged as successful animation: cleanup runs, and the
same trigger gets one retry. A private `status_file` exposes idle/starting/playing/
retrying/failed state and the latest motion report. Logs include timestamps.

The deployed controller now runs on the always-on Mac mini under `supervise.py`,
started from SSH with detached standard streams. A supervisor lock prevents two
copies on that host. The former laptop LaunchAgent is disabled to keep one active
controller. Reboot autostart for the detached mini supervisor is not configured;
verify the supervisor, status file and a live sensor event after any host restart.

## Sonos thunder playback

`sonos_audio.py` plays the prepared WAV URLs on one explicitly selected Sonos
using local SoCo control. The private `sonos_config` contains its verified UID,
cached host, HTTPS `url_base` for the published audio folder, and `volume` (1–100; currently 50, explicitly selected by the user). If its address changes it discovers the same UID;
it never substitutes a different speaker. It refuses grouped speakers or playback
over unrelated music. Cleanup stops only our own clip and restores volume only
when it has not been manually changed. Network calls run outside the light-frame
loop, with a three-second request timeout.

The private lighting settings select `audio_enabled: true`,
`audio_backend: "sonos"`, `sonos_config: "/PRIVATE/sonos.json"`, and
`audio_lead_seconds`. Audio commands use absolute sequence offsets and are sent
ahead by the configured lead so Sonos can start the file near the light timeline.
The setting is bounded to 0–2 seconds. Scheduled playback is canceled when the
sequence stops, and lighting cleanup precedes potentially slow Sonos cleanup.

The selected Sonos Move 2 accepted a low-volume WAV test and reported PLAYING
about 0.36 seconds after the request. This establishes command/transport behavior,
not audible timing. A shortened combined light-and-Sonos test also confirmed PLAYING during the
lightning phase, followed by off cleanup. Motion-triggered playback is enabled
on the selected Move 2 at volume 50, using a provisional 0.35-second lead.
Microphone calibration on the room's M1 Mac remains pending until SSH/microphone access is available. See [calibration](calibration/README.md).

Lightning now uses full-power neutral white (65535/65535/65535) with a short
maximum plateau, then a fade to darkness. Audio-derived cues are kept, with
additional strikes in the gaps. Bursts recur after random 8–15-second steady
intervals rather than 20–40 seconds. The steady anchor remains separate; total
sequence duration is still 126.5 seconds. Sonos volume is now explicitly 50/100.
