-- ランキングの整理(1回だけ実行): 各モードで「1人1件(ベストのみ)・上位100人」だけを残す。
-- D1 の「1日の読み取り」の無料枠が回復してから実行する:
--   npx wrangler d1 execute partly-rainy-scores --remote --file=cleanup_duplicates.sql
DELETE FROM scores WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY mode ORDER BY score DESC, created_at ASC, id ASC) AS rk
    FROM (
      SELECT id, mode, score, created_at,
             ROW_NUMBER() OVER (PARTITION BY mode, lower(name) ORDER BY score DESC, created_at ASC, id ASC) AS rn
      FROM scores
    ) WHERE rn = 1
  ) WHERE rk <= 100
);
-- 名前での検索を速くする
CREATE INDEX IF NOT EXISTS idx_scores_name ON scores (mode, lower(name));
