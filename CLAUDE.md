# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

VAR Room ("Video Assistant Referee" room) is a football debate credibility platform. A fan posts a tactical or transfer opinion, an agent pipeline splits it into testable claims, checks each claim against real match event data, and returns a cited 0–100 credibility score shown as a VAR decision (*Decision stands* / *Overturned* / *Check incomplete*).

**No code exists yet.** The repo contains only the product scope in `docs/scope/`. There are no build, lint, or test commands until feature 1 (Stack & architecture) is scaffolded. When it is, add the real commands here, including how to run a single test.

## Workflow: jsmastery skills, driven by files

This project uses the skills `/scope`, `/architect`, `/develop`, `/audit`, `/test`, `/check`, `/sync`, `/document` and `/debug`. Each skill owns its artifacts, so don't edit another skill's files by hand:

| Path | Owner | Contents |
|---|---|---|
| `docs/scope/` | `/scope` | `index.md` (at-a-glance table, epic rollups, deferred list) plus one file per epic. Feature numbers are global across epics. |
| `docs/specs/` | `/architect` | one spec per decision, each with a `## Build plan` |
| `docs/reviews/` | `/check review` | review findings |
| `AGENTS.md` | `/audit` creates, `/sync` maintains | canonical context. `/audit` will migrate this file's content into `AGENTS.md` and make `CLAUDE.md` a pointer. |

- **How work is organized:**
  - Build approach is **Backend first** (changed from Tracer Bullet on 2026-09-24): foundations → backend (sign in API) → agents + review API → frontend. Every backend feature must be provable from the terminal (curl, `bun test`, `bun run review`) before any web page exists.
  - Default workflow tier is **Beta**: after `/develop`, run `/check verify` and then `/test`. Sign in (#6) and production deploy (#19) are tagged `· GA`.
- **Finding the next step:** it's the first unticked box in the scope. A bare `/scope` gives a "where was I" readout.

## Working mode: pair programming

The owner is learning Google ADK and TypeScript with this project.
- Before each task, give a short concept brief: what we're building and why.
- Then the owner either writes it themselves with hints and tests from Claude, or asks Claude to write it while explaining.
- Don't drop large blocks of unexplained code.

## Agreed stack (from brainstorming; not yet recorded in a spec)

Record these through `/architect stack & architecture` instead of re-asking the owner:
- **Monorepo:** `apps/web`, `apps/api`, `packages/{shared,db,ingest,agents}`.
- **Bun:** workspaces, runtime and `bun test`. No Turborepo at first.
- **No Docker:** the owner rejected it. Postgres runs on **Neon**, with separate `dev` and `test` branches. The free tier is about 0.5 GB, so events keep typed columns plus a small `details` JSON, never the full raw event.
- **Prisma:** the Client for CRUD, and **TypedSQL** `.sql` files for analytics queries. Drizzle was rejected.
- **Services:** an Express API that streams review progress over SSE; a React + Vite web app.
- **Agents:** Google ADK for TypeScript (`@google/adk`) with Gemini.
- **Data:** no stats are imported for now. Current stats and news come from **web search at review time** (ADK `GOOGLE_SEARCH` in its own News Scout agent). StatsBomb was dropped on 2026-09-24 because it only covers past tournaments; the empty football tables are kept for a future stats API.

## Agent pipeline invariants (the core design)

- **Fixed sequence:** an ADK `SequentialAgent` runs Moderator → StatsSpecialist → FactChecker, passing session state keys `claims` → `evidence` → `verdict`.
- **Why fetching and judging are separate agents:** in ADK, an agent with `outputSchema` can't use tools. So the Moderator and FactChecker return structured output, and the StatsSpecialist uses tools.
- **Evidence is written by code, never the LLM.** An `afterToolCallback` records every real tool result as a numbered entry (`E1…En`).
- **Citations are checked:** the server validates every evidence ID the FactChecker cites. An invalid citation downgrades that claim to `insufficient_data`.
- **The score is computed by a pure function,** not by the model. Untestable claims are excluded from the score.
- **The LLM never writes SQL.** Tools are thin wrappers over typed `db` query functions.
- **Web evidence is recorded by code, too:** every source the search returns (link, title, snippet) becomes a numbered evidence entry. Confidence rises when several independent sources agree; a single source gives low confidence.

