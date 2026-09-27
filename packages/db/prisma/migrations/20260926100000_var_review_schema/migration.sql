-- Evidence rows now record where a web source came from.
-- The review tables and enums already exist (created in the init migration);
-- this only adds the source columns the web search evidence needs.
-- kind is plain TEXT ("WEB" now, "API" reserved for a future stats API).
-- published_at is nullable because not every source dates itself.

ALTER TABLE "evidence" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'WEB';
ALTER TABLE "evidence" ADD COLUMN "source_url" TEXT;
ALTER TABLE "evidence" ADD COLUMN "source_title" TEXT;
ALTER TABLE "evidence" ADD COLUMN "published_at" TIMESTAMPTZ;
