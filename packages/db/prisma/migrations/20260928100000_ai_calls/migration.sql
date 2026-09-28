-- ai run tracing: one row per gemini attempt (the trace and the daily budget read them),
-- plus token and call totals on the review that outlive the 48 hour cleanup

-- CreateEnum
CREATE TYPE "AiCallStep" AS ENUM ('MODERATOR', 'SEARCH', 'FACT_CHECKER');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('OK', 'ERROR');

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "ai_call_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "thinking_tokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_calls" (
    "id" BIGSERIAL NOT NULL,
    "review_id" UUID,
    "step" "AiCallStep" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "claim_order" INTEGER,
    "model" TEXT NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "error" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "thinking_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_calls_started_at_idx" ON "ai_calls"("started_at");

-- CreateIndex
CREATE INDEX "ai_calls_review_id_idx" ON "ai_calls"("review_id");

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

