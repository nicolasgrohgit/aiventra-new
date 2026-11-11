# Play Store beta + RevenueCat setup (console steps)

The parts of the external-beta plan that only exist in web consoles (Play Console, Google
Cloud Console, RevenueCat) — no CLI/API for most of these. Do them in order: each section
depends on the one before. Console menus move around; if a path below doesn't match exactly,
search the console for the bold term.

Package name everywhere: `com.nicolas.groh.Odysai`.

## Automated path

`npm run setup-billing` (`scripts/setup-billing.ts`) does everything below that has an API.
Run `npm run setup-billing status` for what's done and what's next; add `--dry-run` to any
phase to see what it would do without touching anything.

| Run | Replaces | Needs first |
|---|---|---|
| `npm run setup-billing gcp` | section 3 except the Play Console invite, plus the webhook secret on Cloud Run (section 5) | gcloud logged in |
| `npm run setup-billing revenuecat` | section 5 except "Connect to Google" | a RevenueCat **v2 secret key** (Project settings → API keys, project configuration read & write) saved as `secrets/revenuecat-api-key` |
| `npm run setup-billing play` | section 4 | section 1 done, and the service account invited (end of section 3) |

Still by hand: section 1, section 2, the Play Console invite in section 3, "Connect to
Google" + pasting the topic in section 5, and section 6. The `play` and `revenuecat` phases
were written from the API references and have only been run with `--dry-run` so far — if a
call is rejected, the manual steps below still apply.

## 1. First upload to Play (internal testing)

Play won't let you create subscription products, or `eas submit` anything, until one build has
been uploaded by hand.

1. Build the bundle: `eas build --profile production --platform android` (cloud build; the
   `production` profile in `eas.json` produces an `.aab` and auto-increments `versionCode`
   remotely — Play rejects any upload whose versionCode isn't higher than the last).
2. Play Console → your app → **Testing → Internal testing** → Create new release → upload
   the `.aab` from the EAS build page. Accept **Play App Signing** when asked (Google holds the
   final signing key from here on).
3. Add yourself as an internal tester (Testers tab, an email list), save, roll out.

## 2. Fix Google Sign-In for Play-installed builds

Play re-signs the app with its own key, so a Play-installed build has a **different SHA-1**
than the EAS-signed APKs. Without registering it, Google Sign-In fails on Play installs.

1. Play Console → **Test and release → App integrity → App signing** → copy the **App
   signing key certificate SHA-1**.
2. Google Cloud Console → APIs & Services → **Credentials** → Create credentials → OAuth
   client ID → **Android**, package `com.nicolas.groh.Odysai`, paste that SHA-1. (A new client
   alongside the existing one — each Android client holds one package+SHA-1 pair. Keep the
   EAS one for sideloaded APKs.)
3. No app change needed — the app still uses the existing *Web* client ID.

## 3. Service account (shared by RevenueCat and `eas submit`)

1. Google Cloud Console (same project as the OAuth clients) → **APIs & Services → Library** →
   enable **Google Play Android Developer API** and **Google Play Developer Reporting API**.
2. **IAM & Admin → Service Accounts** → Create (e.g. `play-publisher`) → no roles needed at
   project level → open it → **Keys → Add key → JSON** → download.
3. Play Console → **Users and permissions** → Invite new users → the service account's email
   → app permissions for Odys.ai:
   - View app information and download bulk reports
   - View financial data, orders, and cancellation survey responses
   - Manage orders and subscriptions
   - Release apps to testing tracks (for `eas submit`)
4. Save the JSON as `secrets/play-service-account.json` in this repo (gitignored — used by
   `eas submit`), and upload the same file to RevenueCat in step 5.

## 4. Subscription products (Play Console)

**Monetize with Play → Products → Subscriptions** → Create subscription:

- Product ID **`premium`**, name "Odys.ai Premium".
- Base plan **`monthly`**: auto-renewing, 1 month, **$2.99** (let Play convert other
  currencies).
- Base plan **`annual`**: auto-renewing, 1 year, **$19.99**.
- On each base plan: enable a **grace period** (7 days) and **account hold** — matches the
  "keep Premium during billing retry" decision in `docs/monetization-strategy.md`.
- Activate both base plans.

Then **Settings (all apps) → License testing** → add your Gmail and any tester accounts. License
testers buy for free and renewals run on an accelerated clock (a "month" is ~5 minutes), so the
whole lifecycle — renew, grace, expire — can be tested in an afternoon.

## 5. RevenueCat

1. Project → **Apps** → add a **Play Store** app, package `com.nicolas.groh.Odysai`, upload the
   service-account JSON. RevenueCat can take up to ~36h to show the credentials as valid —
   that's Google-side propagation, not a mistake.
2. Same app → **Google developer notifications** → connect, pick/create the Pub/Sub topic →
   copy the topic name → Play Console → **Monetize with Play → Monetization setup → Real-time
   developer notifications** → paste it → Send test notification.
3. **Product catalog → Products** → import from Play (`premium:monthly`, `premium:annual`).
4. **Entitlements** → create **`premium`** → attach both products.
5. **Offerings** → `default` (current) → packages **Monthly** (`$rc_monthly` →
   `premium:monthly`) and **Annual** (`$rc_annual` → `premium:annual`).
6. **API keys** → copy the **public Android SDK key** (`goog_…`) → give it to Claude / set as
   `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` in `eas.json`'s preview env. Public by design, safe in
   the build.
7. **Integrations → Webhooks** → add:
   - URL: `https://odysai-server-891816307412.us-central1.run.app/api/webhooks/revenuecat`
   - Authorization header: a long random string (`openssl rand -hex 32`). Set the same value
     as `REVENUECAT_WEBHOOK_SECRET` on Cloud Run. Secret — never in the app build.
   - Environment: both production and sandbox (license-tester purchases are sandbox).

## 6. Closed testing (the 14-day clock)

Personal developer accounts need **12+ testers opted in for 14 consecutive days** on a closed
track before production access can be requested.

1. **Testing → Closed testing** → create a track → testers via a Google Group (easiest to
   manage) or email list → promote the internal release to it.
2. Store listing, content rating questionnaire, Data Safety form, privacy policy URL, and the
   account-deletion URL must be filled before the closed track can go live (the app-side
   pieces — deletion flow, privacy page — are on the beta plan).
3. Recruit ~15–20 so drop-outs don't reset the count below 12; share the opt-in link Play gives
   you on the track page.
