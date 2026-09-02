# Circles feature proposal

Research + design proposal, written pre-implementation. No code changes accompany this
document. It answers: what's actually missing from the Circles tab, and are 1:1 chat and a
visual redesign the right levers to fix it. Per the product owner's brief, the three-circle
taxonomy (`Family and Friends` / `Relatives` / `Work`) stays as-is — this doc doesn't
re-litigate that structure, only what's built on top of it.

## What's actually missing, grounded in the current code

Five concrete gaps, in order of how surprising they are once you actually read
`app/(tabs)/social.tsx` against what it claims to do. (Gap #5 added later, flagged directly by
the product owner rather than found in this read-through.)

### 1. The tab's own subtitle promises a feature that doesn't exist in it

`social.tsx`'s header reads: *"Manage privacy and discover nearby friends."* The "manage
privacy" half is real (see #2). The "discover nearby friends" half is not — there is no
nearby-friends UI anywhere in this file. The actual mechanic that phrase refers to,
`GET /api/friends-nearby` (circle-scoped, sharer-driven presence discovery — see
`server.ts:336`), is real and working, but it's wired into exactly one place:
`app/(tabs)/trips.tsx`, inside the trip-creation/propose-recommendation flow, gated behind
having a trip open for a specific city and date range. The Circles tab — the screen whose own
copy claims to do this — has zero code path to it.

This is the single most concrete, cheapest-to-fix gap in this doc, and it doesn't require
chat or a redesign: wire `useEvents().getFriendsNearby` into `social.tsx` itself, scoped to
the user's home city or "right now" rather than a specific trip's dates. A user should be
able to open Circles and see "3 people from your Work circle are near you" without first
having created a trip. This is arguably a **higher-leverage change than either of the two
things the product owner asked about**, precisely because it's not new infrastructure — it's
exposing an endpoint that already exists and already respects circle-scoped privacy, in the
one screen that already claims to offer it.

### 2. Circle assignment is privacy-relevant, but the UI doesn't explain how, and the mechanism is non-obvious (asymmetric, sharer-driven)

Circles are not purely organizational — confirmed by reading `server.ts` and
`models/User.ts`/`models/Trip.ts`, not assumed. `User.homebaseSharedCircles` and
`Trip.sharedWithCircles` are real opt-in visibility gates: a user chooses which circles can
see their homebase or an upcoming trip (via `CircleShareSelector`, used in both
`profile.tsx` and `trips.tsx`). `GET /api/friends-nearby` then cross-references *their*
sharing choice against *your* `circleTags` on *them* — i.e., whether you're a candidate to
see someone's presence depends on which circle **you put them in**, checked against which
circles **they opted to share with**.

That's a real, working, sensibly-designed privacy model. The problem is that `social.tsx`'s
"move contact to circle" bottom sheet — the only screen where a user actually assigns
`circleTags` — gives almost no indication this is what's happening. Its copy: *"Assign them
to a new Circle privacy tier"* (`social.tsx:124`). That's a hint, not an explanation, and the
direction it implies is backwards from how most users would read "privacy tier" — a user
moving someone into "Work" is likely to assume this affects *what that person can see about
them*, when the actual effect (via `homebaseSharedCircles`/`sharedWithCircles`) is the
opposite: it affects *what of that person's shared presence becomes visible to you*, and only
if they've separately opted their own sharing into that circle name. `CircleShareSelector`
itself does this correctly elsewhere (`"Lets people in these circles see you're heading here
on these dates, so they can notice and invite you"` — `trips.tsx:1438`); the move-contact
sheet in `social.tsx` should say something equivalently concrete, not leave the mechanism
implicit.

This is worth surfacing to the product owner directly because it's a genuine privacy-UX gap,
not a cosmetic one: a user could reasonably believe moving a work colleague into "Work"
*protects* their privacy from that person, when the actual code path is about *what the user
can see of the colleague*, contingent on the colleague's own separate opt-in. Worth a copy
fix at minimum; worth product discussion if the mental model needs to change.

### 3. The data model supports multi-circle tagging; the UI doesn't

`Contact.circleTags` is typed and stored as `string[]` (`lib/contacts.ts:6`,
`models/Contact.ts`), and `MOCK_CONTACTS` even implies multi-tag is a legitimate shape. But
`social.tsx`'s `handleMoveContact` always writes `circleTags: [newCircle]` — a full
replacement, not a toggle — making the UI behave like a single-select radio group despite the
underlying model being a set. A colleague who's also a genuine friend (extremely normal for
a "bleisure" traveler, the exact audience `CLAUDE.md` describes) has no way to be tagged as
both `Work` and `Family and Friends` today, which matters concretely for gap #2: their
visibility into your presence is entirely determined by which single circle you filed them
under, even though the real relationship spans two.

