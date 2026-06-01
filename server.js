const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');

// 管理者アカウント（環境変数で上書き可。デフォルト: admin / bodylog2025）
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'bodylog2025';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ─── DB helpers ─── */
function readDB() {
  if (!fs.existsSync(DATA_FILE)) return { patients: [], sessions: {}, users: [], intakeCodes: {} };
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!db.sessions) db.sessions = {};
    if (!db.patients) db.patients = [];
    if (!db.users) db.users = [];
    if (!db.intakeCodes) db.intakeCodes = {};
    return db;
  }
  catch { return { patients: [], sessions: {}, users: [], intakeCodes: {} }; }
}

/* ─── パスワードハッシュ（ソルト付き） ─── */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}
function writeDB(db) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

/* ─── 認証（Bearerトークン方式・PCとスマホで同じトークンで共有可） ─── */
function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return req.query.token || null;
}

function requireAdmin(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'No token' });
  const db = readDB();
  const sess = db.sessions[token];
  if (!sess || sess.role !== 'admin') return res.status(401).json({ error: 'Invalid token' });
  // 30日有効
  if (Date.now() - new Date(sess.createdAt).getTime() > 30 * 24 * 3600 * 1000) {
    delete db.sessions[token];
    writeDB(db);
    return res.status(401).json({ error: 'Token expired' });
  }
  req.session = sess;
  // 所有者ID（このアカウントが見られる患者の範囲）
  req.ownerId = sess.username;
  next();
}

/* ─── 新規登録API ─── */
app.post('/api/auth/register', (req, res) => {
  const username = (req.body?.username || '').trim();
  const password = req.body?.password || '';
  if (username.length < 3) return res.status(400).json({ error: 'ユーザー名は3文字以上にしてください' });
  if (password.length < 6) return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
  const db = readDB();
  // adminは予約名 + 既存ユーザーと重複不可（大文字小文字無視）
  const lower = username.toLowerCase();
  if (lower === ADMIN_USER.toLowerCase()) return res.status(409).json({ error: 'このユーザー名は使用できません' });
  if (db.users.some(u => u.username.toLowerCase() === lower)) {
    return res.status(409).json({ error: 'このユーザー名は既に使われています' });
  }
  const { salt, hash } = hashPassword(password);
  const user = { id: uuidv4(), username, salt, hash, createdAt: new Date().toISOString() };
  db.users.push(user);
  // 登録と同時にログイン状態にする
  const token = makeToken();
  db.sessions[token] = { token, role: 'admin', username, createdAt: new Date().toISOString() };
  writeDB(db);
  res.json({ token, role: 'admin', username });
});

/* ─── 認証API ─── */
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const db = readDB();
  let ok = false;
  let authUser = username;
  // 1) デフォルト管理者アカウント
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    ok = true;
  } else {
    // 2) 登録ユーザー（大文字小文字無視で照合）
    const u = db.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
    if (u && verifyPassword(password || '', u.salt, u.hash)) {
      ok = true;
      authUser = u.username;
    }
  }
  if (!ok) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
  }
  const token = makeToken();
  db.sessions[token] = {
    token, role: 'admin', username: authUser,
    createdAt: new Date().toISOString()
  };
  // 古いセッション掃除（30日以上前）
  Object.keys(db.sessions).forEach(t => {
    const s = db.sessions[t];
    if (Date.now() - new Date(s.createdAt).getTime() > 30 * 24 * 3600 * 1000) delete db.sessions[t];
  });
  writeDB(db);
  res.json({ token, role: 'admin', username: authUser });
});

app.get('/api/auth/check', (req, res) => {
  const token = getToken(req);
  if (!token) return res.json({ authenticated: false });
  const db = readDB();
  const sess = db.sessions[token];
  if (!sess) return res.json({ authenticated: false });
  if (Date.now() - new Date(sess.createdAt).getTime() > 30 * 24 * 3600 * 1000) {
    delete db.sessions[token];
    writeDB(db);
    return res.json({ authenticated: false });
  }
  res.json({ authenticated: true, role: sess.role, username: sess.username });
});

app.post('/api/auth/logout', (req, res) => {
  const token = getToken(req);
  if (token) {
    const db = readDB();
    delete db.sessions[token];
    writeDB(db);
  }
  res.json({ ok: true });
});

/* ─── ルート(/) は admin に飛ばす（admin内で未認証ならlogin.htmlへリダイレクト） ─── */
app.get('/', (req, res) => res.redirect('/admin.html'));

