# Halloween 2026: working setup and next-year restart

This is the final working setup from 31 October 2026. Start here next year;
older sections of the general README describe earlier experiments.

## What runs

- The Mac mini is the sole lighting/motion controller. `supervise.py` runs
  `lightning.py listen --keep-awake` from the private runtime folder.
- The iPhone and Mac apps control that same process; they are not independent
  automation engines. Activity is stored persistently on the mini.
- The iPhone connects over home Wi-Fi through the authenticated, certificate-pinned
  HTTPS mobile gateway. Its user LaunchAgent is
  `com.andeplane.hue-halloween-mobile`.
- The lighting supervisor survives SSH disconnects, but automatic startup after
  a mini reboot has **not** been configured or verified. Check it after a reboot.

## Final effect

The scene lasts 44 seconds plus startup/cleanup, approximately 45 seconds in the
live tests. It opens with thunder/lightning, reveals the warm mask with laughter,
then adds another storm and a scream. A 30-second aftermath adds varied laughter,
thunder, a second scream and a gradual finish.

| Fixture role | Working behavior |
| --- | --- |
| Two colour bulbs in the outside house | White/purple bursts in the scheduled thunder/scare sections |
| Stålampe and gaming-room white bulb | Paired flashes throughout the scene; both return to a steady 35% warm glow, including while idle |
| Mask/window head bulb | Warm reveal with laughter; brief flicker in the scare sequence |
| Separate white door bulb | Random 3–4-second burst every 60–120 seconds, otherwise off; independent of motion |

The indoor pair deliberately has extra flashes between outdoor bursts. Every
thunder section includes a shared strike with the outside-house bulbs. The white
bulb uses cool-white peaks and warm-white glow, never RGB commands.

Thunder is 100%, laughter 70%, and screams 54%. Speaker cleanup restores its
previous volume. The portable Sonos must be charged, on the home Wi-Fi and
reachable; the controller does not substitute another room's speaker.

The main app switch controls **motion detection**, with no automatic darkness
gate. The Hue sensor's built-in dark threshold armed too early, so darkness-based
arming was removed. The user decides when to enable motion. Manual tests pause
motion; re-enable it afterward. **Stop & dark** also disables the warm idle glow
until Test, lights-on or motion-on re-enables it.

## Restore and test next year

1. Check out Git tag `halloween-2026`. Keep one active controller on the mini.
2. Keep/restore the private settings and pairing archive separately from Git.
   Never copy a private archive into this repository or an issue/PR attachment.
3. If rebuilding the Python environment, use Python 3.13 and
   `python -m pip install -r hue/requirements.txt`. These are the three direct
   package versions verified in the working mini environment.
4. Copy `hue/*.py`, `hue/sounds/` and `hue/audio/` into the private runtime using
   the existing folder layout. Preserve private configuration and certificates.
5. Verify each physical bulb against live Bridge inventory before changing its
   role. Device names/room membership can be stale after moving lamps. The
   configured role union must exactly match the dedicated scene group.
6. If the lighting supervisor is not running, start it once from the mini:

   ```sh
   root="$HOME/.config/hue-halloween"
   nohup "$root/venv/bin/python" -u "$root/runtime/supervise.py" \
     </dev/null >>"$root/supervisor.log" 2>&1 &
   ```

7. Check `runtime/control.py status`: sensor events connected, no error, intended
   motion state and warm-glow state. Open Activity and verify a new sensor report.
8. Charge/check the selected Sonos. Test one scene while watching the lamps and
   listening from outside. Check start and finish entries and the return to 35%.
9. Rebuild the Mac app with `python3 hue/app/build.py`. Rebuild/install the iPhone
   app using `hue/ios/README.md`; verify signing/provisioning is still valid. If
   the mobile certificate/token changes, rebuild the phone app with the new
   private pairing file. Confirm real iPhone gateway requests before calling it
   connected.
10. Enable motion in the app when ready. Test detection, and confirm that a
    running scene is not restarted or extended by additional movement.

## Private recovery material

On the mini, preserve `~/.config/hue-halloween/` configuration JSON files and
`~/.config/hue-halloween-mobile/` gateway settings, certificate and key, plus its
LaunchAgent plist. On the build Mac, preserve `~/.config/hue-mobile/client.json`.
Device IDs, network addresses, tokens and keys stay outside Git.

A dated private recovery archive was saved on the mini and copied to
`~/.config/hue-halloween-backups/` on the build Mac. It contains configuration and
pairing material, not raw camera/microphone recordings or generated audio mixes.
The build Mac also has a separate client-pairing archive and hash manifest in
the same dated folder. The source code and licensed sound assets are in Git.
Restore paths for the appropriate user account; if moving to another host/user,
update private absolute paths and the LaunchAgent before starting services.

The current iPhone development profile expires **30 September 2027**, before
next Halloween. Rebuild and reinstall the app with renewed signing next year.

## Verification boundaries

The final indoor-pair test reported matching brightness in all 32 samples:
35% glow → full bright → 35% glow. Software schedules stayed within the shared
ten-write budget; the pair reserves both command slots together. This verifies
commands and Bridge-reported state, not exact optical timing across bulb models.
The outside-house placement has not had a fresh camera/microphone calibration.