This is a small, contained fix (toggle behavior in the bottom sheet instead of
replace-on-select) that doesn't touch the taxonomy the product owner asked to leave alone —
worth bundling with whatever ships next regardless of the chat/visualization decision.

### 4. Pending (not-yet-joined) contacts are a dead end after the initial invite

`social.tsx`'s invite flow (`handleSendInvite`) creates a `pending_` contact from an email
with no `isAppUser` and no further action available on it beyond the static "Pending — hasn't
joined yet" label. There's no resend, no "copy invite link," no indication of when the invite
was sent. Given `docs/monetization-strategy.md` and this doc both point at the friends-graph
mechanic as core product value (not a bolt-on), a dead invite with no recovery path is a real
leak in the onboarding funnel worth a follow-up, even though it's outside what was explicitly
asked here.

### 5. A contact can be re-circled but never actually removed

`social.tsx`'s "Move Contact" bottom sheet — the only action available when tapping a
contact — offers circle reassignment and nothing else; there's no "Remove Friend"/"Delete
Contact" action anywhere in the UI. This isn't a backend gap: `DELETE /api/contacts/:id`
already exists and works (`server.ts:1065`, scoped to `owner_user_id` so it can't delete
someone else's contact), and `hooks/useAuth.tsx`'s `setContacts` already calls it internally
when its old-vs-new array diff detects a contact was dropped from local state — but nothing in
`social.tsx` ever produces that diff, since there's no button that removes a contact from the
array in the first place. A user who wants to actually stop being connected to someone (not
just re-file them into a different circle) has no way to do that today. Straightforward to add
alongside gap #3's circle-toggle work — a destructive action in the same "Move Contact" sheet,
presumably with a confirmation step given it's irreversible.

## Chat: recommendation is to defer, and replace the underlying need with something lighter

### The literal ask, taken seriously

The brief flags that "maybe" is doing real work. Taking it seriously as a genuine option
rather than defaulting to "no": 1:1 chat would directly serve pillar three of the product
(`CLAUDE.md`: *"catching up with friends who are in or near that city"*) if the friends-nearby
mechanic actually starts surfacing real overlaps between real users. The case *for* it isn't
weak in principle — it's weak *for this stage*, for three concrete, code-grounded reasons.

**There is no chat infrastructure to extend — this would be new, not incremental.**
Confirmed by reading the repo, not assumed: no `Message`/`Conversation` model exists, no
`/api/messages` route exists, and `package.json` has no websocket dependency (`socket.io`,
`ws`, `pusher`, etc. — none present) and no push-notification dependency
(`expo-notifications` is not installed either). This last point is corroborated by the app's
own UI copy: `trips.tsx:1020` literally says *"No push notifications yet — check back here to
see what you've been invited to,"* about event invites, a feature that already exists and
still has this problem. Chat without either real-time delivery or push is a materially worse
product than the messaging apps already on every phone — messages would only appear when a
user happens to have the Circles tab open and foregrounded, an odd UX regression to introduce
deliberately.

**The comparable-product pattern argues against it.** `docs/monetization-strategy.md`
already treats Partiful as a direct comp (social plan-making for real-world meetups). Partiful
has *no in-app chat* — it deep-links into whatever messaging app the group already uses
(iMessage/group SMS/WhatsApp) rather than competing with them. Beli, also already cited as a
comp in that doc, has no 1:1 DM either — its social layer is rankings/lists/following, not
messaging. Neither app treats "people need to talk to each other" as "we should build a
messenger." Wanderlog's closest analog is itinerary-item comments (contextual, asynchronous,
attached to a specific plan), not a general-purpose chat surface — also not what's being
proposed here. The pattern across every comp already in this codebase's own research is:
**build the coordination mechanism (the plan, the discovery signal), don't build the
conversation layer** — the conversation layer already has incumbents with network effects
Odys cannot match at this stage (early beta, no messaging users to migrate).

