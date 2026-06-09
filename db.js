/* ════════════════════════════════════════════════════════
   db.js — データ層（Supabase対応 / ファイル保存フォールバック）

   設計（中間案・ハイブリッドB）：
   - patients テーブル：顧客1人 = 1行（中身はJSON）。増えても1行ずつ扱うので速い
   - users テーブル：アカウント1つ = 1行
   - app_data テーブル：intakeCodes / exercises / sessions(ログイントークン) をキー別に保管

   既存コードとの互換：
   - loadDB() が今まで通りの { patients:[], users:[], sessions:{}, intakeCodes:{}, exercises:{} } を返す
   - saveDB(db) が「前回からの差分だけ」をSupabaseに保存（全件書き戻さない＝速い）

   Supabase未設定時（ローカル開発など）は data/db.json に保存（フォールバック）。
   ════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

const DATA_FILE = path.join(__dirname, 'data', 'db.json');

let supabase = null;
if (USE_SUPABASE) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
  console.log('[db] Supabase mode');
} else {
  console.log('[db] File mode (data/db.json) — SUPABASE_URL/KEY 未設定');
}

const empty = () => ({ patients: [], users: [], sessions: {}, intakeCodes: {}, exercises: {} });

/* ─────────── 差分検出のための前回スナップショット ───────────
   loadDB() で読んだ内容を覚えておき、saveDB() で変わった分だけ保存する */
let snapshot = {
  patients: new Map(),   // id -> JSON文字列
  users: new Map(),      // id -> JSON文字列
  appData: new Map(),    // key -> JSON文字列（sessions/intakeCodes/exercises）
};

/* ═══════════ Supabaseモード ═══════════ */

async function loadDB_supabase() {
  const db = empty();
  snapshot = { patients: new Map(), users: new Map(), appData: new Map() };

  // patients
  const { data: pats, error: e1 } = await supabase.from('patients').select('id,data');
  if (e1) throw new Error('patients読み込み失敗: ' + e1.message);
  for (const row of pats || []) {
    db.patients.push(row.data);
    snapshot.patients.set(row.id, JSON.stringify(row.data));
  }

  // users
  const { data: usrs, error: e2 } = await supabase.from('users').select('id,data');
  if (e2) throw new Error('users読み込み失敗: ' + e2.message);
  for (const row of usrs || []) {
    db.users.push(row.data);
    snapshot.users.set(row.id, JSON.stringify(row.data));
  }

  // app_data（sessions / intakeCodes / exercises）
  const { data: app, error: e3 } = await supabase.from('app_data').select('key,data');
  if (e3) throw new Error('app_data読み込み失敗: ' + e3.message);
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
  const upserts = [];
  for (const p of db.patients || []) {
    if (!p || !p.id) continue;
    seenP.add(p.id);
    const json = JSON.stringify(p);
    if (snapshot.patients.get(p.id) !== json) {
      upserts.push({ id: p.id, owner_id: p.ownerId || 'admin', data: p });
    }
  }
  if (upserts.length) {
    const { error } = await supabase.from('patients').upsert(upserts);
    if (error) throw new Error('patients保存失敗: ' + error.message);
  }
  // 消えた患者を削除
  const delP = [];
  for (const id of snapshot.patients.keys()) if (!seenP.has(id)) delP.push(id);
  if (delP.length) {
    const { error } = await supabase.from('patients').delete().in('id', delP);
    if (error) throw new Error('patients削除失敗: ' + error.message);
  }

  // ── users：変更/新規だけ upsert ──
  const seenU = new Set();
  const upU = [];
  for (const u of db.users || []) {
    if (!u || !u.id) continue;
    seenU.add(u.id);
    const json = JSON.stringify(u);
    if (snapshot.users.get(u.id) !== json) {
      upU.push({ id: u.id, username: u.username, data: u });
    }
  }
  if (upU.length) {
    const { error } = await supabase.from('users').upsert(upU);
    if (error) throw new Error('users保存失敗: ' + error.message);
  }
  const delU = [];
  for (const id of snapshot.users.keys()) if (!seenU.has(id)) delU.push(id);
  if (delU.length) {
    const { error } = await supabase.from('users').delete().in('id', delU);
    if (error) throw new Error('users削除失敗: ' + error.message);
  }

  // ── app_data：sessions / intakeCodes / exercises を変わったものだけ ──
  const appPairs = [
    ['sessions', db.sessions || {}],
    ['intakeCodes', db.intakeCodes || {}],
    ['exercises', db.exercises || {}],
  ];
  const upA = [];
  for (const [key, val] of appPairs) {
    const json = JSON.stringify(val);
    if (snapshot.appData.get(key) !== json) {
      upA.push({ key, data: val });
    }
  }
  if (upA.length) {
    const { error } = await supabase.from('app_data').upsert(upA);
    if (error) throw new Error('app_data保存失敗: ' + error.message);
  }

  // スナップショット更新（次回の差分計算用）
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

module.exports = { loadDB, saveDB, USE_SUPABASE };
