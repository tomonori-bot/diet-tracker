const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
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
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

/* ─── 患者一覧取得 ─── */
app.get('/api/patients', (req, res) => {
  const db = readDB();
  res.json(db.patients.map(p => ({
    id: p.id, name: p.name, kana: p.kana, memo: p.memo,
    gender: p.gender, birthdate: p.birthdate,
    height: p.height, targetWeight: p.targetWeight,
    createdAt: p.createdAt,
    latestRecord: p.records?.slice(-1)[0] || null,
    recordCount: p.records?.length || 0,
    sessionCount: p.sessions?.length || 0
  })));
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
    weight: req.body.weight,
    pain: req.body.pain,
    posture: req.body.posture,
    moti: req.body.moti,
    exercise: req.body.exercise,
    memo: req.body.memo || '',
    source: req.body.source || 'staff', // 'staff' or 'patient'
    createdAt: new Date().toISOString()
  };
  if (!p.records) p.records = [];
  // 同日分は上書き
  const ei = p.records.findIndex(r => r.date === rec.date);
  if (ei >= 0) p.records[ei] = rec; else p.records.push(rec);
  p.records.sort((a,b) => a.date.localeCompare(b.date));
  writeDB(db);
  res.json(rec);
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
    weight: req.body.weight || null,
    pain: req.body.pain || null,
    posture: req.body.posture || null,
    treatment: req.body.treatment || '',
    response: req.body.response || '',
    homework: req.body.homework || '',
    nextPlan: req.body.nextPlan || '',
    staffNote: req.body.staffNote || '',
    duration: req.body.duration || null,
    createdAt: new Date().toISOString()
  };
  if (!p.sessions) p.sessions = [];
  p.sessions.push(session);
  p.sessions.sort((a,b) => a.date.localeCompare(b.date));
  writeDB(db);
  res.json(session);
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
  const rec = {
    id: uuidv4(),
    date: new Date().toISOString().slice(0,10),
    weight: req.body.weight,
    pain: req.body.pain,
    posture: req.body.posture,
    moti: req.body.moti,
    exercise: req.body.exercise,
    memo: req.body.memo || '',
    imported: false,
    createdAt: new Date().toISOString()
  };
  if (!p.patientRecords) p.patientRecords = [];
  const ei = p.patientRecords.findIndex(r => r.date === rec.date);
  if (ei >= 0) p.patientRecords[ei] = rec; else p.patientRecords.push(rec);
  writeDB(db);
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

app.listen(PORT, () => console.log(`BodyLog server running on http://0.0.0.0:${PORT}`));
