-- CreateEnum
CREATE TYPE "DebateCategory" AS ENUM ('TACTICAL', 'TRANSFER', 'PLAYER', 'OTHER');

-- CreateEnum
CREATE TYPE "TagKind" AS ENUM ('TEAM', 'LEAGUE');

-- DropIndex
DROP INDEX "debates_created_at_idx";

-- AlterTable
ALTER TABLE "debates" ADD COLUMN     "categories" "DebateCategory"[],
ADD COLUMN     "comment_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "credibility_score" INTEGER,
ADD COLUMN     "down_votes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "up_votes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vote_score" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TagKind" NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debate_tags" (
    "debate_id" UUID NOT NULL,
    "tag_id" INTEGER NOT NULL,

    CONSTRAINT "debate_tags_pkey" PRIMARY KEY ("debate_id","tag_id")
);

-- CreateTable
CREATE TABLE "debate_votes" (
    "id" UUID NOT NULL,
    "debate_id" UUID NOT NULL,
    "user_id" TEXT,
    "value" SMALLINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debate_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "debate_id" UUID NOT NULL,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "debate_tags_tag_id_idx" ON "debate_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "debate_votes_debate_id_user_id_key" ON "debate_votes"("debate_id", "user_id");

-- CreateIndex
CREATE INDEX "comments_debate_id_created_at_idx" ON "comments"("debate_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "debates_created_at_id_idx" ON "debates"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "debates_categories_idx" ON "debates" USING GIN ("categories");

-- AddForeignKey
ALTER TABLE "debate_tags" ADD CONSTRAINT "debate_tags_debate_id_fkey" FOREIGN KEY ("debate_id") REFERENCES "debates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debate_tags" ADD CONSTRAINT "debate_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debate_votes" ADD CONSTRAINT "debate_votes_debate_id_fkey" FOREIGN KEY ("debate_id") REFERENCES "debates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debate_votes" ADD CONSTRAINT "debate_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_debate_id_fkey" FOREIGN KEY ("debate_id") REFERENCES "debates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Added by hand (spec 0004): a vote is only ever 1 (up) or -1 (down).
-- Prisma can't express a CHECK in schema.prisma, and it does not track
-- CHECK constraints, so later migrations leave this one alone.
ALTER TABLE "debate_votes" ADD CONSTRAINT "debate_votes_value_check" CHECK ("value" IN (1, -1));
