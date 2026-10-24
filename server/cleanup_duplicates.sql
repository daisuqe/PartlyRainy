-- 同じ名前(英字は大文字小文字を区別しない)の古い行を消して、1人1件にする。
-- D1 の「1日の読み取り」の無料枠が回復してから、1回だけ実行する:
--   npx wrangler d1 execute partly-rainy-scores --remote --file=cleanup_duplicates.sql
DELETE FROM scores WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY mode, lower(name) ORDER BY score DESC, created_at ASC, id ASC) AS rn
    FROM scores
  ) WHERE rn = 1
);
-- 名前での検索を速くする(読み取る行を減らす)
CREATE INDEX IF NOT EXISTS idx_scores_name ON scores (mode, lower(name));
