# Play Console — Data safety form answers

Answers for **Play Console → App content → Data safety**, derived from what the code does
today (`public/privacy.html` is the user-facing version of the same facts). Re-check this file
whenever a model gains a field, a new SDK is added, or Sentry is switched on.

Console wording changes from time to time; where a label below does not match exactly, pick the
option with the same meaning.

## URLs the console asks for

| Field | Value |
| --- | --- |
| Privacy policy (App content → Privacy policy, and the store listing) | `https://odysai-server-891816307412.us-central1.run.app/privacy.html` |
| Delete account URL (Data safety → Data deletion) | `https://odysai-server-891816307412.us-central1.run.app/delete-account.html` |

Both pages are served by `server.ts`'s static handler, so they only exist once the backend is
deployed with this code. Open both in a browser before pasting them — Play rejects a URL that
does not load.

## Data collection and security

| Question | Answer | Why |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** | See the table below. |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Release builds talk to the Cloud Run URL over HTTPS only (`eas.json` → `EXPO_PUBLIC_API_URL`). |
| Which methods of account creation does your app support? | **OAuth** (Google Sign-In) and **Other** — describe as "email address" | `POST /api/auth/google` and `POST /api/auth/login`. There is no password. |
| Delete account URL | the URL above | In-app: Profile → Delete account (`DELETE /api/users/me`). Web: the form on that page. |
| Do you provide a way for users to request that some or all of their data is deleted without deleting their account? | **No** | Trips, events and contacts can be deleted one by one in the app, but there is no web page for it, and this question is optional. |

## Data types

"Collected" in Play's sense means it leaves the phone. "Shared" means handed to a third party
other than a service provider working for us — nothing below is shared in that sense (hosting,
push delivery, billing and place search all act as service providers; what another Odys.ai user
sees is something the user chose to show their circles).

For every row: **Shared: No.**

| Category → type | Collected | Ephemeral | Required / optional | Purposes | Source in the code |
| --- | --- | --- | --- | --- | --- |
| Location → Approximate location | Yes | No | Optional | App functionality, Personalization | Home city (`User.homebase`), trip destinations (`Trip`) |
| Location → Precise location | Yes | No | Optional | App functionality | Device position sent as `anchorLat`/`anchorLng` for recommendations and to the weather service (not stored); hotel/stay coordinates on a trip are stored (`Trip.baseLocations`) |
| Personal info → Name | Yes | No | Required | App functionality, Account management | `User.full_name` |
| Personal info → Email address | Yes | No | Required | App functionality, Account management | `User.email` |
| Personal info → User IDs | Yes | No | Required | App functionality, Account management | Mongo `_id` (also the RevenueCat app user id), `User.google_id` |
| Personal info → Other info | Yes | No | Optional | App functionality | Date of birth (`User.dob`) |
| Financial info → Purchase history | Yes | No | Optional | App functionality | `User.subscription` (tier, status, product id, period end) written by the RevenueCat webhook |
| Photos and videos → Photos | Yes | No | Optional | App functionality | Profile picture (`User.avatar_url`) — only the one image the user picks |
| Calendar → Calendar events | Yes | No | Optional | App functionality | Device-calendar events that fall inside a trip's dates (`importTripEvents` → `Event`) |
| Contacts → Contacts | Yes | No | Optional | App functionality | Contacts the user adds by hand (`Contact`: name, email, circle) and friend requests. The app does **not** read the phone's address book. |
| App activity → App interactions | Yes | No | Required | App functionality | `User.lastAppAccess`, monthly trip-creation count (`TripCreationEvent`, enforces the free plan's limit) |
| App activity → Other user-generated content | Yes | No | Optional | App functionality, Personalization | Trips, events, preferences (budget, cuisines, activities, dietary limits), feedback and problem reports (`Suggestion`) |
| Device or other IDs → Device or other IDs | Yes | No | Optional | App functionality | Push notification token (`User.expoPushToken`) |

Everything not in the table: **No** — Address, Phone number, Race and ethnicity, Political or
religious beliefs, Sexual orientation, User payment info, Credit score, Other financial info,
Health info, Fitness info, Emails, SMS or MMS, Other in-app messages, Videos, Voice or sound
recordings, Music files, Other audio files, Files and docs, In-app search history, Installed
apps, Other actions, Web browsing history, Other app performance data.

### Only when Sentry is on

Sentry is off until a DSN is set (see `docs/play-beta-setup.md` → "Error tracking"). If the
build submitted to Play has `EXPO_PUBLIC_SENTRY_DSN` set, add these two rows; otherwise answer
**No** for both.

| Category → type | Collected | Ephemeral | Required / optional | Purposes |
| --- | --- | --- | --- | --- |
| App info and performance → Crash logs | Yes | No | Required | Analytics |
| App info and performance → Diagnostics | Yes | No | Required | Analytics |

(Diagnostics because `tracesSampleRate: 0.1` in `app/_layout.tsx` sends performance traces for
one session in ten.)

## Judgment calls — decide before submitting

These are the answers where a reasonable reviewer could land elsewhere. The table above already
takes the cautious side except where noted.

1. **Dietary limits (Halal, Kosher, Nut-Free, Gluten-Free…)** are declared as *Other
   user-generated content*, not as *Political or religious beliefs* or *Health info*: the app
   stores a restaurant filter, not a statement of belief or a medical fact. The stricter reading
   is to also tick those two. Ticking them puts "religious beliefs" and "health info" on the
   store listing's data-safety card.
2. **Precise location is marked not ephemeral** because hotel coordinates are stored with a
   trip. The device's own GPS position is never stored, so if hotel coordinates are judged not
   to be "the user's location", this row could be *Ephemeral: Yes*.
3. **Weather and place search are treated as service providers, not sharing.** The phone sends
   coordinates straight to Open-Meteo (weather) and typed addresses to Nominatim (hotel lookup)
   with no account identifier attached. Neither has a data-processing agreement with us — they
   are public APIs. If that matters, the stricter answer is *Location → Shared: Yes, App
   functionality*.
4. **App interactions** is declared for two counters (last-opened time, trips created this
   month). There is no analytics SDK and no screen or tap tracking.

## Related console sections

- **Ads:** the app contains no ads.
- **App access:** all functionality is behind sign-in. Give the reviewer an email address to
  type on the login screen (no password exists) — any address creates an account.
- **Content rating / target audience:** not directed at children; the privacy policy states a
  minimum age of 16.
- **Permissions declared by the build:** calendar (read/write), location (foreground),
  notifications, camera and photo picker (profile picture only). No background location, no
  contacts permission.
