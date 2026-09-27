-- VAR review pipeline tables: reviews, review_events, claims, evidence,
-- claim_evidence. Created as one migration (feature 7) because the earlier
-- debates_board migration file was edited by hand and the review tables were
-- synced to dev via db push; this migration makes the history clean for the
-- test branch reset.

-- New enums for the review pipeline

CREATE TYPE "ReviewStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

CREATE TYPE "VarDecision" AS ENUM ('CONFIRMED', 'OVERTURNED', 'INCONCLUSIVE');

CREATE TYPE "ClaimType" AS ENUM ('COMPARISON', 'POSITIONAL_ROLE', 'TEAM_TACTIC', 'TRANSFER_FIT', 'UNTESTABLE');

CREATE TYPE "ClaimVerdict" AS ENUM ('PENDING', 'VERIFIED', 'PARTIALLY_TRUE', 'REFUTED', 'INSUFFICIENT_DATA');

-- CreateTable: reviews
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

-- CreateTable: review_events
CREATE TABLE "review_events" (
    "id" BIGSERIAL NOT NULL,
    "review_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: claims
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

-- CreateTable: evidence (includes kind/source_url/source_title/published_at from feature 7)
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'WEB',
    "source_url" TEXT,
    "source_title" TEXT,
    "published_at" TIMESTAMPTZ,
    "low_sample" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable: claim_evidence
CREATE TABLE "claim_evidence" (
    "claim_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,

    CONSTRAINT "claim_evidence_pkey" PRIMARY KEY ("claim_id","evidence_id")
);

-- Indexes

CREATE INDEX "reviews_debate_id_idx" ON "reviews"("debate_id");
CREATE INDEX "reviews_status_idx" ON "reviews"("status");
CREATE UNIQUE INDEX "review_events_review_id_seq_key" ON "review_events"("review_id", "seq");
CREATE UNIQUE INDEX "claims_review_id_order_key" ON "claims"("review_id", "order");
CREATE UNIQUE INDEX "evidence_review_id_label_key" ON "evidence"("review_id", "label");

-- Foreign keys

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_debate_id_fkey"
    FOREIGN KEY ("debate_id") REFERENCES "debates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_events" ADD CONSTRAINT "review_events_review_id_fkey"
    FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "claims" ADD CONSTRAINT "claims_review_id_fkey"
    FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence" ADD CONSTRAINT "evidence_review_id_fkey"
    FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_fkey"
    FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
