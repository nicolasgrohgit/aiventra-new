# GCP migration runbook — execution night

Companion to `docs/gcp-migration.md` (the "what needs to move" analysis written ahead of time).
This is the concrete, ordered checklist for actually doing it, produced by grounding the plan
in the real code (`server.ts`, `eas.json`, `lib/mongodb.ts`, `lib/field-encryption.ts`,
`lib/user-data-key.ts`, the systemd unit files) rather than guessing. Total time: **4.5-6 hours**
for the full migration; **3-3.5 hours** if you scope down to Phases 0-6 tonight and defer the
mobile rebuild (Phase 7) — see "Scope-down option" at the bottom.

## Security prerequisites — already done, ahead of tonight

A pre-migration security pass (checking what changes once this stops being reachable only via
an obscure, rotating tunnel subdomain and becomes a stable, public URL) found 4 real gaps,
already fixed and verified live against the local server before tonight:

1. **`Dockerfile`/`.dockerignore` already exist at the repo root** (Phase 5 below just uses
   them, doesn't need to author them from scratch) — `.dockerignore` excludes `.env`/`.env*`,
   without which `COPY . .` would have baked the real local secrets (Mongo password,
   `JWT_SECRET`, `ADMIN_TOKEN`, `ENCRYPTION_MASTER_KEY`, `GOOGLE_PLACES_API_KEY`) permanently
   into the image's layers, readable by anyone with Artifact Registry pull access. The
   Dockerfile also runs as the non-root `node` user rather than root.
2. **`server.ts` now sets `app.set('trust proxy', 1)`** — without it, `express-rate-limit`
   (which keys on `req.ip`) would see Cloud Run's front-end proxy as the source of every
   request instead of the real client, silently breaking the rate limiting the code already
   relies on now that the app is public. (This was likely already broken behind the current
   cloudflared tunnel too — same single-proxy-hop situation.)
3. **The admin-token check (`requireAdminToken`) now uses `crypto.timingSafeEqual`** instead
   of `!==` (closes a timing side-channel), and all 4 `/admin/api/places` routes now go through
   `strictLimiter` — previously unthrottled beyond the generic global limiter, low-risk behind
   an unguessable tunnel URL, not once the URL is stable and public.
4. **Request logs no longer include the raw `Authorization` header.** Verified live: it
   previously appeared in full in `server.log`'s request lines (pino-http's default serializer
   logs every header) — harmless-ish in a local file only the developer can read, a much bigger
   exposure once Cloud Run ships these logs into Google Cloud Logging, readable by anyone with
   a Logging/Viewer role on the project. `pino`'s `redact` option now masks it.

Verified: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 245/245 passing, and a live
smoke test against the restarted local server (wrong admin token → 401, correct token → 200,
missing token → 401, `Authorization` header shows as `[Redacted]` in `server.log`).

**Still open, not blocking tonight but worth a conscious decision, not silent acceptance:**
Atlas Network Access needs `0.0.0.0/0` since Cloud Run has no static egress IP (use a strong,
unique, generated Atlas DB password); check the Cloud Run service's default service account
doesn't carry broader permissions than `secretmanager.secretAccessor` on the 5 secrets before
relying on it as-is.

## Corrections to the original plan, found by reading the code

