# Hue Halloween for iPhone

Native SwiftUI controls for motion on/off, the full horror scene, Stop & dark,
and live activity with older-page loading. The app polls every two seconds while
active and shows controller-confirmed state rather than assuming a command worked.
After a long reconnect gap it restarts the contiguous latest activity page, so
all intervening history remains reachable with Load older.

Build locally with Xcode and a valid Apple Development identity:

```sh
python3 hue/ios/build.py
```

The helper discovers the signing team from the local certificate and passes it
only to the build command. It copies `~/.config/hue-mobile/client.json` into the
signed app through a build phase. This private file contains `base_url`, `token`,
and `certificate_sha256`; never put it or the built app in Git. DerivedData and
signing logs stay under `~/.config/hue-mobile/build`. The helper does not install
or launch the app.

Every command uses HTTPS POST `/control`, a bearer token, and `X-Hue-Client: ios`.
The connection accepts only the configured host/port and the exact SHA-256 of
its leaf certificate. Redirects are rejected; cookies and credential persistence
are disabled. The local-network ATS exception is scoped to local networking,
with no global ATS bypass. The current pairing is intended for home Wi-Fi.
