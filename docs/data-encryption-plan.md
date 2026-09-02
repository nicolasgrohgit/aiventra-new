# Per-user field-level encryption at rest

Not attempted this pass — planning only, flagged for the roadmap. Requested directly: real
OAuth (`docs/useauth-split-plan.md`'s auth core, the "real OAuth" deferral tracked throughout
`CHANGELOG.md`) will widen what this app touches — real Google identity, and likely real
Google Calendar data eventually, not just the device-local calendar sync that exists today.
Getting encryption-at-rest right *before* that lands is the point: it's much cheaper to design
key management once than to retrofit it after real OAuth tokens and a broader calendar
integration are already live.

## Why calendar data specifically triggered this

`POST /api/trips/:tripId/events/import` (`server.ts`) already syncs a user's real device
calendar into MongoDB verbatim — `title`, `location`, `start_time`, `end_time` land in `Event`
documents (`source: 'imported'`, see `models/Event.ts`) with no transformation. A calendar
title/location is some of the most sensitive data this app touches by nature — it can reveal
medical appointments, legal matters, client names, home/work addresses — and today it sits in
MongoDB in plaintext, readable by anything with DB access (including, currently, the no-auth
`public/admin.html` route flagged in `docs/gcp-migration.md`).

## The broader ask: encrypt per-user, not just calendar fields

Requested scope is wider than calendar data alone — every user's stored data encrypted with a
key unique to that user, AES-256. Candidate fields, grounded in the actual schemas
(`models/*.ts`):

- **`Event`**: `title`, `location`, `place_name` — free-text, never filtered/sorted on
  server-side queries today (`GET /api/trips/:tripId/events` filters by `trip_id` and
  participant membership only, never by title/location text).
- **`User`**: `preferences.*` (dietary, budget, genres — arguably sensitive-ish, low priority),
  `full_name`. NOT `email` — it's the unique lookup key for login and the friend-request-by-
  email flow (`server.ts`), so encrypting it breaks `findOne({ email })` unless paired with a
  separate deterministic hash column just for lookup — a real complication, not a rounding
  error.
- **`Contact`**: whatever free-text fields exist there beyond the `circle_tags` used for
  filtering.
- **`Trip`**: destination/notes-type free text, if any exists beyond structured fields used in
  queries (`baseLocations`, dates — those need to stay plaintext/queryable).

**Deliberately NOT everything, despite the literal ask** — fields that are the target of a
server-side Mongoose query, sort, or index (`trip_id`, `user_id`, `start_time`/`end_time`
range queries for scheduling, `email` lookups, `circle_tags` filtering) can't be transparently
encrypted without either losing that query capability or adding deterministic encryption
(which leaks equality patterns — a real trade-off to make consciously per field, not a default).
The right scope is "free-text/sensitive content fields," decided field-by-field, not a blanket
schema-wide encrypt.

## Proposed approach

- **Per-user AES-256-GCM** (authenticated encryption, not bare CBC — integrity matters here,
  not just confidentiality), via Node's built-in `crypto` module. No new dependency — consistent
  with this project's existing pattern of avoiding new infra when the platform already covers
  it (`lib/weather.ts`, `lib/geocoding.ts` picking no-key providers; `lib/avatar.ts` doing
  client-side downscaling instead of standing up object storage).
- **Envelope encryption**, not a single global key: at signup (or on first write needing
  encryption, for existing users), generate a random 256-bit data key per `User`. That key
  itself gets encrypted ("wrapped") by a single master key and stored on the `User` document as
  `encryptedDataKey`. Losing the master key doesn't mean one leaked user record compromises
  every other user's key material, and per-user key rotation/revocation becomes possible later
  (e.g. on account deletion, just discard the wrapped key — the underlying ciphertext becomes
  permanently unreadable, a clean "crypto-shredding" deletion story for free).
- **Where the master key lives is the actual hard part**, and it's a dependency on
  `docs/gcp-migration.md`, not solvable well locally: today's `.env` (plaintext file, gitignored
  but still just a file on disk) is not a real key management story. This needs a proper KMS
  (GCP's Cloud KMS, or Secret Manager as a lighter option) — meaning this work is realistically
  sequenced *with or after* the GCP migration, not fully resolvable in the current local-beta
  setup. A local-only stopgap (master key from an env var) could unblock building the
  encrypt/decrypt plumbing and schema changes now, with the real KMS swap-in deferred to match
  the GCP move — but that stopgap should be explicit and temporary, not quietly permanent.
- **Where encryption/decryption happens**: application-level, not MongoDB's own encrypted
  storage engine — Mongoose middleware (`pre('save')` to encrypt, a `post('find'/'findOne')`
  hook or explicit helper to decrypt) on the specific fields chosen above, mirroring the
  existing `lib/avatar.ts`-style pattern of a small dedicated `lib/` helper rather than scattering
  crypto calls through route handlers.

## Migration

Existing plaintext records (already-imported calendar events, existing user data) need a
one-time backfill script (same shape as `scripts/seed-curated-places.ts` et al.) to generate
each user's data key and re-write their existing documents through the new encrypt path. Not
designed here — sequencing depends on which fields are chosen and when the master-key story
lands.

## Explicitly out of scope for this doc

- No code changes made — this is the plan, not the implementation.
- Transport security (HTTPS via the Cloudflare tunnel today, TLS on GCP later) is a separate,
  already-adequate concern; this doc is about data at rest in MongoDB specifically.
- Client-side (on-device AsyncStorage) encryption is a related but separate question — not
  covered here.
