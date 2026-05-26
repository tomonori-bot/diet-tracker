const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* ─── DB helpers ─── */
function readDB() {
  if (!fs.existsSync(DATA_FILE)) return { patients: [] };
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { patients: [] }; }
}
function writeDB(db) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

/* ─── 患者一覧取得 ─── */
app.get('/api/patients', (req, res) => {
  const db = readDB();
  const { q } = req.query;
  let list = db.patients;
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
app.post('/api/patients', (req, res) => {
  const db = readDB();
  const p = {
    id: uuidv4(),
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

/* ─── 患者1件取得 ─── */
app.get('/api/patients/:id', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

/* ─── 患者更新 ─── */
app.put('/api/patients/:id', (req, res) => {
  const db = readDB();
  const idx = db.patients.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  db.patients[idx] = { ...db.patients[idx], ...req.body, id: req.params.id };
  writeDB(db);
  res.json(db.patients[idx]);
});

/* ─── 患者削除 ─── */
app.delete('/api/patients/:id', (req, res) => {
  const db = readDB();
  db.patients = db.patients.filter(p => p.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

/* ─── 体重・状態レコード追加 ─── */
app.post('/api/patients/:id/records', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const rec = {
    id: uuidv4(),
    date: req.body.date || new Date().toISOString().slice(0,10),
    weight: req.body.weight != null ? parseFloat(req.body.weight) : null,
    pain: req.body.pain != null ? parseInt(req.body.pain) : null,
    posture: req.body.posture != null ? parseInt(req.body.posture) : null,
    moti: req.body.moti != null ? parseInt(req.body.moti) : null,
    exercise: req.body.exercise != null ? parseInt(req.body.exercise) : null,
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
app.put('/api/patients/:id/records/:rid', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const idx = (p.records || []).findIndex(r => r.id === req.params.rid);
  if (idx < 0) return res.status(404).json({ error: 'Record not found' });
  p.records[idx] = { ...p.records[idx], ...req.body, id: req.params.rid };
  p.records.sort((a,b) => a.date.localeCompare(b.date));
  writeDB(db);
  res.json(p.records[idx]);
});

/* ─── レコード削除 ─── */
app.delete('/api/patients/:id/records/:rid', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.records = (p.records || []).filter(r => r.id !== req.params.rid);
  writeDB(db);
  res.json({ ok: true });
});

/* ─── セッション記録追加 ─── */
app.post('/api/patients/:id/sessions', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
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
app.put('/api/patients/:id/sessions/:sid', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const idx = (p.sessions || []).findIndex(s => s.id === req.params.sid);
  if (idx < 0) return res.status(404).json({ error: 'Session not found' });
  p.sessions[idx] = { ...p.sessions[idx], ...req.body, id: req.params.sid };
  p.sessions.sort((a,b) => b.date.localeCompare(a.date));
  writeDB(db);
  res.json(p.sessions[idx]);
});

/* ─── セッション削除 ─── */
app.delete('/api/patients/:id/sessions/:sid', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
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
    pain: req.body.pain != null ? parseInt(req.body.pain) : null,
    posture: req.body.posture != null ? parseInt(req.body.posture) : null,
    moti: req.body.moti != null ? parseInt(req.body.moti) : null,
    exercise: req.body.exercise != null ? parseInt(req.body.exercise) : null,
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
    pain: rec.pain,
    posture: rec.posture,
    moti: rec.moti,
    exercise: rec.exercise,
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
app.get('/api/patients/:id/self-records', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p.patientRecords || []);
});

/* ─── 患者セルフ記録をインポート ─── */
app.post('/api/patients/:id/import-self', (req, res) => {
  const db = readDB();
  const p = db.patients.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const unimported = (p.patientRecords || []).filter(r => !r.imported);
  unimported.forEach(pr => {
    const rec = {
      id: uuidv4(),
      date: pr.date, weight: pr.weight, pain: pr.pain,
      posture: pr.posture, moti: pr.moti, exercise: pr.exercise,
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
app.get('/api/stats', (req, res) => {
  const db = readDB();
  const patients = db.patients;
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

/* ─── SSE: リアルタイム通知ストリーム ─── */
const sseClients = new Map(); // patientId → Set of res

app.get('/api/patients/:id/stream', (req, res) => {
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
