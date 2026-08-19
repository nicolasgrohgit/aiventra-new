# Running a beta session (APK sideload)

How to get a build into testers' hands with the backend running on your own laptop —
zero-cost, no hosting account required. See `.env.example` for every var referenced here.
This entire local setup — MongoDB, the tunnel, the cron restart — is temporary, beta-only
infrastructure; see `docs/gcp-migration.md` for what it becomes once this moves to GCP.

## The constraint this setup has

**Your laptop must be on, the server running, and the tunnel active for the entire time
testers are using the app.** This isn't a bug — it's the tradeoff of not paying for hosting
during beta. If your laptop sleeps or the tunnel drops, testers' apps will fail to reach the
backend (trips/contacts/profile sync will fail; the app still works offline via its local
AsyncStorage cache, but nothing will sync). Plan beta sessions around your laptop being
reachable.

## One-time setup

1. Copy `.env.example` to `.env` and fill in `MONGODB_URI` and `JWT_SECRET` (generate the
   secret with the command in the comment). Leave `SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_DSN`
   blank unless you've created a free Sentry project and want error reporting.
2. Install `cloudflared` if it isn't already at `~/.local/bin/cloudflared`:
   ```bash
   curl -Ls https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
     -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared
   ```
3. Register the daily restart cron job (keeps the server from ever running on stale code for
   long — see `scripts/restart-server.sh` for why this matters):
   ```bash
   (crontab -l 2>/dev/null; echo "0 6 * * * /path/to/scripts/restart-server.sh") | crontab -
   ```

## Every time you start a beta session

1. Start MongoDB: `npm run mongo start`
2. Start the backend: `npm run server`
3. In a second terminal, expose it: `bash scripts/expose-server.sh`
   Prints a URL like `https://something-random.trycloudflare.com`. No password/IP
   confirmation step (unlike the localtunnel setup used earlier in the project's history) —
   the printed URL works immediately.
4. Hit `<the-printed-url>/health` in a browser once to confirm the tunnel and server are
   both up before distributing anything.

**Note on URL stability**: quick tunnels (no Cloudflare account) don't support a fixed
hostname — every fresh start of `expose-server.sh` gets a new random URL. This matters less
than it sounds, though: `cloudflared` reconnects to a restarted backend on its own (verified
by test), so the daily cron restart (`scripts/restart-server.sh`) deliberately leaves the
tunnel untouched — the URL only changes if you restart `expose-server.sh` itself, not on
every server restart. If you ever want a genuinely permanent hostname across script
restarts too, that needs a free Cloudflare account and a *named* tunnel instead of a quick
one — not set up here, since this whole thing is moving to GCP after the beta anyway (see
`docs/gcp-migration.md`), so it wasn't worth the extra setup for something temporary.

## Building the APK testers install

The app needs to know the tunnel URL **at build time** — it gets compiled into the JS
bundle, there's no way to change it after the fact without a new build.

1. Update `eas.json`'s `build.preview.env.EXPO_PUBLIC_API_URL` to the current tunnel URL.
2. Build:
   ```bash
   eas build --profile preview --platform android --non-interactive
   ```

(`eas.json`'s `preview` profile is already configured to produce an installable `.apk`
rather than an `.aab`.) Once the build finishes, EAS gives you a download link — send that
to testers, or download the APK yourself and share it directly for sideloading.

You only need to rebuild when the app code changes, or when the tunnel URL changes (which,
per the note above, is now much less frequent than it was with the earlier localtunnel
setup — only on an `expose-server.sh` restart, not a server restart).

## Turning on error tracking (optional, free tier)

1. Create a free project at [sentry.io](https://sentry.io) (one for the backend, one for
   the React Native app, or reuse one DSN for both — your call).
2. Add the DSN(s) to `.env` as `SENTRY_DSN` (backend) — takes effect on the next
   `npm run server` restart, no code changes needed.
3. For the app, set `EXPO_PUBLIC_SENTRY_DSN` and rebuild the APK (`EXPO_PUBLIC_*` vars are
   baked in at build time, same as `EXPO_PUBLIC_API_URL` above).

Until you do this, error tracking is fully wired but inert — no accounts, no network calls,
no cost.

## Reading beta activity in the meantime

There's no analytics dashboard for beta — with a handful of testers, the terminal running
`npm run server` is the dashboard. It prints structured JSON log lines for logins, trip
creation, and itinerary additions (search for `"event":"user_login"`,
`"event":"trip_created"`, `"event":"itinerary_item_added"`), plus every request and any
server error. Pipe it through `npx pino-pretty` if you want it more readable:

```bash
npm run server | npx pino-pretty
```
