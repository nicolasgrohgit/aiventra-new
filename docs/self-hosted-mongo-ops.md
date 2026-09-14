# Self-hosted MongoDB on GCE — operations reference

Odys.ai's database moved twice in two nights: local laptop → MongoDB Atlas (M0) → this
self-hosted setup. The Atlas hop is documented in `docs/gcp-migration-runbook.md`; this doc
covers why and how we moved off Atlas, and how to operate what's here now.

## Why not Atlas

Atlas M0 (free tier) needed `0.0.0.0/0` in Network Access, since Cloud Run has no static
egress IP by default — a real, if mitigated (strong password + TLS), network exposure. Atlas
also bills separately from GCP entirely, so any fix there (a paid tier for Private Service
Connect, or a VPC connector + Cloud NAT + static IP just to narrow the whitelist) either cost
real money or didn't touch the GCP credits at all. With zero users yet, self-hosting real
MongoDB on a free-tier GCE VM, reachable only over Cloud Run's private "Direct VPC egress" (no
VPC connector, no public IP anywhere), was a better fit: genuinely free, fully private by
construction, and zero compatibility risk (it's real MongoDB — unlike Firestore's MongoDB
compatibility layer, which was evaluated and ruled out: `$geoNear`, the aggregation stage
`lib/place-matching.ts` depends on for all place-matching, isn't supported there at all, only
the more limited `$near` find-query, and that's preview-only).

**The honest trade-off**: this makes us responsible for what Atlas managed — OS/Mongo
patching, and backups. Reasonable to take on deliberately at zero-user scale; revisit if/when
real usage and uptime expectations grow.

## Architecture

- **VM**: `odysai-mongo`, `e2-micro` (GCP Always Free tier), zone `us-central1-a`, **no external
  IP** — internal IP `10.128.0.2` on the `default` VPC/subnet (`10.128.0.0/20`).
- **MongoDB**: 7.0.43 Community Edition, `bindIp: 127.0.0.1,10.128.0.2` (explicitly the loopback
  + this VM's own internal IP — not `0.0.0.0`), `security.authorization: enabled`. Two users:
  `root_admin` (full admin, for backups/maintenance) and `odysai_app` (`readWrite` scoped to
  just the `odysai` database — what the running app actually uses).
- **Network isolation**: the VM has zero inbound exposure from the public internet (no external
  IP, and no firewall rule opens Mongo's port 27017 beyond the existing `default-allow-internal`
  rule, which only covers `10.128.0.0/9`). Cloud Run reaches it via **Direct VPC egress**
  (`--network=default --subnet=default --vpc-egress=private-ranges-only` on the `odysai-server`
  Cloud Run service) — no VPC Connector, no standing connector cost, scales to zero with the
  service itself.
- **Outbound internet for the VM** (needed for `apt` package installs/updates — a VM with no
  external IP otherwise has zero egress) goes through **Cloud NAT**: router `odysai-router` +
  NAT gateway `odysai-nat`, both in `us-central1`, outbound-only (does not add any inbound
  exposure). This has a small real ongoing cost (not Always-Free-tier-covered) — the trade-off
  accepted for keeping the VM patchable rather than a one-shot temporary external IP.
- **Credentials**: `MONGODB_URI` (Secret Manager, version 2 — version 1 was the now-retired
  Atlas string) points at `10.128.0.2`. `MONGO_ADMIN_PASSWORD` (Secret Manager) holds
  `root_admin`'s password for maintenance/backup use — not consumed by the running app, kept
  here so it isn't only readable by SSHing into the VM.

## Backups

- **`gs://odysai-mongo-backups`** (`us-central1`, uniform bucket-level access), 30-day object
  lifecycle (auto-deletes older backups — adjust if you want longer retention).
- **Schedule**: `mongo-backup.timer` (systemd, on the VM) — `OnCalendar=*-*-* 07:00:00`, VM
  timezone set to `Europe/Paris` so this naturally follows CET/CEST DST shifts without any
  manual UTC-offset math. `Persistent=true`, so a missed run (VM off at 7am) catches up on next
  boot.
- **What it does** (`/opt/mongo-backup/backup.sh`, runs as root): `mongodump` (as `root_admin`,
  so it captures everything, not just the `odysai` database) → `tar.gz` → upload to the bucket
  → delete the local copy. Logs to `/var/log/mongo-backup.log`.
- **Verified working end-to-end**, not just "should work": ran it manually, confirmed the
  resulting object landed in the bucket, then downloaded that exact object, extracted it, and
  restored it into a throwaway database, confirming all 808 documents came back correctly.

### Restoring from a backup

```bash
gcloud compute ssh odysai-mongo --zone=us-central1-a --tunnel-through-iap --command='
gcloud storage cp gs://odysai-mongo-backups/<TIMESTAMP>.tar.gz /tmp/restore.tar.gz
mkdir -p /tmp/restore && tar -xzf /tmp/restore.tar.gz -C /tmp/restore
mongorestore --uri="mongodb://root_admin:<password from MONGO_ADMIN_PASSWORD secret>@localhost:27017/?authSource=admin" \
  --db=odysai --dir=/tmp/restore/mongo-backup-<TIMESTAMP>/odysai --drop
rm -rf /tmp/restore /tmp/restore.tar.gz
'
```
**Gotcha found and worth remembering**: the `mongodb-database-tools` version installed via apt
on this VM (100.18.0) does **not** correctly infer the database name from a dump directory's
name the way older versions (e.g. 100.10.0, used elsewhere in this project's tooling) do —
plain positional-argument restores or `--nsFrom`/`--nsTo` remaps silently failed with "don't
know what to do with file" for every file. **Always pass `--db=<name>` and `--dir=<path>`
explicitly** on this VM; don't assume the shorthand from other machines' mongorestore versions
carries over. (`--drop` above replaces existing collections during a real restore — omit it
when restoring into a fresh/throwaway database for verification, matching how the test above
was actually run.)

## Operating the VM

- **SSH**: `gcloud compute ssh odysai-mongo --zone=us-central1-a --tunnel-through-iap` (IAP
  tunneling, since there's no external IP — this is expected, not a workaround).
- **Service account**: the VM runs as the project's default Compute Engine service account,
  scoped to the broad `cloud-platform` OAuth scope (needed for `gcloud storage cp` in the
  backup script to work at all — the default, narrower `devstorage.read_only` scope silently
  can't write) — actual access is still restricted by IAM: `roles/storage.objectAdmin` on just
  the `odysai-mongo-backups` bucket, nothing project-wide.
- **If you change the VM's service account/scopes**: root's own `gcloud` credential cache
  (`/root/.config/gcloud/access_tokens.db`) does not automatically pick up a scope change even
  after a full instance restart — delete that file (`sudo rm /root/.config/gcloud/access_tokens.db`)
  to force a fresh token fetch, or the old cached (and now wrong-scoped) token keeps getting
  reused. Confirmed live: this exact thing happened during setup.
- **OS/Mongo patching**: nobody's automating this yet — it's manual, on you, via SSH + apt.
  Worth a periodic calendar reminder given there's no managed patching like Atlas provided.

## Rollback

The Atlas M0 cluster (`odysai` on `odysai.7vobh1g.mongodb.net`) was **not deleted** — it's just
no longer referenced by `MONGODB_URI` (Secret Manager still has the old connection string as
version 1, retrievable via `gcloud secrets versions access 1 --secret=MONGODB_URI`). If the
self-hosted setup has a problem, reverting is: get that old version, `gcloud secrets versions
add MONGODB_URI --data-file=-` with it (or redeploy `--set-secrets=...MONGODB_URI:1`), and
redeploy Cloud Run — no data migration needed for a same-day rollback since Atlas's own copy
wasn't touched. Whether to actually delete the Atlas cluster (it's free either way, so nothing
is saved by removing it) is an open decision, not automatically done here.
