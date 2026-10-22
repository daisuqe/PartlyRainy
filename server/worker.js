// Partly Rainy ランキング API(Cloudflare Workers + D1)
//   GET  /scores?limit=10   → 上位のスコア
//   POST /scores            → スコアを登録({ name, score, lines, level, pieces })
// 不正対策は「簡易なもの」です(ブラウザから送る値は完全には信用できません)。

const MAX_NAME = 12;               // 名前の最大文字数
const MIN_INTERVAL_MS = 15000;     // 同じ端末からの登録間隔の下限
const MAX_SCORE = 9999999;
const MAX_LIST = 100;              // ランキングに出す最大の件数(100位まで)
const MODES = [5, 10];             // 巨大ピースの頻度(%)。ランキングは頻度ごとに別。指定がなければ 5

const parseMode = v => { const n = Number(v); return MODES.includes(n) ? n : 5; };

// 同じ人(名前が同じ。英字は大文字小文字を区別しない)は、いちばん高い得点の1件だけを出す(頻度ごとに別のランキング)
const TOP_SQL = `
  SELECT name, score, lines, level, created_at FROM (
    SELECT name, score, lines, level, created_at,
           ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY score DESC, created_at ASC) AS rn
    FROM scores WHERE mode = ?
  ) WHERE rn = 1
  ORDER BY score DESC, created_at ASC
  LIMIT ?`;

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allowed.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function reply(request, env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env), ...extra },
  });
}

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 名前: 全角英数を半角に寄せ、制御文字と < > を取り除き、前後の空白を削って 12 文字まで
function cleanName(v) {
  const s = String(v ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, MAX_NAME).join('');
}

const isInt = v => typeof v === 'number' && Number.isInteger(v) && v >= 0;

// 値のチェック。ゲーム側の採点(ライン消去 100×2^(n-1)、ドロップ 1 段 1 点)から
// ありえない組み合わせを弾く。
function validate(b) {
  if (!b || typeof b !== 'object') return { error: 'bad_request' };
  const name = cleanName(b.name);
  if (!name) return { error: 'bad_name' };
  const { score, lines, level, pieces } = b;
  if (b.mode !== undefined && !MODES.includes(b.mode)) return { error: 'bad_values' };
  if (![score, lines, level, pieces].every(isInt)) return { error: 'bad_values' };
  if (pieces < 1 || pieces > 100000) return { error: 'bad_values' };
  if (score > MAX_SCORE) return { error: 'bad_score' };
  if (level !== Math.floor(lines / 10) + 1) return { error: 'bad_values' };
  if (lines > pieces * 8) return { error: 'bad_values' };                     // 1 ピースで消せるのは最大 8 ライン(倍サイズ)
  if (score > 1600 * lines + 20 * pieces + 100) return { error: 'bad_score' }; // ライン 1 本あたり最大 1600 点 + ドロップ
  return { value: { name, score, lines, level, pieces, mode: parseMode(b.mode) } };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (url.pathname !== '/scores') return reply(request, env, { error: 'not_found' }, 404);

    // ---- 上位のスコア ----
    if (request.method === 'GET') {
      const limit = Math.min(MAX_LIST, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
      const mode = parseMode(url.searchParams.get('mode'));
      const { results } = await env.DB.prepare(TOP_SQL).bind(mode, limit).all();
      return reply(request, env, { mode, scores: results }, 200, { 'Cache-Control': 'public, max-age=10' });
    }

    // ---- 登録 ----
    if (request.method === 'POST') {
      const text = await request.text();
      if (text.length > 2000) return reply(request, env, { error: 'too_large' }, 413);
      let body;
      try { body = JSON.parse(text); } catch (e) { return reply(request, env, { error: 'bad_request' }, 400); }
      const v = validate(body);
      if (v.error) return reply(request, env, { error: v.error }, 400);

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const ipHash = await sha256((env.SALT || '') + ip);
      const now = Date.now();

      const last = await env.DB
        .prepare('SELECT created_at FROM scores WHERE ip_hash = ? ORDER BY created_at DESC LIMIT 1')
        .bind(ipHash).first();
      if (last && now - last.created_at < MIN_INTERVAL_MS) {
        return reply(request, env, { error: 'too_fast' }, 429);
      }

      const s = v.value;
      await env.DB
        .prepare('INSERT INTO scores (name, score, lines, level, pieces, mode, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(s.name, s.score, s.lines, s.level, s.pieces, s.mode, now, ipHash).run();
      // 順位は「同じ人は1人として数えたときの、その人のいちばん高い得点」の順位
      const mine = await env.DB.prepare('SELECT MAX(score) AS best FROM scores WHERE mode = ? AND lower(name) = lower(?)').bind(s.mode, s.name).first();
      const best = mine && mine.best != null ? mine.best : s.score;
      const better = await env.DB.prepare('SELECT COUNT(*) AS c FROM (SELECT MAX(score) AS m FROM scores WHERE mode = ? GROUP BY lower(name)) WHERE m > ?').bind(s.mode, best).first();
      return reply(request, env, { ok: true, rank: (better ? better.c : 0) + 1, name: s.name, best, mode: s.mode });
    }

    return reply(request, env, { error: 'method_not_allowed' }, 405);
  },
};
