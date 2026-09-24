-- one page of debate ids for the top sort: votes, then credibility, then newest.
-- COALESCE(credibility_score, -1) puts unreviewed (null) below a reviewed 0.
-- filters and cursor work like listNewDebateIds.sql, same column order rule applies
--
-- @param {String} $1:category? uppercase, e.g. TRANSFER
-- @param {String} $2:tag? tag slug, e.g. arsenal
-- @param {String} $3:author? lowercase username
-- @param {String} $4:cursorId? last debate id of the previous page
-- @param {Int} $5:limit rows to return
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
