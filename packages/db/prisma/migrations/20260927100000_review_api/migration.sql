-- review api: who asked for a review (daily cap), and one live review per debate

-- who requested the review. null = account deleted, the review stays
ALTER TABLE "reviews" ADD COLUMN     "requested_by_id" TEXT;

-- daily cap counts one fan's reviews in the last 24h
CREATE INDEX "reviews_requested_by_id_created_at_idx" ON "reviews"("requested_by_id", "created_at");

-- older dbs can hold two non failed reviews for one debate (the cli made those).
-- keep the newest, mark the rest FAILED so the unique index below can be built
UPDATE "reviews" SET "status" = 'FAILED', "failure_reason" = 'internal: duplicate review closed by migration', "completed_at" = COALESCE("completed_at", now())
WHERE "status" <> 'FAILED'
  AND "id" IN (
    SELECT "id" FROM (
      SELECT "id", ROW_NUMBER() OVER (PARTITION BY "debate_id" ORDER BY "created_at" DESC) AS "position"
      FROM "reviews"
      WHERE "status" <> 'FAILED'
    ) AS "ranked"
    WHERE "ranked"."position" > 1
  );

-- one live or finished review per debate. failed ones don't block a retry
CREATE UNIQUE INDEX "reviews_one_live_review_per_debate" ON "reviews"("debate_id") WHERE (status <> 'FAILED');

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
