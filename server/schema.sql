-- Partly Rainy ランキング用のテーブル(Cloudflare D1)
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  lines      INTEGER NOT NULL,
  level      INTEGER NOT NULL,
  pieces     INTEGER NOT NULL,
  mode       INTEGER NOT NULL DEFAULT 5,   -- 巨大ピースの頻度(%)。5 か 10。ランキングは頻度ごとに別
  created_at INTEGER NOT NULL,   -- 登録時刻(ミリ秒)
  ip_hash    TEXT    NOT NULL    -- 連続登録の制限に使う(IPそのものは保存しない)
);
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (mode, score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_scores_ip   ON scores (ip_hash, created_at DESC);