**It doesn't fit the app's current investment priorities.** `docs/monetization-strategy.md`'s
central argument is protecting a not-yet-trusted free core loop before adding friction;
`docs/ad-monetization.md` independently confirms this is a low-frequency, high-intent app (a
few opens per trip, not a chat app's expected dozens of opens per day). A messaging feature is
the single feature category most dependent on high engagement frequency to feel alive — a 1:1
chat where the other person is realistically unlikely to see your message for hours (no push)
is worse than not having one, because an empty/dead chat UI reads as an abandoned feature.

### The lighter-weight alternative: recommend this instead

Replace "message a circle member" with a **share-sheet deep-link**, not new backend
infrastructure. Concretely: an action on a contact card / future nearby-friends card
(`social.tsx`, and the trips.tsx friends-nearby surfacing) that opens the OS-native share
sheet (React Native's `Share.share()` — no new dependency, no EAS rebuild required, unlike
essentially everything else a "chat feature" would touch) with a prefilled, context-aware
message, e.g.: *"I'm in Paris until Friday — free Tuesday evening if you want to grab
dinner?"* The user picks their own channel (iMessage, WhatsApp, email, whatever they actually
use with that person) and the message lands through infrastructure that already has delivery
guarantees, push notifications, and read receipts Odys would otherwise have to build from
scratch.

This is strictly client-side, ships fast, and directly serves the stated underlying need
("catching up with friends... near that city") without competing with incumbent messengers on
their own turf. It also sidesteps a real, unaddressed question a chat feature would force:
Odys has no blocking/reporting/moderation surface anywhere today, and 1:1 chat is the first
feature category where that becomes a hard requirement, not a nice-to-have.

**Revisit chat when both of these are independently true, not on a calendar date:** (a) the
friends-nearby mechanic is proven — i.e., gap #1's fix ships and actually produces real
"people near me" surfacing at meaningful volume, so there's evidence coordination is the
actual bottleneck, not discovery; and (b) push infrastructure gets built — which is worth
doing regardless of chat, since `trips.tsx` already flags its own invite-notification gap.
Chat is cheap to add *on top of* push infra once it exists for another reason; it's expensive
to justify building push infra *for* chat alone at this stage.

### If chat is built anyway (v0 technical scoping)

In case the product owner wants to proceed despite the above — scoped honestly, not padded to
look bigger or smaller than it is:

**`models/Message.ts`** (new):
```ts
interface IMessage {
  // 1:1 only for v0 — no group chat. Deriving conversation identity from a sorted pair of
  // user IDs avoids a separate Conversation model; add one later only if group chat is scoped.
  participant_ids: [ObjectId, ObjectId]; // sorted, so a query on either order matches
  sender_id: ObjectId;
  text: string;
  read_at?: Date;
  created_at: Date; // via timestamps: true
}
```
Index on `participant_ids` for the conversation-fetch query, and on `sender_id` if unread
counts are queried across all conversations for a badge.

**Endpoints** (new, in `server.ts`, following the existing `authenticate` middleware
pattern already used by `/api/friends-nearby`/`/api/events/*`):
- `GET /api/messages/:contactUserId` — paginated (`?before=<messageId>`), sorted
  `created_at: -1`, then reversed client-side for display.
