# A "Have a suggestion for Odys.ai?" link on Profile

Not attempted this pass — design only. Nico's request: a link on the Profile screen opening a
form with the user's name auto-filled, a 1500-character text box, and Send/Back buttons; Send
emails `admin@odys.ai`.

## Where it goes, grounded in the actual screen

`app/(tabs)/profile.tsx` already ends its `ScrollView` with a small run of standalone action
cards/buttons in a fixed order (lines 348-363): the "About" card (`onPress={() =>
setShowVersionModal(true)}`, showing app version + "View Changelog"), then **Save Changes**,
then **Sign Out**. The natural slot is a new row between "About" and "Save Changes" — it's
account/meta-level like About, not a preference like the `OptionRow`/`ConfigRowModal` rows
above it, and putting it after Save/Sign Out would bury it under the two highest-intent
buttons on the screen. Concretely: a `TouchableOpacity` styled like the existing
`engineConfigCard` (reuse `styles.cardHeader`/`styles.cardDesc`, header "Have a suggestion for
Odys.ai?", description something like "Tell us what's missing or what could be better") that
opens a new modal, `setShowSuggestionModal(true)`.

**Name source**: `models/User.ts:6` (`full_name?: string`) is the only display-name field on
the schema — `useAuth`'s `user` object carries it straight through (no separate "display name"
concept exists anywhere else in this codebase, e.g. `hooks/useAuth.tsx` reads/writes `user.*`
directly, no derived name getter). Auto-fill from `user?.full_name` unconditionally.
Recommend **read-only** for this field: the field exists purely for admin@odys.ai to know who
sent the suggestion, and Odys already has a real, dedicated place to edit `full_name` (Profile's
own top section) — letting someone type a throwaway name into the feedback form and diverge
from their account name adds a confusing second source of truth for no real benefit.

## The modal: new component, following the `VersionHistoryModal` extraction pattern exactly

`components/profile/version-history-modal.tsx` is the closest sibling — a `Modal` with
`presentationStyle="pageSheet"`, a `modalHeader` with title + close/back action, passed
`visible`/`close` props and rendered as one more `<XModal .../>` alongside profile.tsx's
existing `GenericSelectionModal`/`CategorizedSelectionModal`/`VersionHistoryModal` block
(lines 365-369). Propose `components/profile/suggestion-form-modal.tsx` with the same shape:
`{ visible, close }` props (no `history`-style data prop needed — it manages its own text-box
state and submit call internally).

**Form contents**:
- Header row: title "Have a suggestion?" + a **‹ Back** control in the header (matching the
  session's now-established back-button convention for anything a user can navigate into —
  see the onboarding/circle-picker back-button work already shipped this session), rather than
  a bare "Close" label like `VersionHistoryModal` uses — this screen has real unsaved-input
  state a user might want confirmation before losing, unlike a read-only version list. (Not
  proposing a discard-confirmation dialog here — that's a judgment call for whoever builds
  this, flagged, not designed.)
- Read-only name display: `user?.full_name` in a plain `Text`, not an editable `TextInput` per
  above.
- The text box: **there is no existing precedent to reuse.** Confirmed by search — no
  `multiline` or `maxLength` prop appears anywhere in `app/` or `components/` today. This is a
  net-new pattern for the app. Recommend a standard RN `TextInput` with `multiline`,
  `maxLength={1500}`, a sensible fixed height (e.g. `numberOfLines={8}`-ish sizing via a fixed
  `minHeight`, since RN's `numberOfLines` doesn't reliably cap multiline height across
  platforms), and a live "`{1500 - text.length} characters left`" counter below it — silently
  truncating at 1500 with no visible feedback would be a worse experience than showing the
  budget as they type, and costs one derived value in render.
- **Send** button, disabled while the text is empty (whitespace-only should count as empty) or
  while a submit request is in flight (a simple local `isSubmitting` boolean — this app already
  has that pattern for `handleSave`/`handleSaveTrip` elsewhere, nothing new to invent here).
- **Back** button (secondary, closes without submitting) — separate from the header's back
  control per Nico's literal request ("send and back button"); recommend keeping both rather
  than treating the header control as sufficient, since it costs nothing and matches how
  `trips.tsx`'s own modals generally pair a header close with an in-body cancel/secondary
  action.