/* ─── 写真ファイル配信（token認証・staticより前に置く） ─── */
app.get('/data/photos/:file', (req, res) => {
  const token = getToken(req);
  const db = readDB();
  const sess = token && db.sessions[token];
  if (!sess || sess.role !== 'admin') return res.status(401).end();
  const filePath = path.join(__dirname, 'data', 'photos', path.basename(req.params.file));
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

/* ─── ログインページ・静的ファイルは認証不要 ─── */
app.use(express.static(__dirname));

/* ─── 所有権ヘルパー：この患者がリクエスト元のものか ───
   ownerId 未設定の既存患者は「admin」のものとして扱う（後方互換） */
function ownsPatient(p, ownerId) {
  const owner = p.ownerId || ADMIN_USER;
  return owner === ownerId;
}

/* ─── 患者一覧取得（自分の患者のみ） ─── */
app.get('/api/patients', requireAdmin, (req, res) => {
  const db = readDB();
  const { q } = req.query;
  let list = db.patients.filter(p => ownsPatient(p, req.ownerId));
  if (q) {
    const qLower = q.toLowerCase();
    list = list.filter(p =>
      p.name?.includes(q) || p.kana?.toLowerCase().includes(qLower) ||
      p.purpose?.includes(q) || p.memo?.includes(q)
    );
  }
  res.json(list.map(p => {
    const unimported = (p.patientRecords || []).filter(r => !r.imported).length;
    return {
      id: p.id, name: p.name, kana: p.kana, memo: p.memo,
      gender: p.gender, birthdate: p.birthdate,
      height: p.height, targetWeight: p.targetWeight,
      startWeight: p.startWeight, purpose: p.purpose,
      createdAt: p.createdAt,
      latestRecord: p.records?.slice(-1)[0] || null,
      recordCount: p.records?.length || 0,
      sessionCount: p.sessions?.length || 0,
      unimportedCount: unimported
    };
  }));
});

/* ─── 患者作成 ─── */
app.post('/api/patients', requireAdmin, (req, res) => {
  const db = readDB();
  const p = {
    id: uuidv4(),
    ownerId: req.ownerId,
    name: req.body.name,
    kana: req.body.kana || '',
    gender: req.body.gender || '',
    birthdate: req.body.birthdate || '',
    height: req.body.height || null,
    memo: req.body.memo || '',
    targetWeight: req.body.targetWeight || null,
    startWeight: req.body.startWeight || null,
    startDate: req.body.startDate || new Date().toISOString().slice(0,10),
    targetDate: req.body.targetDate || '',
    purpose: req.body.purpose || '',
    finalGoal: req.body.finalGoal || '',
    midGoal: req.body.midGoal || '',
    karteInfo: req.body.karteInfo || '',
    tags: req.body.tags || [],
    createdAt: new Date().toISOString(),
    records: [],
    sessions: [],
    patientRecords: []
  };
  db.patients.push(p);
  writeDB(db);
  res.json(p);
});

/* ─── 患者1件取得 ───
   注意：患者用URL(patient.html)からも認証なしで呼ばれるため、ここは所有チェックしない。
   患者IDはランダムなUUIDなので推測困難。 */
app.get('/api/patients/:id', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

/* ─── 患者更新 ─── */
app.put('/api/patients/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const idx = db.patients.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(db.patients[idx], req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  // ownerId は上書きさせない
  const { ownerId, ...body } = req.body || {};
  db.patients[idx] = { ...db.patients[idx], ...body, id: req.params.id };
  writeDB(db);
  res.json(db.patients[idx]);
});

/* ─── 患者削除 ─── */
app.delete('/api/patients/:id', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  db.patients = db.patients.filter(p => p.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

/* ─── 体重・状態レコード追加 ─── */
app.post('/api/patients/:id/records', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  const rec = {
    id: uuidv4(),
    date: req.body.date || new Date().toISOString().slice(0,10),
    weight: req.body.weight != null ? parseFloat(req.body.weight) : null,
    moti: req.body.moti != null ? parseInt(req.body.moti) : null,
    checkResults: req.body.checkResults || {},
    reflection: req.body.reflection || '',
    memo: req.body.memo || '',
    source: req.body.source || 'staff',
    createdAt: new Date().toISOString()
  };
  if (!p.records) p.records = [];
  const ei = p.records.findIndex(r => r.date === rec.date);
  if (ei >= 0) p.records[ei] = { ...p.records[ei], ...rec };
  else p.records.push(rec);
  p.records.sort((a,b) => a.date.localeCompare(b.date));
  writeDB(db);
  res.json(rec);
});

/* ─── レコード更新 ─── */
app.put('/api/patients/:id/records/:rid', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  const idx = (p.records || []).findIndex(r => r.id === req.params.rid);
  if (idx < 0) return res.status(404).json({ error: 'Record not found' });
  p.records[idx] = { ...p.records[idx], ...req.body, id: req.params.rid };
  p.records.sort((a,b) => a.date.localeCompare(b.date));
  writeDB(db);
  res.json(p.records[idx]);
});

/* ─── レコード削除 ─── */
app.delete('/api/patients/:id/records/:rid', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  p.records = (p.records || []).filter(r => r.id !== req.params.rid);
  writeDB(db);
  res.json({ ok: true });
});

/* ─── セッション記録追加 ─── */
app.post('/api/patients/:id/sessions', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  const session = {
    id: uuidv4(),
    date: req.body.date || new Date().toISOString().slice(0,10),
    weight: req.body.weight != null ? parseFloat(req.body.weight) : null,
    pain: req.body.pain != null ? parseInt(req.body.pain) : null,
    posture: req.body.posture != null ? parseInt(req.body.posture) : null,
    treatment: req.body.treatment || '',
    response: req.body.response || '',
    homework: req.body.homework || '',
    nextPlan: req.body.nextPlan || '',
    staffNote: req.body.staffNote || '',
    duration: req.body.duration != null ? parseInt(req.body.duration) : null,
    createdAt: new Date().toISOString()
  };
  if (!p.sessions) p.sessions = [];
  p.sessions.push(session);
  p.sessions.sort((a,b) => b.date.localeCompare(a.date));
  writeDB(db);
  res.json(session);
});

