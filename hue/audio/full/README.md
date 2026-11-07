# Full thunder with short lightning cues

Five CC0 thunder excerpts retain **9.9–11.5 seconds of crack and rumble** while
limiting their flash-cue timeline to the first four seconds. These are separate
from the legacy four-second clips, which remain unchanged for compatibility.
The audible tail is never synthesized or looped. Each original excerpt is
peak-normalized to 30000/32768 with a 10 ms onset fade and a one-second ending
fade. The longer sound must be allowed to finish after the white flashes stop.

| Recording | Duration | Original source |
| --- | ---: | --- |
| Heavy close thunderclap | 11.5s | [Pingel](https://freesound.org/people/Pingel/sounds/2689/) |
| Close lightning strike | 11.5s | [guitarguy1985](https://freesound.org/people/guitarguy1985/sounds/87963/) |
| Deep thunder · long | 9.9s | [SholeColtis](https://freesound.org/people/SholeColtis/sounds/683417/) |
| Deep thunder · rolling | 11.5s | [SholeColtis](https://freesound.org/people/SholeColtis/sounds/683419/) |
| Loud rumbling clap | 11.2s | [Josh74000MC](https://freesound.org/people/Josh74000MC/sounds/477839/) |

All source licences are [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
Inputs are the publishers' public HQ MP3 previews, not original lossless WAVs.
`catalog.json` records each input-preview and decoded-input SHA-256, derived-WAV
SHA-256, extraction offset, source URL, author and processing details. It is a
JSON list; full-playback filenames carry a `storm-` prefix so they do not collide
with the independent manual-audition library. Each record contains `file`, `sha256`, `audio_duration`,
`cue_duration: 4`, `strikes` and `audio_peak_seconds`.

Five strong local peaks in the first four seconds are measured in 20 ms RMS
windows, separated by at least 460 ms. Cue intervals begin 80 ms before those
measured peaks and end 60 ms afterward. This shared source timeline is not a
claim of acoustic or optical calibration: actual Sonos and Hue delays must be
measured in the installed room, and checked again after moving the equipment.

The shortest original burst spacing is twelve seconds. The 11.5-second cap
leaves a margin before another URI can start. The controller must reserve time
for the final tail before cleanup, and manual cancellation may stop it early.

Rebuild from the sound library's verified source-preview cache:

```sh
python3 hue/build_sound_library.py --offline
python3 hue/prepare_recorded_thunder.py \
  "$HOME/.config/hue-halloween/downloads" hue/audio/full --full-library
```

The builder verifies each MP3 against the library manifest before decoding it.
No private recording, device identifiers or credentials are included here.
