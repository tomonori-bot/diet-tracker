/* ════════════════════════════════════════════════════════
   db.js — データ層（Supabase REST API / ファイル保存フォールバック）

   設計（中間案・ハイブリッドB）：
   - patients テーブル：顧客1人 = 1行（中身はJSON）。増えても1行ずつ扱うので速い
   - users テーブル：アカウント1つ = 1行
   - app_data テーブル：intakeCodes / exercises / sessions(ログイントークン) をキー別に保管

   既存コードとの互換：
   - loadDB() が今まで通りの { patients:[], users:[], sessions:{}, intakeCodes:{}, exercises:{} } を返す
   - saveDB(db) が「前回からの差分だけ」をSupabaseに保存（全件書き戻さない＝速い）

   ※ supabase-js は使わず Supabase の REST(PostgREST) API を fetch で直接叩く。
      → WebSocket(realtime)依存が無く、Node 20 でそのまま動く。依存も増やさない。

   Supabase未設定時（ローカル開発など）は data/db.json に保存（フォールバック）。
   ════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

// 環境変数を掃除：前後の空白・引用符・★などの装飾文字や全角を除去
// （コピペ時に混入しがちな文字でHTTPヘッダーが壊れるのを防ぐ）
function cleanEnv(v) {
  if (!v) return '';
  let s = String(v).trim();
  // 前後のクォートを除去
  s = s.replace(/^["'\s]+|["'\s]+$/g, '');
  // ASCII範囲外の文字（★ や全角など）を除去
  s = s.replace(/[^\x21-\x7E]/g, '');
  return s;
}

// URLは「ドメインだけ」に正規化する。
// 末尾に /rest/v1 などのパスが付いていても、scheme://host だけ取り出して二重結合を防ぐ。
function normalizeUrl(raw) {
  let s = cleanEnv(raw);
  if (!s) return '';
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;   // 例: https://xxx.supabase.co
  } catch {
    // URLとして解釈できない場合は、パス部分を素朴に切り落とす
    return s.replace(/\/rest\/v1.*$/i, '').replace(/\/+$/, '');
  }
}

const SUPABASE_URL = normalizeUrl(process.env.SUPABASE_URL);
const SUPABASE_KEY = cleanEnv(process.env.SUPABASE_KEY);
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

const DATA_FILE = path.join(__dirname, 'data', 'db.json');

if (USE_SUPABASE) {
  // 起動時に、キーが正しい形式か軽くチェックして知らせる
  const looksJwt = SUPABASE_KEY.startsWith('eyJ');
  console.log(`[db] Supabase mode (REST) url=${SUPABASE_URL.slice(0, 30)}... key=${SUPABASE_KEY.slice(0, 6)}...(${SUPABASE_KEY.length}文字)${looksJwt ? '' : ' ⚠️キー形式が不正かも(eyJで始まるはず)'}`);
} else {
  console.log('[db] File mode (data/db.json) — SUPABASE_URL/KEY 未設定');
}

const empty = () => ({ patients: [], users: [], sessions: {}, intakeCodes: {}, exercises: {} });

/* ─── Supabase REST 共通ヘルパー ─── */
const REST = SUPABASE_URL + '/rest/v1';
const baseHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
};

