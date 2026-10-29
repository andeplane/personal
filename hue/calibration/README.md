# Room microphone calibration

The small **Hue Sound Check** app uses macOS AVFoundation to capture a short WAV
(1–15 seconds) from the room Mac's physical MacBook Pro microphone. It has a
microphone usage description and requests the normal macOS permission. It refuses
to record from virtual default audio devices. A person at that Mac must allow the
prompt; the helper does not modify or bypass macOS privacy settings.

The SSH-launched Swift script was denied microphone access. The app bundle was
built, installed and launched on the M1 as the supported permission-request path.
No microphone recording or acoustic calibration has been verified yet; SSH access
to the M1 has been intermittent. Installing the app is not microphone authorization.

Build/install on the room Mac:

```sh
python3 hue/calibration/install_helper.py
open -n "$HOME/Applications/Hue Sound Check.app" --args \
  "$HOME/.config/hue-calibration/test.wav" 10
```

The helper writes a private adjacent `test.status.json` with permission/recording
state, actual default microphone name and recording start epoch. It only accepts
WAV output paths under `~/.config/hue-calibration/`. Record only short, explicitly
requested sound tests. Keep recordings outside Git and remove them after analysis.

`measure.py` compares 10 ms RMS envelopes of the microphone recording and known
source WAV, then reports correlation and a delay estimate. Correct for remote
clock offset and include clock/recorder uncertainty. Reject low-correlation or
out-of-range results; repeat several trials to measure playback jitter. Example:

```sh
python3 hue/calibration/measure.py /PRIVATE/test.wav hue/audio/close-crack.wav \
  --recording-start-epoch RECORD_START --command-epoch PLAY_COMMAND_TIME \
  --remote-clock-offset ESTIMATED_M1_MINUS_CONTROLLER_CLOCK
```

A 0.35-second playback lead is currently a preliminary estimate from Sonos
transport response, not an acoustic measurement. Do not claim audible or visual
synchronization until tested on the installed speaker/bulbs. Microphone-only
measurement cannot establish actual bulb response latency.