/* ─── セッション更新 ─── */
app.put('/api/patients/:id/sessions/:sid', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  const idx = (p.sessions || []).findIndex(s => s.id === req.params.sid);
  if (idx < 0) return res.status(404).json({ error: 'Session not found' });
  p.sessions[idx] = { ...p.sessions[idx], ...req.body, id: req.params.sid };
  p.sessions.sort((a,b) => b.date.localeCompare(a.date));
  writeDB(db);
  res.json(p.sessions[idx]);
});

/* ─── セッション削除 ─── */
app.delete('/api/patients/:id/sessions/:sid', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  p.sessions = (p.sessions || []).filter(s => s.id !== req.params.sid);
  writeDB(db);
  res.json({ ok: true });
});

/* ─── 患者セルフ記録（患者用URL）─── */
app.post('/api/patients/:id/self-record', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const now = new Date().toISOString();
  const rec = {
    id: uuidv4(),
    date: now.slice(0,10),
    weight: req.body.weight != null ? parseFloat(req.body.weight) : null,
    moti: req.body.moti != null ? parseInt(req.body.moti) : null,
    checkResults: req.body.checkResults || {},
    reflection: req.body.reflection || '',
    memo: req.body.memo || '',
    imported: true,
    createdAt: now
  };

  // patientRecords に保存（日付重複は上書き）
  if (!p.patientRecords) p.patientRecords = [];
  const ei = p.patientRecords.findIndex(r => r.date === rec.date);
  if (ei >= 0) p.patientRecords[ei] = rec; else p.patientRecords.push(rec);

  // ─── 自動インポート：p.records にも即時反映 ───
  const autoRec = {
    id: uuidv4(),
    date: rec.date,
    weight: rec.weight,
    moti: rec.moti,
    checkResults: rec.checkResults,
    reflection: rec.reflection,
    memo: rec.memo,
    source: 'patient',
    createdAt: rec.createdAt
  };
  if (!p.records) p.records = [];
  const ri = p.records.findIndex(r => r.date === autoRec.date);
  if (ri >= 0) {
    // 既存スタッフ記録があればpatient項目だけ上書き（スタッフ入力を残す）
    p.records[ri] = { ...p.records[ri], ...autoRec };
  } else {
    p.records.push(autoRec);
  }
  p.records.sort((a, b) => a.date.localeCompare(b.date));

  writeDB(db);

  // SSEでadminに通知
  sseNotify(req.params.id, {
    type: 'new-record',
    patientId: req.params.id,
    patientName: p.name,
    record: rec
  });
  res.json(rec);
});