async function sbSelect(table, columns) {
  // columns（例 "id,data"）はカンマをそのまま渡す（encodeすると404になる）
  const url = `${REST}/${table}?select=${columns}`;
  const res = await fetch(url, { headers: baseHeaders });
  if (!res.ok) throw new Error(`${table} 読み込み失敗: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbUpsert(table, rows) {
  if (!rows.length) return;
  const url = `${REST}/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...baseHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table} 保存失敗: ${res.status} ${await res.text()}`);
}

async function sbDeleteIn(table, column, values) {
  if (!values.length) return;
  // ?column=in.("v1","v2",...) — 値を個別にエンコードしてからカンマ・括弧で組む
  const list = values.map(v => `"${encodeURIComponent(String(v))}"`).join(',');
  const url = `${REST}/${table}?${column}=in.(${list})`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...baseHeaders, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`${table} 削除失敗: ${res.status} ${await res.text()}`);
}

/* ═══════════ Supabase Storage（写真の永続化） ═══════════
   写真はRESTのStorage APIで直接読み書きする（supabase-js不使用）。
   バケット名は 'photos'（非公開）。サーバー経由でのみ配信する。 */
const STORAGE = SUPABASE_URL + '/storage/v1';
const PHOTO_BUCKET = 'photos';
let bucketReady = false;

// バケットが無ければ作る（初回のみ・既存なら無視）
async function ensurePhotoBucket() {
  if (bucketReady) return;
  try {
    const res = await fetch(`${STORAGE}/bucket`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ id: PHOTO_BUCKET, name: PHOTO_BUCKET, public: false }),
    });
    // 200=作成 / 409=既存 どちらもOK
    if (res.ok || res.status === 409) bucketReady = true;
    else console.warn('[storage] バケット作成の確認に失敗:', res.status, await res.text());
  } catch (e) {
    console.warn('[storage] バケット作成エラー:', e.message);
  }
}

// 写真をアップロード（filename=保存名, buffer=画像バイト, contentType）
async function uploadPhoto(filename, buffer, contentType) {
  await ensurePhotoBucket();
  const url = `${STORAGE}/object/${PHOTO_BUCKET}/${encodeURIComponent(filename)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': contentType || 'image/jpeg',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`写真アップロード失敗: ${res.status} ${await res.text()}`);
}

// 写真を取得（バイト列を返す）
async function downloadPhoto(filename) {
  const url = `${STORAGE}/object/${PHOTO_BUCKET}/${encodeURIComponent(filename)}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
  });
  if (!res.ok) return null;
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// 写真を削除
async function deletePhoto(filename) {
  const url = `${STORAGE}/object/${PHOTO_BUCKET}/${encodeURIComponent(filename)}`;
  try {
    await fetch(url, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    });
  } catch (e) { /* 失敗しても致命的でないので無視 */ }
}

/* ─── 差分検出のための前回スナップショット ─── */
let snapshot = { patients: new Map(), users: new Map(), appData: new Map() };

/* ═══════════ Supabaseモード ═══════════ */

async function loadDB_supabase() {
  const db = empty();
  snapshot = { patients: new Map(), users: new Map(), appData: new Map() };

  const pats = await sbSelect('patients', 'id,data');
  for (const row of pats || []) {
    db.patients.push(row.data);
    snapshot.patients.set(row.id, JSON.stringify(row.data));
  }

  const usrs = await sbSelect('users', 'id,data');
  for (const row of usrs || []) {
    db.users.push(row.data);
    snapshot.users.set(row.id, JSON.stringify(row.data));
  }

  const app = await sbSelect('app_data', 'key,data');
  for (const row of app || []) {
    if (row.key === 'sessions') db.sessions = row.data || {};
    else if (row.key === 'intakeCodes') db.intakeCodes = row.data || {};
    else if (row.key === 'exercises') db.exercises = row.data || {};
    snapshot.appData.set(row.key, JSON.stringify(row.data));
  }

  return db;
}

async function saveDB_supabase(db) {
  // ── patients：変更/新規だけ upsert、消えたものは delete ──
  const seenP = new Set();
  const upP = [];
  for (const p of db.patients || []) {
    if (!p || !p.id) continue;
    seenP.add(p.id);
    if (snapshot.patients.get(p.id) !== JSON.stringify(p)) {
      upP.push({ id: p.id, owner_id: p.ownerId || 'admin', data: p });
    }
  }
  await sbUpsert('patients', upP);
  const delP = [];
  for (const id of snapshot.patients.keys()) if (!seenP.has(id)) delP.push(id);
  await sbDeleteIn('patients', 'id', delP);

  // ── users ──
  const seenU = new Set();
  const upU = [];
  for (const u of db.users || []) {
    if (!u || !u.id) continue;
    seenU.add(u.id);
    if (snapshot.users.get(u.id) !== JSON.stringify(u)) {
      upU.push({ id: u.id, username: u.username, data: u });
    }
  }
  await sbUpsert('users', upU);
  const delU = [];
  for (const id of snapshot.users.keys()) if (!seenU.has(id)) delU.push(id);
  await sbDeleteIn('users', 'id', delU);

  // ── app_data：sessions / intakeCodes / exercises を変わったものだけ ──
  const appPairs = [
    ['sessions', db.sessions || {}],
    ['intakeCodes', db.intakeCodes || {}],
    ['exercises', db.exercises || {}],
  ];
  const upA = [];
  for (const [key, val] of appPairs) {
    if (snapshot.appData.get(key) !== JSON.stringify(val)) {
      upA.push({ key, data: val });
    }
  }
  await sbUpsert('app_data', upA);

  // スナップショット更新
  snapshot.patients = new Map((db.patients || []).filter(p => p && p.id).map(p => [p.id, JSON.stringify(p)]));
  snapshot.users = new Map((db.users || []).filter(u => u && u.id).map(u => [u.id, JSON.stringify(u)]));
  snapshot.appData = new Map(appPairs.map(([k, v]) => [k, JSON.stringify(v)]));
}

/* ═══════════ ファイルモード（フォールバック） ═══════════ */

function loadDB_file() {
  if (!fs.existsSync(DATA_FILE)) return empty();
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!db.sessions) db.sessions = {};
    if (!db.patients) db.patients = [];
    if (!db.users) db.users = [];
    if (!db.intakeCodes) db.intakeCodes = {};
    if (!db.exercises) db.exercises = {};
    return db;
  } catch { return empty(); }
}

function saveDB_file(db) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

/* ═══════════ 公開API ═══════════ */

async function loadDB() {
  return USE_SUPABASE ? loadDB_supabase() : loadDB_file();
}
async function saveDB(db) {
  return USE_SUPABASE ? saveDB_supabase(db) : saveDB_file(db);
}

module.exports = { loadDB, saveDB, USE_SUPABASE, uploadPhoto, downloadPhoto, deletePhoto };