- **admin.html is already token-gated**, not a "must fix before going live" blocker.
  `server.ts` gates every `/admin/api/places` route behind `requireAdminToken`, fails closed
  (503) if `ADMIN_TOKEN` is unset. Only the static HTML shell itself is unauthenticated (anyone
  with the URL can load the page, but can't do anything without the token). Fine to leave as-is
  tonight as long as `ADMIN_TOKEN` is a strong secret living only in Secret Manager. Real
  hardening (IAP, IP allowlist) is a next-sprint item, not tonight's.
- **No Dockerfile exists yet** — write it as part of Phase 5 (content below).
- **`tsx` is a devDependency** and the server runs via `npx tsx server.ts` directly, no compiled
  JS build step anywhere. The Dockerfile must NOT do `npm ci --omit=dev` (deletes `tsx`, the
  container won't start). Install full deps and run via `tsx`, matching local behavior exactly.
- **`package.json` is shared between the Expo app and the server** — `npm ci` in the container
  also pulls in `expo`/`react-native`/etc. Bigger/slower image than an ideal server-only one,
  but correct with zero code changes. Not worth splitting tonight.
- **`public/` holds ~158MB of built APKs** served incidentally by `express.static('public')`.
  Exclude `public/*.apk` via `.dockerignore`.
- **Neither `docker` nor `gcloud` is installed on this laptop**, and the local Mongo install
  only ships `mongod`/`mongos` — no `mongodump`/`mongorestore`/`mongosh`. Close both gaps in
  Phase 0, don't assume they're there.
- **Local data directory is 399MB today** — comfortably inside Atlas's free M0 tier's 512MB cap.
- **Secrets already flow through `.env` via dotenv**, not systemd `Environment=` lines — maps
  directly onto Secret Manager → container env vars with no surprises.

## Decisions

**Database: MongoDB Atlas, GCP-hosted region, M0 free tier.** Self-hosting on a GCE VM was the
alternative — rejected because it recreates the exact operational burden (patch/secure/keep-alive
a VM, no managed backup) this migration exists to escape, for no real savings at this scale.
Atlas gives working auth/TLS/patching and — given a past incident already destroyed live data via
a migration with no backup — a real `mongodump`/`mongorestore` backup story tonight, upgradable
to Atlas's own continuous backup at M10+. Same MongoDB either way, so `MONGODB_URI` is the only
application-side change (already isolated in `lib/mongodb.ts`). M0 caveats to carry forward: no
Atlas-native backup below M10, no burst headroom past 512MB — mitigated tonight by your own
verified backup, revisit the tier as data/users grow.

**Backend: Cloud Run.** `server.ts` is stateless, no native deps, no filesystem assumptions —
clean fit. Scales to zero (near-nothing idle cost for a beta), and every deploy is a fresh
container — kills the "server ran on stale code for 25h" bug class outright, `restart-server.sh`'s
6am cron stops being needed. GKE is unjustified overhead for one service/one operator; a GCE VM
just re-imports "systemd + a human keeping it alive." Cold starts on scale-from-zero are
sub-second to low-seconds for an app this size — fine for beta, revisit `min-instances=1` later
if testers complain.

**DNS/domain: use Cloud Run's `*.run.app` HTTPS URL tonight, buy a real domain later.** Zero
domain/DNS work needed to be live tonight; plugs into `EXPO_PUBLIC_API_URL` exactly like the
cloudflared URL did, except stable (no silent DNS-dead failure mode). Mapping a real domain later
is purely additive — one more APK rebuild whenever that happens, nothing else changes.

---

## Phase 0 — Tooling (~15 min)

On the laptop:
```bash
curl -O https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.10.0.tgz
tar -xzf mongodb-database-tools-ubuntu2204-x86_64-100.10.0.tgz
export PATH="$PWD/mongodb-database-tools-ubuntu2204-x86_64-100.10.0/bin:$PATH"
mongodump --version   # confirm it works
```
(Check `lsb_release -a` and https://www.mongodb.com/try/download/database-tools if the Ubuntu
release tag doesn't match.)

For `gcloud`/`docker`, use **Google Cloud Shell** in the browser (console.cloud.google.com → the
`>_` icon) instead of installing locally — both preinstalled, saves setup time:
```bash
git clone <your-repo-url>
cd Aiventra-new
```

## Phase 1 — Backup first, and prove it restores (~30-45 min, non-negotiable)

```bash
mkdir -p ~/odysai-backups
mongodump --uri="$(grep MONGODB_URI /home/nico/Aiventra-new/.env | cut -d= -f2-)" \
  --out=~/odysai-backups/pre-gcp-$(date +%Y%m%d-%H%M%S)

ls -la ~/odysai-backups/pre-gcp-*/odysai/
# expect users, trips, events, contacts, friendrequests, places, suggestions
```

**Prove it restores** — into a throwaway local DB, never the real one:
```bash
mongorestore --uri="mongodb://odys_user:<password>@127.0.0.1:27017/odysai_restore_test?authSource=odysai" \
  --nsFrom="odysai.*" --nsTo="odysai_restore_test.*" \
  ~/odysai-backups/pre-gcp-<timestamp>/odysai
```
Compare per-collection counts against the real `odysai` DB (via `mongosh` once installed, or a
one-off `tsx` script using the existing Mongoose models). Then run **one concrete decrypt smoke
test**: pull a real `Event` with a non-empty `title`/`location` from `odysai_restore_test`, and
using `lib/field-encryption.ts`/`lib/user-data-key.ts` with the **current `ENCRYPTION_MASTER_KEY`**,
confirm it decrypts to readable text. This is the check that actually validates the backup is
usable — a mismatched key restores bytes fine but produces permanently unreadable ciphertext.

Drop the throwaway DB when satisfied (`db.dropDatabase()` on `odysai_restore_test` only). Keep
the dump directory — it's reused in Phase 3, and is your rollback artifact regardless of tonight's
outcome.

## Phase 2 — GCP project + Atlas cluster (~30-45 min)

**GCP project (Cloud Shell):**
```bash
gcloud projects create odysai-prod --name="Odys.ai"
gcloud config set project odysai-prod
# Link the credits' billing account via console (Billing -> link this project) -- manual step.
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com
```

**Atlas (console — mongodb.com/cloud/atlas, no CLI):**
1. New Project "odysai" (create an org/account first if none exists).
2. Build a cluster: Provider = Google Cloud, region = e.g. `us-central1` (match your Cloud Run
   region), Tier = **M0 (free)**.
3. Database Access → add a user (e.g. `odysai_app`), strong generated password, read/write on
   `odysai`.
4. Network Access → allow `0.0.0.0/0` for tonight (Cloud Run has no static outbound IP by
   default; a real IP allowlist needs a Serverless VPC Connector + Private Service Connect —
   out of scope tonight, mitigated by TLS + strong credentials). Revisit tightening later.
5. Copy the `mongodb+srv://...` connection string — this becomes the new `MONGODB_URI` (append
   `/odysai`).

## Phase 3 — Migrate the data (~20-30 min)

From the laptop:
```bash
mongorestore --uri="mongodb+srv://odysai_app:<password>@<cluster>.mongodb.net/odysai" \
  ~/odysai-backups/pre-gcp-<timestamp>/odysai
```
Verify: same count check + decrypt smoke test as Phase 1, now against Atlas (confirms the key
wasn't fat-fingered anywhere). The local Mongo is untouched — `mongodump` only ever reads.

## Phase 4 — Secrets + Artifact Registry (~15-20 min, Cloud Shell)

```bash
gcloud artifacts repositories create odysai --repository-format=docker --location=us-central1

printf '%s' 'mongodb+srv://odysai_app:<password>@<cluster>.mongodb.net/odysai' | gcloud secrets create MONGODB_URI --data-file=-
printf '%s' '<same value as local .env JWT_SECRET>' | gcloud secrets create JWT_SECRET --data-file=-
printf '%s' '<same value as local .env ADMIN_TOKEN>' | gcloud secrets create ADMIN_TOKEN --data-file=-
printf '%s' '<same value as local .env ENCRYPTION_MASTER_KEY, EXACTLY>' | gcloud secrets create ENCRYPTION_MASTER_KEY --data-file=-
printf '%s' '<same value as local .env GOOGLE_PLACES_API_KEY>' | gcloud secrets create GOOGLE_PLACES_API_KEY --data-file=-
```
**`ENCRYPTION_MASTER_KEY` must be copy-pasted byte-for-byte.** This is the one secret where
"close enough" silently destroys data (every user's `Event.title`/`location`/`place_name`
becomes permanently unreadable) rather than failing loudly.

## Phase 5 — Containerize and deploy (~30-45 min)

`Dockerfile` and `.dockerignore` already exist at the repo root (added during the pre-migration
security pass — see "Security prerequisites" above; `.dockerignore` excludes `.env`/`.env*`, and
the image runs as the non-root `node` user). Nothing to author here, just use what's there.

Build + push (Cloud Shell):
```bash
gcloud builds submit --tag us-central1-docker.pkg.dev/odysai-prod/odysai/server:v1
```

Deploy:
```bash
gcloud run deploy odysai-server \
  --image us-central1-docker.pkg.dev/odysai-prod/odysai/server:v1 \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --set-secrets=MONGODB_URI=MONGODB_URI:latest,JWT_SECRET=JWT_SECRET:latest,ADMIN_TOKEN=ADMIN_TOKEN:latest,ENCRYPTION_MASTER_KEY=ENCRYPTION_MASTER_KEY:latest,GOOGLE_PLACES_API_KEY=GOOGLE_PLACES_API_KEY:latest
```
Prints the `https://odysai-server-<hash>-uc.a.run.app` URL — this is the new `EXPO_PUBLIC_API_URL`.

## Phase 6 — Verify (~15 min)

```bash
curl https://<the-run-app-url>/health
```
Then a real smoke test with your own account: log in, create a trip, create an event with a
title/location (exercises encryption end-to-end), fetch it back and confirm it displays
correctly. Also load `https://<url>/admin.html` and confirm the token prompt works.

## Phase 7 — Mobile app (~20-30 min, mostly EAS build wait)

Update `eas.json`'s `build.preview.env.EXPO_PUBLIC_API_URL` to the new Cloud Run URL, then:
```bash
npm run build-apk
```
(Auto-picks EAS cloud vs local based on remaining free-tier quota.) Install on your own device
first and repeat the Phase 6 smoke test through the actual app before sending to any tester.

## Phase 8 — Cutover, without a split-brain (~15-30 min buffer)

**Do not stop, restart, or touch `odysai-mongo.service`, `odysai-server.service`, or
`odysai-tunnel.service` at any point tonight.** Verify GCP thoroughly with your own account only
(Phase 6) *before* rolling the new APK out to anyone else — once a tester has the new APK while
someone else still has the old one, you have two live write paths (old tunnel→local Mongo, new
Cloud Run→Atlas) that will diverge. The local stack staying *up* is your safety net; it staying
*in active use by real testers* after cutover is what to avoid.

## Rollback / abort plan

- **Before Phase 3:** nothing live has changed — just stop.
- **Atlas data looks wrong after Phase 3:** local Mongo was never written to (`mongodump` is
  read-only) — delete the Atlas cluster, fix, retry from the same verified dump.
- **Cloud Run deploy broken (Phase 5/6):** local stack still fully running, zero user impact —
  iterate, or `gcloud run services delete odysai-server` and start over.
- **Already rolled the new APK out and something's wrong:** the previous `public/odys-ai-0.0.4x.apk`
  still points at the working local tunnel URL — **as long as `expose-server.sh`/
  `odysai-tunnel.service` was never restarted tonight**, that URL is unchanged. Before starting,
  `curl` the current tunnel URL once to confirm it isn't already silently DNS-dead — if it is,
  this rollback path doesn't actually exist, better to know that going in.

## Open decisions needing your input

1. **Billing account linkage** — only you can attach the GCP credits; first concrete action.
2. **Atlas tier** — M0 free tonight (recommended) vs. paying for more now.
3. **Region** — `us-central1` is a reasonable low-cost default; pick closer to your users if known.
4. **`JWT_SECRET`** — reuse (existing sessions keep working, recommended) vs. rotate (forces re-login).
5. **admin.html/API auth** — accept the existing `ADMIN_TOKEN` gate as sufficient tonight
   (recommended) vs. add IAP/IP-allowlisting first.
6. **How long to keep the local stack running post-migration** as a fallback/transition window.
7. **Domain purchase** — defer to `*.run.app` tonight (recommended) vs. buy `odys.ai` now.
8. **`scripts/demo-account-linker.ts`/seed scripts** — out of scope tonight; leave stopped, or
   run manually against the new `MONGODB_URI` if needed before their own Cloud Scheduler migration.

## Scope-down option

If it's getting late: do **Phases 0-6 tonight** (DB + backend live and verified via `curl` + one
manual smoke test — realistically **3-3.5 hours**), defer **Phase 7** (mobile rebuild/rollout,
~1-1.5 hours, mostly EAS queue wait) to a follow-up session. Costs nothing to defer — the local
stack keeps every existing tester working unchanged in the meantime.
