# Spotlyte (working name): live streaming with gifts

A YahLive/Bigo-style app: anyone 18+ can go live, viewers chat and send paid virtual gifts,
and streamers cash out their earnings. It's an MVP built to ship fast.

```
mobile/   Expo (SDK 58) + expo-router + LiveKit React Native + RevenueCat
server/   Express + Mongoose API: auth, streams, gifts ledger, payouts, moderation, webhooks
```

## How the money flows

1. Viewer buys **Coins** in the app → Apple/Google take 15–30% → RevenueCat webhook credits coins.
2. Viewer sends a **Gift** (costs coins) → streamer gets **Diamonds** (1 coin = 1 diamond).
3. Streamer requests a payout (min 10,000 💎 = $30, 1 💎 = $0.003) → you pay them from **Wise**,
   then mark it paid via the admin API.
4. Apple/Google deposit your net revenue monthly into your **Wise Business** USD/EUR account.

The rates live in `server/src/lib/economy.ts`. A unit test fails if any coin pack would lose
money after a 30% store fee plus the creator's cut. At the cheapest pack you keep about 57% of
what Apple/Google pay you, and about 44% at the biggest pack.

Apple and Google **require** in-app purchase for coins. Wise can't be the checkout. It's where
store payouts land and where you send creator payouts from.

## Run locally

```bash
cd server && cp .env.example .env   # fill in Mongo Atlas, LiveKit Cloud, secrets
npm install && npm run dev          # API on :4000
npm test                            # economy / age-gate / moderation tests

cd ../mobile && npm install
npx eas build --profile development --platform android   # LiveKit needs a dev build, not Expo Go
npx expo start --dev-client
```

## Launch checklist

**Accounts (≈1 day)**
- [ ] Pick the final name and check trademark/domain/store availability. "Spotlyte" is a placeholder.
- [ ] Wise Business account (you said this is ready) → get USD and EUR account details.
- [ ] Apple Developer ($99/yr) and Google Play Console ($25). Put Wise bank details in the payout settings of both.
- [ ] LiveKit Cloud project → `LIVEKIT_*` env vars; add webhook `https://API/api/webhooks/livekit`.
- [ ] MongoDB Atlas free cluster → `MONGODB_URI`.
- [ ] RevenueCat project: add the iOS and Android apps, create consumable products `coins_100`,
      `coins_550`, `coins_1200`, `coins_6500` in both stores, and add the webhook
      `https://API/api/webhooks/revenuecat` with an Authorization header = `REVENUECAT_WEBHOOK_AUTH`.
      Put the public SDK keys in `mobile/app.json` → `extra`.

**Deploy (≈hours)**
- [ ] Deploy `server/` (Dockerfile included) to Railway, Render or Fly.io. Set `apiUrl` in `mobile/app.json`.
- [ ] `eas build --profile production` → `eas submit`.

**Store review requirements (already built in, but needed in the listing)**
- [ ] Privacy Policy and Terms URLs (host them anywhere), plus a support email.
- [ ] Rate the app 17+ / Mature. Declare user-generated content and live streaming.
- [ ] Give reviewers a demo account with some coins (use the admin API or Mongo to add coins).
- [ ] Present in the app: report, block, account deletion, 18+ gate, and community guidelines.

**Before real money moves**
- [ ] Someone checks the report queue daily: `GET /api/admin/reports` with `x-admin-key`.
- [ ] Payouts: `GET /api/admin/payouts` → pay in Wise → `POST /api/admin/payouts/:id/paid`.
      Collect W-8BEN/W-9 or equivalent from top earners. Keep the payout minimum high at first.
- [ ] Get an accountant's view on VAT/sales tax. The stores collect it on coin sales in most countries.

## Admin API (header `x-admin-key: $ADMIN_KEY`)

| Method | Path | |
|---|---|---|
| GET | `/api/admin/reports?status=open` | moderation queue |
| POST | `/api/admin/reports/:id` `{status}` | `actioned` / `dismissed` |
| POST | `/api/admin/users/:id/ban` | bans the user and kills their live room |
| GET | `/api/admin/payouts?status=pending` | payout queue |
| POST | `/api/admin/payouts/:id/paid` `{note}` | after sending money from Wise |
| POST | `/api/admin/payouts/:id/reject` `{note}` | refunds the diamonds |

## Known MVP gaps (next up)
- Refunds aren't clawed back yet (RevenueCat `REFUND`-type events are ignored).
- The gift debit and credit are two writes, not a Mongo transaction (Atlas supports transactions; switch once there's traffic).
- Chat goes peer-to-peer over LiveKit data channels, so there's no server-side chat filter. Add a moderation API before scaling.
- No stream thumbnails, follows, push "X is live" notifications, PK battles, or leaderboards yet.
  These are the YahLive/Bigo retention features to build next.