/* ─── 患者セルフ記録一覧取得 ─── */
app.get('/api/patients/:id/self-records', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  res.json(p.patientRecords || []);
});

/* ─── 患者セルフ記録をインポート ─── */
app.post('/api/patients/:id/import-self', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  const unimported = (p.patientRecords || []).filter(r => !r.imported);
  unimported.forEach(pr => {
    const rec = {
      id: uuidv4(),
      date: pr.date, weight: pr.weight, moti: pr.moti,
      checkResults: pr.checkResults || {}, reflection: pr.reflection || '',
      memo: pr.memo || '', source: 'patient',
      createdAt: new Date().toISOString()
    };
    if (!p.records) p.records = [];
    const ei = p.records.findIndex(r => r.date === rec.date);
    if (ei >= 0) p.records[ei] = rec; else p.records.push(rec);
    const pi = p.patientRecords.findIndex(r => r.date === pr.date);
    if (pi >= 0) p.patientRecords[pi].imported = true;
  });
  p.records.sort((a,b) => a.date.localeCompare(b.date));
  writeDB(db);
  res.json({ imported: unimported.length });
});

/* ─── ダッシュボード統計API ─── */
app.get('/api/stats', requireAdmin, (req, res) => {
  const db = readDB();
  const patients = db.patients.filter(p => ownsPatient(p, req.ownerId));
  const totalRecords = patients.reduce((s,p) => s + (p.records?.length||0), 0);
  const totalSessions = patients.reduce((s,p) => s + (p.sessions?.length||0), 0);
  const totalUnimported = patients.reduce((s,p) => s + (p.patientRecords||[]).filter(r=>!r.imported).length, 0);

  // 最近の活動（全患者の最新記録を収集してソート）
  const recentActivity = [];
  patients.forEach(p => {
    (p.sessions || []).slice(-3).forEach(s => recentActivity.push({ type:'session', patientId:p.id, patientName:p.name, date:s.date, data:s }));
    (p.records || []).slice(-3).forEach(r => recentActivity.push({ type:'record', patientId:p.id, patientName:p.name, date:r.date, data:r }));
  });
  recentActivity.sort((a,b) => b.date.localeCompare(a.date));

  res.json({
    totalPatients: patients.length,
    totalRecords,
    totalSessions,
    totalUnimported,
    recentActivity: recentActivity.slice(0, 15)
  });
});

/* ════════════════════════════════
   問診票（事前カウンセリングアンケート）
════════════════════════════════ */

/* ─── トレーナーの問診リンク用コードを取得（無ければ発行） ─── */
app.get('/api/intake/code', requireAdmin, (req, res) => {
  const db = readDB();
  // 既にこのトレーナーのコードがあれば再利用
  let code = Object.keys(db.intakeCodes).find(c => db.intakeCodes[c] === req.ownerId);
  if (!code) {
    code = crypto.randomBytes(6).toString('hex'); // 12文字のランダムコード
    db.intakeCodes[code] = req.ownerId;
    writeDB(db);
  }
  res.json({ code });
});

/* ─── 問診コードの有効性チェック（顧客ページ用・認証不要） ─── */
app.get('/api/intake/:code/valid', (req, res) => {
  const db = readDB();
  res.json({ valid: !!db.intakeCodes[req.params.code] });
});

