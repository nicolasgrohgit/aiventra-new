# Running a beta session (APK sideload)

How to get a build into testers' hands with the backend running on your own laptop —
zero-cost, no hosting account required. See `.env.example` for every var referenced here.

## The constraint this setup has

**Your laptop must be on, `npm run server` running, and the tunnel active for the entire
time testers are using the app.** This isn't a bug — it's the tradeoff of not paying for
hosting during beta. If your laptop sleeps or the tunnel drops, testers' apps will fail to
reach the backend (trips/contacts/profile sync will fail; the app still works offline via
its local AsyncStorage cache, but nothing will sync). Plan beta sessions around your laptop
being reachable.

## One-time setup

1. Copy `.env.example` to `.env` and fill in `MONGODB_URI` and `JWT_SECRET` (generate the
   secret with the command in the comment). Leave `SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_DSN`
   blank unless you've created a free Sentry project and want error reporting.
2. Pick a `TUNNEL_SUBDOMAIN` in `.env` (defaults to `odysai-beta`). This is what makes the
   tunnel URL stable across restarts — you only need to rebuild the APK when this changes.

## Every time you start a beta session

1. Start MongoDB locally (however you normally do — this repo doesn't manage that).
2. Start the backend:
   ```bash
   npm run server
   ```
3. In a second terminal, expose it:
   ```bash
   bash scripts/expose-server.sh
   ```
   This prints a stable URL like `https://odysai-beta.loca.lt` and an IP "password" —
   localtunnel will ask visitors (including your app's requests) to confirm that password
   the first time; this only matters if a tester opens the tunnel URL directly in a
   browser, not for the app's own API calls.
4. Hit `https://<your-subdomain>.loca.lt/health` in a browser once to confirm the tunnel
   and server are both up before distributing anything.

## Building the APK testers install

The app needs to know the tunnel URL **at build time** — it gets compiled into the JS
bundle, there's no way to change it after the fact without a new build.

```bash
EXPO_PUBLIC_API_URL=https://<your-subdomain>.loca.lt eas build --profile preview
```

(`eas.json`'s `preview` profile is already configured to produce an installable `.apk`
rather than an `.aab`.) Once the build finishes, EAS gives you a download link — send that
to testers, or download the APK yourself and share it directly for sideloading.

As long as `TUNNEL_SUBDOMAIN` doesn't change, this same APK keeps working across restarts
of `npm run server` / `scripts/expose-server.sh` — you don't need to rebuild between beta
sessions, only when the app code itself changes or you change the subdomain.

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
