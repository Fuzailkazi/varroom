-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "VarDecision" AS ENUM ('CONFIRMED', 'OVERTURNED', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('COMPARISON', 'POSITIONAL_ROLE', 'TEAM_TACTIC', 'TRANSFER_FIT', 'UNTESTABLE');

-- CreateEnum
CREATE TYPE "ClaimVerdict" AS ENUM ('PENDING', 'VERIFIED', 'PARTIALLY_TRUE', 'REFUTED', 'INSUFFICIENT_DATA');

-- CreateTable
CREATE TABLE "competitions" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "country_name" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "is_international" BOOLEAN NOT NULL,

    CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "competition_id" INTEGER NOT NULL,
    "season_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("competition_id","season_id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "country_name" TEXT,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" INTEGER NOT NULL,
    "competition_id" INTEGER NOT NULL,
    "season_id" INTEGER NOT NULL,
    "match_date" DATE NOT NULL,
    "stage" TEXT,
    "home_team_id" INTEGER NOT NULL,
    "away_team_id" INTEGER NOT NULL,
    "home_score" INTEGER NOT NULL,
    "away_score" INTEGER NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_positions" (
    "id" SERIAL NOT NULL,
    "match_id" INTEGER NOT NULL,
    "player_id" INTEGER NOT NULL,
    "team_id" INTEGER NOT NULL,
    "position" TEXT NOT NULL,
    "position_id" INTEGER NOT NULL,
    "from_minute" INTEGER NOT NULL,
    "to_minute" INTEGER,

    CONSTRAINT "player_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_events" (
    "id" UUID NOT NULL,
    "match_id" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "second" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "team_id" INTEGER NOT NULL,
    "player_id" INTEGER,
    "position" TEXT,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "end_x" DOUBLE PRECISION,
    "end_y" DOUBLE PRECISION,
    "outcome" TEXT,
    "under_pressure" BOOLEAN NOT NULL DEFAULT false,
    "is_progressive" BOOLEAN NOT NULL DEFAULT false,
    "xg" DOUBLE PRECISION,
    "details" JSONB,

    CONSTRAINT "match_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debates" (
    "id" UUID NOT NULL,
    "author_id" TEXT,
    "title" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "focus_player_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "debate_id" UUID NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'QUEUED',
    "decision" "VarDecision",
    "credibility_score" INTEGER,
    "summary" TEXT,
    "failure_reason" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_events" (
    "id" BIGSERIAL NOT NULL,
    "review_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "claim_text" TEXT NOT NULL,
    "type" "ClaimType" NOT NULL,
    "entities" JSONB NOT NULL,
    "metric_evaluated" TEXT,
    "verdict" "ClaimVerdict" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "reasoning" TEXT,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "low_sample" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_evidence" (
    "claim_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,

    CONSTRAINT "claim_evidence_pkey" PRIMARY KEY ("claim_id","evidence_id")
);

-- CreateIndex
CREATE INDEX "players_name_idx" ON "players"("name");

-- CreateIndex
CREATE INDEX "matches_competition_id_season_id_idx" ON "matches"("competition_id", "season_id");

-- CreateIndex
CREATE INDEX "player_positions_player_id_position_idx" ON "player_positions"("player_id", "position");

-- CreateIndex
CREATE INDEX "player_positions_match_id_idx" ON "player_positions"("match_id");

-- CreateIndex
CREATE INDEX "match_events_player_id_type_idx" ON "match_events"("player_id", "type");

-- CreateIndex
CREATE INDEX "match_events_match_id_team_id_idx" ON "match_events"("match_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_events_match_id_index_key" ON "match_events"("match_id", "index");

-- CreateIndex
CREATE INDEX "debates_author_id_idx" ON "debates"("author_id");

-- CreateIndex
CREATE INDEX "debates_created_at_idx" ON "debates"("created_at");

-- CreateIndex
CREATE INDEX "reviews_debate_id_idx" ON "reviews"("debate_id");

-- CreateIndex
CREATE INDEX "reviews_status_idx" ON "reviews"("status");

-- CreateIndex
CREATE UNIQUE INDEX "review_events_review_id_seq_key" ON "review_events"("review_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "claims_review_id_order_key" ON "claims"("review_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_review_id_label_key" ON "evidence"("review_id", "label");

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_competition_id_season_id_fkey" FOREIGN KEY ("competition_id", "season_id") REFERENCES "seasons"("competition_id", "season_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_positions" ADD CONSTRAINT "player_positions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_positions" ADD CONSTRAINT "player_positions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_positions" ADD CONSTRAINT "player_positions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debates" ADD CONSTRAINT "debates_focus_player_id_fkey" FOREIGN KEY ("focus_player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_debate_id_fkey" FOREIGN KEY ("debate_id") REFERENCES "debates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
