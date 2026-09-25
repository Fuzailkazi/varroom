# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Accounts: sign up with email, password and a username, then sign in with either the email or the username. Usernames are 3 to 20 letters, digits or underscores, case does not matter, and a handful of names (admin, var, varroom, deleted, moderator, support, api, system) are reserved.
- Sessions last 30 days and renew once a day while you keep using the site. Sign out ends the current device; "sign out everywhere" ends all of them.
- Email confirmation on sign up, with a way to ask for the link again. Unconfirmed accounts can sign in and read, but every write route answers 403 `EMAIL_NOT_VERIFIED` until the link is opened.
- Password reset through an emailed link. A reset signs the account out on every other device.
- Account deletion (password required). Debates the account wrote stay on the board and show "deleted user" as the author; their votes and comments stay too, with no user attached.
- `GET /api/me` returns the signed in fan's profile: username, display name, email, whether it is confirmed, role, badge, tactical IQ and join date.
- Debates board: `POST /api/debates` posts an opinion (title, thesis, 1 to 4 categories, up to 5 team or league tags), `GET /api/debates` lists debates by New or Top with cursor paging and filters by category, tag and author, `GET /api/debates/:id` reads one, and the author can `DELETE` their own.
- Every debate carries its vote counts, comment count, credibility score and the newest VAR review summary, plus `myVote` when the viewer is signed in. Vote and comment routes come later; the tables and counters are already in place.
- `GET /api/tags` lists the 151 seeded tags: the five big European leagues, the two UEFA cups, their 96 clubs for 2026/27 and the 48 nations of the 2026 World Cup. `bun run db:seed` fills them and is safe to run again.
- Posting cap of 5 debates per fan per 24 hours, and a duplicate check that answers 409 with the id of the debate you already posted.

### Changed
- Validation errors now include a `fields` list naming each bad input and why, in the same `{ error: { code, message } }` shape every route uses.
- Sign up, sign in and password reset are rate limited to 10 requests per minute per IP address; the 11th answers 429.
- `bun test` now runs against a separate Neon `test` branch (`DATABASE_URL_TEST`), wiping and reseeding it before each run. Without that variable the database tests are skipped.

### Security
- Write requests (POST, PUT, PATCH, DELETE) to the API must carry a trusted `Origin` header and a JSON content type; anything else is refused before the body is read, which blocks cross site requests riding on a session cookie.
- Role, badge and tactical IQ can never be set from a request; they always start at their defaults.
- In production the API refuses to start unless the email settings (`RESEND_API_KEY`, `EMAIL_FROM`) are present, so confirmation and reset links are never silently dropped.
