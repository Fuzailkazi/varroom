-- One page of debate ids for the Top sort (spec 0004, AC-6 to AC-8).
-- Order: vote score, then credibility score, then newest.
-- COALESCE(credibility_score, -1) puts unreviewed debates (null score)
-- below a reviewed debate that scored 0.
--
-- The filters and the cursor work like listNewDebateIds.sql. ORDER BY and
-- the cursor comparison MUST list the same columns in the same order.
--
-- @param {String} $1:category? uppercase, e.g. TRANSFER
-- @param {String} $2:tag? a tag slug, e.g. arsenal
-- @param {String} $3:author? a lowercase username
-- @param {String} $4:cursorId? the last debate id of the previous page
-- @param {Int} $5:limit how many rows to return
SELECT d.id
FROM debates d
LEFT JOIN users u ON u.id = d.author_id
WHERE ($1::text IS NULL OR d.categories @> ARRAY[$1::text::"DebateCategory"])
  AND ($2::text IS NULL OR EXISTS (
    SELECT 1
    FROM debate_tags dt
    JOIN tags t ON t.id = dt.tag_id
    WHERE dt.debate_id = d.id AND t.slug = $2::text
  ))
  AND ($3::text IS NULL OR u.username = $3::text)
  AND ($4::uuid IS NULL OR (d.vote_score, COALESCE(d.credibility_score, -1), d.created_at, d.id) < (
    SELECT c.vote_score, COALESCE(c.credibility_score, -1), c.created_at, c.id
    FROM debates c
    WHERE c.id = $4::uuid
  ))
ORDER BY d.vote_score DESC, COALESCE(d.credibility_score, -1) DESC, d.created_at DESC, d.id DESC
LIMIT $5
