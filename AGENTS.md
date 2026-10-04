# AGENTS.md

Canonical context for AI agents working in this repository.

## Project overview

VAR Room ("Video Assistant Referee" room) is a football debate credibility platform. A fan posts a tactical or transfer opinion (e.g. "Bellingham is more effective as a false 9 than as an 8"), an AI agent pipeline extracts testable claims, checks each claim against real evidence gathered from web search, and returns a cited 0–100 credibility score shown as a VAR decision (*Decision stands* / *Overturned* / *Check incomplete*).

## Commands

Run from the repository root with Bun:

- **Install dependencies**: `bun install`
- **Start dev servers**: `bun run dev`
- **Typecheck all packages**: `bun run typecheck`
- **Lint**: `bun run lint`
- **Format**: `bun run format`
- **Run all tests**: `bun test`
- **Run a single test**: `bun --env-file=.env test path/to/file.test.ts`
- **Generate Prisma Client**: `bun run db:generate`
- **Deploy migrations**: `bun run db:migrate`
- **Database Studio**: `bun run db:studio`
- **Inspect AI trace or budget**: `bun run trace [reviewId]`
- **CI**: `bun run ci` (runs lint and typecheck)

## Workflow & working mode

- **Working mode: pair programming**:
  - The owner is learning Google ADK and TypeScript with this project.
  - Before each task, provide a short concept brief: what we're building and why.
  - Then the owner either writes it themselves with hints and tests, or asks for code with an explanation.
  - Avoid dropping large blocks of unexplained code.

- **Skills driven by files**:
  - `docs/scope/`: Epic and feature scope tracking owned by `/scope`.
  - `docs/specs/`: Architecture and decision specs owned by `/architect`.
  - `docs/reviews/`: Review findings owned by `/check review`.
  - `AGENTS.md`: Canonical context maintained by `/audit` and `/sync`.

- **Build approach**: **Backend first**. Foundations → backend (sign in API, debates API) → agents + review API → frontend. Every backend feature must be testable from the terminal (curl, `bun test`, CLI) before any web page exists.
- **Workflow tier**: **Beta** default (develop → `/check verify` → `/test`). Sign in (#6) and production deploy (#19) are `· GA`.

## Stack & architecture

- **Monorepo layout**:
  - `apps/api`: Express 5 server providing REST routes, SSE live stream, and Better Auth endpoints.
  - `apps/web`: React + Vite single page app (frontend).
  - `packages/shared`: Shared Zod schemas, constants, and types.
  - `packages/db`: Prisma schema, migrations, Neon database client, and TypedSQL analytics.
  - `packages/ingest`: Reserved for future match data ingestion.
  - `packages/agents`: Google ADK agent pipeline, search tools, prompts, scoring, and telemetry.
- **Runtime**: Bun (runtime, package manager, and `bun test`).
- **Database**: Postgres on **Neon** (`dev` and `test` branches), `pg_trgm` extension enabled for typo-tolerant player name search.
- **ORM**: Prisma 7 with `@prisma/adapter-pg`.
- **Tooling**: Biome 2.5 for linting and formatting. GitHub Actions CI for automated checks.

## Agent pipeline invariants

- **Fixed sequence**: An ADK pipeline runs Moderator → grounded web search → FactChecker.
- **Evidence recorded by code**: An `afterToolCallback` records every real search result as a numbered entry (`E1…En`). Evidence is never fabricated by the LLM.
- **Citations are strictly checked**: The server validates every evidence label cited by the FactChecker. Invalid or unassociated citations downgrade the claim to `INSUFFICIENT_DATA`.
- **Pure score computation**: The 0–100 credibility score and verdict are computed by a deterministic pure function in code, never by the model. Untestable claims are excluded from scoring.
- **Daily budget and caps**: Usage limits are enforced per fan (rolling 24h) and globally per day (Pacific midnight reset) before Gemini calls are initiated.

<!-- Drafted by /audit for VAR Room -->
