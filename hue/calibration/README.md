# Room microphone calibration

The small **Hue Sound Check** app uses macOS AVFoundation to capture a short WAV
(1–15 seconds) from the room Mac's physical MacBook Pro microphone. It has a
microphone usage description and requests the normal macOS permission. It refuses
to record from virtual default audio devices. A person at that Mac must allow the
prompt; the helper does not modify or bypass macOS privacy settings.

The SSH-launched Swift script was denied microphone access. The app bundle was
built, installed and launched on the M1 as the supported permission-request path.
That initial M1 path did not produce a verified recording because SSH access
was intermittent. The active combined camera/microphone verification now uses
the M4 helper described below. Installing a helper is not microphone authorization.

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

The 0.35-second playback lead began as a Sonos transport estimate. Combined M4
recordings have since checked nominal audio/light peak alignment for this
placement. Repeat those measurements after moving the installed speaker/bulbs. Microphone-only
measurement cannot establish actual bulb response latency.

## M4 camera and microphone check

`install_flash_check.py` installs **Hue Camera Check** with the normal camera and
microphone usage descriptions. By default it reuses an existing installed app;
only explicit `--rebuild` changes the signed helper. This avoids resetting privacy
approval merely to repeat a calibration. `open "$HOME/Applications/Hue Camera Check.app"`
starts a preview. Its Record button, or the private `capture.request` marker,
records 60 seconds and then stops both devices and exits. Idle previews expire
after three minutes. All output stays under the owner-only
`~/.config/hue-calibration/m4-flash-check` directory.

`analyze_capture.py` measures room brightness and a colour score that distinguishes
white flashes from the yellow background, plus microphone RMS and source-audio
matches. It can overlay the controller's private frame trace and use
`--sources-dir hue/audio/full` for natural-tail recordings. It reports camera
motion and requires fixed framing for confident timing comparisons. These are
relative camera measurements, not calibrated photometry; 30 Hz video, camera
exposure/white balance, AAC timestamp offsets and host-clock uncertainty remain.

After moving the lamps or speaker, repeat a stable recording containing the
opening, at least two bursts, and the return to darkness. Compare recorded pulses
with queued frames and actual microphone peaks before changing playback lead.
A connected sender or accepted Sonos command alone is not physical proof.

For the optional analysis tools, create a separate environment and install
`hue/calibration/requirements.txt`. The lighting runtime does not require NumPy
or Matplotlib. Run analysis regressions with:

```sh
python -m unittest discover -s hue/calibration -p 'test_*.py'
```
