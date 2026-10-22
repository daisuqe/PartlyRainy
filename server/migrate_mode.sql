-- すでに動いているデータベースに「頻度(mode)」を足す(1回だけ実行)
ALTER TABLE scores ADD COLUMN mode INTEGER NOT NULL DEFAULT 5;
DROP INDEX IF EXISTS idx_scores_rank;
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (mode, score DESC, created_at ASC);
