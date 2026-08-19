# Moving off local-beta infrastructure to GCP

This documents exactly what's local-only/temporary right now versus what's already portable
as-is, so migrating to GCP after the beta is a checklist, not a rediscovery. Nothing here is
urgent — it's a map for when that migration actually happens.

## Already portable, no rework needed

The backend itself was built to be environment-agnostic from early on:

- **`server.ts`** — a plain Express app, all config via environment variables
  (`PORT`, `MONGODB_URI`, `JWT_SECRET`, `SENTRY_DSN`). No filesystem paths, no assumptions
  about the local machine baked into application logic. This runs the same way on a GCP
  Compute Engine VM, in a container on Cloud Run, or in GKE — whichever GCP picks.
- **Mongoose models, routes, `lib/*.ts` business logic** — no changes needed for a move.
- **The mobile app's backend URL** — already a single build-time env var
  (`EXPO_PUBLIC_API_URL` in `eas.json`). Migrating means changing one string to the real GCP
  hostname and rebuilding — the exact same mechanism already used to swap tunnel URLs all
  through the beta.

## Local-only, needs a real replacement on GCP

| Local (now) | What it's standing in for | GCP equivalent |
|---|---|---|
| MongoDB installed as a user-space binary (`~/.local/share/odysai-mongodb`, `scripts/local-mongo.sh`) | A real, always-on database | MongoDB Atlas (has a GCP-hosted region option — simplest, since it's the same MongoDB, just managed) or a self-hosted Mongo on a GCE VM. Either way: export the local data (`mongodump`), import into the new instance (`mongorestore`), update `MONGODB_URI`. |
| `npx tsx server.ts` run directly, kept alive by a human remembering to restart it | An always-on backend process | Cloud Run (containerize with a `Dockerfile` — the app has no native dependencies that would complicate this) is the natural fit: stateless, scales to zero, and deploys are themselves a full process restart, which incidentally makes the "server ran on stale code for 25 hours" class of bug structurally impossible — a new deploy *is* a fresh process. |
| `scripts/restart-server.sh` + daily 6am cron | Working around a long-lived process never picking up code changes | Not needed on Cloud Run — every deploy already replaces the running instance. If GCP ends up being a GCE VM instead of Cloud Run, keep the idea (a scheduled restart) but move it to a GCP-native scheduler (Cloud Scheduler triggering a Cloud Function, or a systemd timer on the VM) instead of a local crontab. |
| `scripts/expose-server.sh` (cloudflared quick tunnel) | Making a machine with no public IP reachable from the internet | **Disappears entirely.** GCP resources get real public IPs/load balancers by default. Point a real domain at it (Cloud DNS, or keep using Cloudflare for DNS if that's already set up — a proper *named* Cloudflare Tunnel would also work here as a permanent option instead of GCP's own networking, if there's a reason to prefer that, but the default GCP path doesn't need cloudflared at all). |
| `scripts/demo-account-linker.ts` run as a long-lived local process (`npm run demo-linker`) | A periodic background job | Cloud Scheduler + Cloud Run job (or a Cloud Function on a schedule) — the script's logic doesn't change at all, just how it's invoked (cron-in-a-loop locally → a real scheduled trigger). |
| `public/admin.html` + `/admin/api/places`, no auth | A trusted-operator-only tool, fine when only reachable via localhost | **Needs real auth before this is exposed on GCP** — it was explicitly built no-auth on the assumption it's local-only. Don't deploy this route publicly without adding at least basic auth first. |

## Also worth remembering at migration time

- **`.env`** is gitignored and never committed — the GCP equivalent secrets (`MONGODB_URI`,
  `JWT_SECRET`, `SENTRY_DSN`) should go into GCP's own secret management (Secret Manager),
  not a checked-in file there either.
- **`JWT_SECRET`** — the one currently in local `.env` can be reused on GCP if convenient
  (existing tokens would keep validating), or rotated for a clean start (existing logged-in
  sessions would need to re-login) — either is fine, just a deliberate choice rather than an
  accident.
- The real OAuth deferral (still just name+email login) and the other roadmap items tracked
  throughout `CHANGELOG.md` are unrelated to this migration — moving to GCP doesn't require
  or imply solving any of those, it's purely an infrastructure change.