- `POST /api/messages` — `{ toUserId, text }`. **Gate on mutual linkage**: only allowed if a
  `Contact` document exists with `contact_user_id: toUserId` pointing back (reuse the existing
  `Contact.contact_user_id` linkage — don't allow messaging an arbitrary user ID). This
  matters more for chat than it does for friends-nearby, because friends-nearby only leaks a
  presence signal; unrestricted messaging is a direct spam/abuse vector.
- `PUT /api/messages/:id/read` — mark read, for a basic unread-count badge.

**Real-time: polling, not websockets, for v0.** Confirmed no websocket infra exists anywhere
in this codebase — introducing one (Socket.io, or a managed service like Pusher/Ably) is a
meaningfully larger, separate infrastructure decision than the chat feature itself, and this
app already has a working precedent for "foreground poll, no push" (`invitedEvents` in
`trips.tsx`, `getFriendsNearby` in `hooks/useEvents.tsx` — both fetch-on-focus, swallow
errors, no live channel). A chat screen polling `GET /api/messages/:contactUserId` every
few seconds while focused, plus a poll-on-app-foreground unread-count check for the badge, is
consistent with the rest of the app's existing patterns and ships without a new
infrastructure dependency. This is a genuine UX tradeoff (no typing indicators, a few
seconds of latency) worth stating plainly, not hiding — it is not real-time chat, it's a
message board with a chat-shaped UI.

**Not included in v0, flagged explicitly:** group chat, typing indicators, message
deletion/editing, blocking/reporting (a hard requirement before this should ship broadly, not
a v1 nice-to-have — see above), media/image messages, push notifications for new messages
(same gap `trips.tsx` already has for invites).

## Visualization: concrete proposal for the Circles tab

Constraint check before proposing anything: `package.json` has **no SVG library**
(`react-native-svg`, Skia, Victory, D3 — none present) and no animation library beyond
`react-native-reanimated`, which is already a dependency. This matters because it's the same
category of constraint `docs/ad-monetization.md` already flagged for AdMob: a genuine
node-link network graph (force-directed layout, connecting lines between people) needs an SVG
or canvas renderer, which means a new native dependency and an EAS rebuild before it can be
tested at all — not a small ask for what's fundamentally a decorative upgrade to a list
screen. Recommending against that path primarily for this reason, not because a graph
wouldn't look nice.

**Recommendation: grouped avatar clusters, not a network graph.** Concretely:

- Replace the flat, uniform contact-card list with **three horizontally-scrollable clusters**,
  one per circle (`Family and Friends` / `Relatives` / `Work`), each rendered as a cluster of
  overlapping circular avatars (imagine iOS's group-call participant stack, or a Slack
  channel's member-avatar row) with a circle-name header and count. Tapping a cluster expands
  it into the existing flat list (reuse the current `contactCard` rendering — don't throw that
  away, it's fine as the expanded/detail view).
- **Presence becomes a visual property of the avatar itself**, not a separate badge row: an
  avatar for someone currently flagged `nearby` (once gap #1 ships) gets a colored ring/glow
  (reuse the app's existing `#3B82F6` accent, already used for `locationBadge` in
  `social.tsx`) directly on the avatar in the cluster view, so "who's near me right now" is
  visible at a glance across all three circles without opening any of them — this is the
  actual "pretty visualization" payoff: making the thing gap #1 unlocks *visible*, not just
  accessible.
- **Overlap (multi-circle contacts, once gap #3 ships) shown as the avatar appearing in both
  clusters** rather than inventing a Venn-diagram/graph representation — simpler to build
  (same avatar component, rendered twice, no new visual language), and more legible on a
  phone-width screen than an actual overlap diagram would be.
- Buildable entirely with `View`/`Image`/`ThemedText` plus `react-native-reanimated` for the
  expand/collapse transition — zero new dependencies, no EAS rebuild, fits the existing
  dark/card visual language in `social.tsx` (`#0F172A` cards, `#3B82F6` accent) without
  introducing a second design language.

**If a network-graph layout is still wanted later** (e.g. once "mutual circles" or friend-of-
friend relationships become a real feature — they aren't today, `friends-nearby` is one-hop
only), that's a legitimate v2 direction, but it should be scoped as its own decision once
`react-native-svg` (or Skia) is already justified by something else, not introduced solely to
make the Circles tab prettier.

## What this deliberately doesn't cover

- **The actual redesigned visual mockup/Figma** — this doc describes the cluster concept and
  what data drives it (circle grouping, presence ring, multi-circle overlap), not pixel-level
  layout, spacing, or a component implementation.
- **Whether the three-circle taxonomy itself should ever change** — explicitly out of scope
  per the brief; this doc treats `DEFAULT_CIRCLES` as fixed.
- **Group chat, or chat as a broader "circle" concept** (e.g. a group thread per circle) —
  the brief asked about 1:1 specifically; a circle-wide group chat is a different, larger
  product decision (closer to a Slack channel per circle) not evaluated here.
- **Blocking/reporting/moderation design** — flagged above as a hard requirement *if* chat
  ships, but not designed here; it needs its own pass across the whole app, not just Circles,
  since abuse surfaces would extend to event invites and friends-nearby too.
- **Push notification infrastructure** — repeatedly identified above as the real blocking
  dependency for chat (and already a gap for event invites), but choosing a push provider
  (Expo push service vs. FCM/APNs directly) and scoping that build is a separate doc, not a
  sub-section of this one.
- **The onboarding/invite-recovery gap (finding #4)** — flagged because it fell out of reading
  the code, not because it was asked about; a real fix (resend, invite-link copy, sent-at
  timestamp) needs its own small scoping pass.
- **Numeric specifics for gap #1's "near me" default radius/timeframe** once wired into
  `social.tsx` — that's an extension of `lib/place-matching.ts`'s existing distance-matching
  conventions, a small follow-up scoping question, not a research question this doc needs to
  settle.
