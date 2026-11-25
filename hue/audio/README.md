# Recorded thunder and matching flash cues

Two real field recordings, published under CC0 by their uploaders:

- **close-crack.wav**: excerpt from [thunder crack.wav](https://freesound.org/people/cognito%20perceptu/sounds/347853/) by **cognito perceptu**.
- **rolling-crack.wav**: excerpt from [rayjensen - thunder-crack 41k 16bit mono.wav](https://freesound.org/people/rayjensen/sounds/200990/) by **rayjensen**.

License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
Downloaded from the public HQ MP3 previews linked on the original Freesound pages,
not the original uncompressed WAV downloads. Both excerpts are four seconds,
converted to mono 24 kHz 16-bit PCM, trimmed around the first strong onset,
peak-normalized and faded at the beginning/end. The source links, input/output
hashes, excerpt offsets, processing and credits are recorded in `catalog.json`.
No claim of having listened to these on the installed speaker is made.

`prepare_recorded_thunder.py` measures 20 ms RMS windows, finds up to four strong
peaks separated by at least half a second, and places flash cues 100 ms before
those peaks. This provides a shared timeline, not verified audible synchronization.
Sonos or another speaker needs playback-latency calibration before commissioning.
Each flashing channel varies slightly around the recording's cue timing and gain.
The steady anchor and two-minute effect duration remain unchanged.

To rebuild, download the HQ MP3 previews linked from the credited source pages,
decode each with ffmpeg to mono 24 kHz 16-bit PCM using the filenames `close-crack.wav`
and `rolling-crack.wav`, then run:

```sh
python3 hue/prepare_recorded_thunder.py INPUT_FOLDER hue/audio
```

The private `lightning.json` may select `thunder_catalog` as an absolute path to
this catalog while keeping `audio_enabled: false`. That uses the recordings'
flash cues with no playback. Enabling audio is a separate commissioning step.
Playback can use local macOS `afplay` or the explicitly selected Sonos backend.
Its latency must be checked on the actual speaker.


## Longer rumble tails

The separate [full-length catalog](full/README.md) contains five 9.9–11.5-second
thunder recordings with four-second flash cues. It allows the white lightning
to end quickly while the recorded rumble continues. The legacy catalog above
retains its strict four-second WAV format. Controller selection, end-of-storm
tail time and speaker calibration are handled separately.