## Backend: a new endpoint, and a hard blocker worth designing around rather than deferring on

**Confirmed: this codebase has no email-sending capability at all today.** No
`nodemailer`/`sendgrid`/`mailgun`/`@aws-sdk/client-ses`/`smtp` reference anywhere in
`package.json` or `server.ts`. The `CHANGELOG.md` "Roadmap noted" entry and
`docs/gcp-migration.md`'s local-only-needs-replacement table (both added just before this doc)
already track the actual fix — standing up a real mail relay/mailbox for `support@odys.ai`/
`admin@odys.ai` on GCP. **This feature is blocked from actually delivering mail until that
lands.** Rather than block the whole feature on that infra landing first, apply this
codebase's own established "build it, make the missing piece a clean no-op until configured"
pattern — the same shape `lib/google-places-client.ts` already uses (returns `[]`, never
throws, until `GOOGLE_PLACES_API_KEY` is set, with `lib/places-population.ts`'s synthetic
fallback picking up the slack) and the deployed pattern for `SENTRY_DSN` (present in
`server.ts`'s already-portable env-var list, optional, app runs fine without it).

Concretely, propose:
- A new minimal Mongoose model, `models/Suggestion.ts` — `{ user: ObjectId (ref User), text:
  string (maxlength 1500, matching the client cap), createdAt: Date, emailed: boolean }`. This
  is the actual source of truth: the suggestion is durably saved the moment Send succeeds,
  independent of whether email ever goes out. Given the live-DB-encryption incident earlier
  this session, note explicitly: this is new, low-sensitivity, low-volume data — no case here
  for the per-field encryption pattern applied to `Event`, but any migration/backfill on this
  collection still falls under the same "never run against the shared live Mongo without a
  backup first" rule now standing for the whole project.
- `POST /api/suggestions`, `authenticate`-gated (consistent with every other write endpoint in
  `server.ts`, e.g. `POST /api/contacts` at line 1211) — body `{ text: string }`, server reads
  the user from the authenticated request (never trust a client-supplied name/id, matching
  `USER_UPDATABLE_FIELDS`-style hardening from this session's security pass). Handler: (1)
  validate `text` non-empty and ≤1500 chars server-side too (never trust the client-side cap
  alone); (2) create the `Suggestion` document; (3) attempt an email send via a new
  `lib/mailer.ts` — a thin wrapper that is a **safe no-op returning success-shaped-but-
  `sent: false` when no mail-relay env var (e.g. `SMTP_URL` or a provider API key) is
  configured**, and does a real send once the GCP roadmap item lands, no server.ts changes
  needed at that point; (4) respond `200` either way, since the suggestion is already durably
  saved regardless of the email outcome — the user shouldn't see an error for an email-relay
  gap that isn't their problem to know about.
- This also means, incidentally, a suggestion never gets silently lost even once the email
  relay exists and has a bad day (rate limit, transient SMTP failure) — `emailed: false` rows
  in `Suggestion` are a trivial admin query/retry-later path, which the plain "just fire an
  email and don't persist anything" version of this feature wouldn't have had. This isn't
  scope creep — it's an artifact of the only real way to make the feature usable before its
  email dependency exists, not a target to hit in its own right.

## Explicitly out of scope for this doc

- No code written — proposal only.
- The GCP email-server/relay setup itself (Workspace mailboxes, SMTP/SES/SendGrid choice) is
  the separate roadmap item already logged in `docs/gcp-migration.md`/`CHANGELOG.md` — not
  decided here.
- No admin-facing UI for reading submitted `Suggestion` documents is proposed — until the
  email relay exists, `admin@odys.ai` (or a direct `mongosh` query, matching how this session's
  own DB-incident cleanup was done) is the only way to read them; a proper admin view is a
  later, separate ask if this volume ever justifies it.
- Discard-confirmation on Back with unsaved text is flagged, not designed.
- Rate-limiting `POST /api/suggestions` against spam/abuse isn't addressed here — `strictLimiter`
  already exists in `server.ts` and is a one-line addition whenever this is actually built, but
  choosing its exact threshold is an implementation detail, not a design question.