/* ─── 問診票の送信（認証不要・顧客が記入）→ 顧客を自動新規登録 ─── */
app.post('/api/intake/:code', (req, res) => {
  const db = readDB();
  const owner = db.intakeCodes[req.params.code];
  if (!owner) return res.status(404).json({ error: '無効なリンクです' });

  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'お名前を入力してください' });

  // 悩み・症状（配列）を文字列にまとめてカルテに残す
  const concerns = Array.isArray(b.concerns) ? b.concerns : [];
  const karteLines = [];
  if (b.email) karteLines.push(`メール: ${b.email}`);
  if (b.job) karteLines.push(`職業: ${b.job}`);
  if (concerns.length) karteLines.push(`悩み・症状: ${concerns.join('、')}`);
  if (b.painLevel != null && b.painLevel !== '') karteLines.push(`痛み・不調レベル: ${b.painLevel}/10`);
  if (b.history) karteLines.push(`既往歴・通院歴: ${b.history}`);
  if (b.note) karteLines.push(`その他・ご要望: ${b.note}`);
  karteLines.push(`（問診票より自動登録 ${new Date().toISOString().slice(0,10)}）`);

  // 年齢→生年月日の概算（年齢しか聞いていないため、誕生日は1/1で概算）
  let birthdate = '';
  const age = parseInt(b.age);
  if (!isNaN(age) && age > 0 && age < 120) {
    birthdate = `${new Date().getFullYear() - age}-01-01`;
  }

  const p = {
    id: uuidv4(),
    ownerId: owner,
    name,
    kana: b.kana || '',
    gender: b.gender || '',
    birthdate,
    height: b.height ? parseFloat(b.height) : null,
    memo: '',
    targetWeight: b.targetWeight ? parseFloat(b.targetWeight) : null,
    startWeight: b.startWeight ? parseFloat(b.startWeight) : null,
    startDate: new Date().toISOString().slice(0,10),
    targetDate: '',
    purpose: concerns[0] || b.purpose || '',
    finalGoal: b.goal || '',
    midGoal: '',
    karteInfo: karteLines.join('\n'),
    intake: {
      email: b.email || '', age: b.age || '', job: b.job || '',
      concerns, painLevel: b.painLevel ?? '', history: b.history || '',
      goal: b.goal || '', note: b.note || '',
      submittedAt: new Date().toISOString()
    },
    tags: ['問診票'],
    createdAt: new Date().toISOString(),
    records: [],
    sessions: [],
    patientRecords: [],
    photos: []
  };
  db.patients.push(p);
  writeDB(db);
  res.json({ ok: true, name: p.name });
});

/* ─── 写真アップロード（ビフォーアフター） ─── */
app.post('/api/patients/:id/photos', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  const { dataUrl, label, date } = req.body;
  if (!dataUrl) return res.status(400).json({ error: 'No image' });
  const photoId = uuidv4();
  const ext = (dataUrl.match(/^data:image\/(\w+);/) || [])[1] || 'jpg';
  const filename = `${photoId}.${ext}`;
  const photoDir = path.join(__dirname, 'data', 'photos');
  if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(path.join(photoDir, filename), Buffer.from(base64Data, 'base64'));
  const photo = {
    id: photoId, filename,
    url: `/data/photos/${filename}`,
    label: label || '',
    date: date || new Date().toISOString().slice(0,10),
    createdAt: new Date().toISOString()
  };
  if (!p.photos) p.photos = [];
  p.photos.push(photo);
  writeDB(db);
  res.json(photo);
});

app.get('/api/patients/:id/photos', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  res.json(p.photos || []);
});

app.delete('/api/patients/:id/photos/:pid', requireAdmin, (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!ownsPatient(p, req.ownerId)) return res.status(403).json({ error: 'Forbidden' });
  const photo = (p.photos || []).find(ph => ph.id === req.params.pid);
  if (photo) {
    try { fs.unlinkSync(path.join(__dirname, 'data', 'photos', photo.filename)); } catch {}
  }
  p.photos = (p.photos || []).filter(ph => ph.id !== req.params.pid);
  writeDB(db);
  res.json({ ok: true });
});

/* ─── SSE: リアルタイム通知ストリーム ─── */
const sseClients = new Map(); // patientId → Set of res

app.get('/api/patients/:id/stream', (req, res) => {
  // SSE\u306f\u30af\u30a8\u30ea\u6587\u5b57\u5217token\u3067\u8a8d\u8a3c\uff08EventSource\u306fheader\u3092\u9001\u308c\u306a\u3044\u305f\u3081\uff09
  const token = req.query.token;
  const db = readDB();
  if (!token || !db.sessions[token] || db.sessions[token].role !== 'admin') {
    return res.status(401).end();
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const { id } = req.params;
  if (!sseClients.has(id)) sseClients.set(id, new Set());
  sseClients.get(id).add(res);

  // 初回接続確認
  res.write('data: {"type":"connected"}\n\n');

  // ハートビート（30秒ごと）
  const hb = setInterval(() => {
    res.write('data: {"type":"ping"}\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(hb);
    sseClients.get(id)?.delete(res);
  });
});

function sseNotify(patientId, data) {
  const clients = sseClients.get(patientId);
  if (!clients || clients.size === 0) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try { res.write(msg); } catch {}
  });
}

app.listen(PORT, '0.0.0.0', () => console.log(`BodyLog server running on http://0.0.0.0:${PORT}`));
