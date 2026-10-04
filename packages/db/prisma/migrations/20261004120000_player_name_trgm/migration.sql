-- enable pg_trgm for typo-tolerant player name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "players_name_trgm_idx" ON "players" USING GIN ("name" gin_trgm_ops);
