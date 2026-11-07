# Halloween sound library

32 mono 24 kHz / 16-bit PCM WAV clips: 13 thunder sounds, 11 screams,
seven laughs and a ghost howl. Voices are up to eight seconds; thunder is up
to 30 seconds so the deep rumble is preserved. All source
recordings are CC0. `catalog.json` records authors, original pages, preview URLs,
extraction offsets and SHA-256 hashes. New voices come from the publisher's HQ
MP3 previews, decoded to PCM; these are not claimed to be original lossless files.

- Eleven screams: three separate phrases from Volonda's acted collection,
  plus eight independently sourced acted, monster, ghost and jumpscare clips.
- Thirteen thunder sounds: heavy close claps, deep rolling thunder, low bass
  rumble and sharp cracks. The two existing automatic excerpts retain their
  audio-derived lightning cues in `../audio/catalog.json`.
- Six evil laughter choices (deep, villain cackle, demonic, sinister, cartoon and
  haunted), the existing witch laugh, and one ghost howl.

Rebuild with `python3 hue/build_sound_library.py` (requires ffmpeg). The first
build needs internet access; later builds reuse checksum-verified private inputs.
Use `--offline` to require the existing inputs and prohibit network access, or
`--refresh` to recheck the publisher licences and redownload HQ previews. Both
original preview hashes and derived WAV hashes are retained in the manifest.
The two legacy thunder clips retain the provenance of `../audio/catalog.json`.
The generated directory is pruned to the active manifest after a successful build,
so removed clips are not restored or left available as orphaned audio files.

Source downloads stay in the user's private cache. Voice excerpts have peak
normalization and short edge fades; names describe the publisher's labels.
No acoustic listening or room calibration is implied by signal processing.

The native app can overlay up to four clips (maximum combined duration: two minutes) or concatenate them in selected
order. Overlay gain is reduced when necessary to prevent clipping. Generated
mixes stay in a bounded private cache on the controller host. Automatic motion
uses its separately configured full-thunder catalog; voices and laughs play only
when selected for a manual preview or mix.

The Sonos fetches allowlisted WAV files over a private LAN HTTP endpoint.
There is no directory listing and the server never serves configuration or
credentials. Keep this endpoint on the home LAN. Stop cancels playback and
returns the selected Hue bulbs to darkness. Manual tests pause motion; re-enable
Automatic motion afterward. Transport verification does not prove acoustic sync.

## Evil laughter audition choices

The six added laughs are separate recordings, not pitch variants made from one
sample. Publisher descriptions identify the deep/villain/cartoon styles; the
short demonic chuckle is the author's own laugh lowered in pitch. All are CC0,
retained at their complete 1.4–7.1-second preview lengths, and normalized to the
same voice peak level. These candidates still need listening on the selected
speaker; waveform checks do not establish subjective scariness. Find them under
**Other** in the app, or combine up to four with thunder.

## Individual recordings

| App name | Length | Original author and recording |
| --- | ---: | --- |
| Heavy close thunderclap | 15.5s | [Pingel](https://freesound.org/people/Pingel/sounds/2689/) |
| Close lightning strike | 18.1s | [guitarguy1985](https://freesound.org/people/guitarguy1985/sounds/87963/) |
| Very low bass rumble | 30.0s | [BlueDelta](https://freesound.org/people/BlueDelta/sounds/367223/) |
| Deep thunder · rolling | 15.3s | [SholeColtis](https://freesound.org/people/SholeColtis/sounds/683419/) |
| Close thunder | 4.0s | [cognito perceptu](https://freesound.org/people/cognito%20perceptu/sounds/347853/) |
| Deep thunder · long | 9.9s | [SholeColtis](https://freesound.org/people/SholeColtis/sounds/683417/) |
| Deep thunder · long 2 | 8.0s | [SholeColtis](https://freesound.org/people/SholeColtis/sounds/683418/) |
| Deep thunder · short | 6.4s | [SholeColtis](https://freesound.org/people/SholeColtis/sounds/683420/) |
| Loud rumbling clap | 11.2s | [Josh74000MC](https://freesound.org/people/Josh74000MC/sounds/477839/) |
| Loud thunderclaps | 30.0s | [Rvgerxini](https://freesound.org/people/Rvgerxini/sounds/620529/) |
| Mid thunder · short | 6.7s | [SholeColtis](https://freesound.org/people/SholeColtis/sounds/683421/) |
| Rolling thunder | 4.0s | [rayjensen](https://freesound.org/people/rayjensen/sounds/200990/) |
| Sharp thunder crack | 30.0s | [Fission9](https://freesound.org/people/Fission9/sounds/476228/) |
| Cartoon-villain laugh | 6.6s | [riippumattog](https://freesound.org/people/riippumattog/sounds/704363/) |
| Demonic chuckle | 1.4s | [scorpion67890](https://freesound.org/people/scorpion67890/sounds/169317/) |
| Evil laugh · deep | 4.0s | [ckvoiceover](https://freesound.org/people/ckvoiceover/sounds/401332/) |
| Ghost howl | 6.3s | [JanIsAGuy](https://freesound.org/people/JanIsAGuy/sounds/432778/) |
| Ghost scream | 6.1s | [MikkyLachae](https://freesound.org/people/MikkyLachae/sounds/259264/) |
| Haunted laugh | 5.9s | [tchild](https://freesound.org/people/tchild/sounds/319766/) |
| High-pitched scream | 2.8s | [Topschool](https://freesound.org/people/Topschool/sounds/360464/) |
| Jumpscare scream | 2.7s | [Breviceps](https://freesound.org/people/Breviceps/sounds/587354/) |
| Long male scream | 8.0s | [ihitokage](https://freesound.org/people/ihitokage/sounds/656064/) |
| Monster scream | 4.3s | [Marvin_Chiriguaya](https://freesound.org/people/Marvin_Chiriguaya/sounds/705784/) |
| Pained shout | 1.0s | [Guy110](https://freesound.org/people/Guy110/sounds/353189/) |
| Scream 1 | 1.8s | [Volonda](https://freesound.org/people/Volonda/sounds/439517/) |
| Scream 2 | 1.4s | [Volonda](https://freesound.org/people/Volonda/sounds/439517/) |
| Scream 3 | 2.1s | [Volonda](https://freesound.org/people/Volonda/sounds/439517/) |
| Short human scream | 1.2s | [claracarpintero](https://freesound.org/people/claracarpintero/sounds/219856/) |
| Sinister laugh | 7.1s | [pepv](https://freesound.org/people/pepv/sounds/212579/) |
| Startled shout | 1.3s | [SamsterBirdies](https://freesound.org/people/SamsterBirdies/sounds/343768/) |
| Villain cackle | 6.9s | [el_boss](https://freesound.org/people/el_boss/sounds/650618/) |
| Witch laugh | 3.5s | [NikoMyth](https://freesound.org/people/NikoMyth/sounds/348142/) |
