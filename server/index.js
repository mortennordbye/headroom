const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'database.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS finance_data (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL
  )
`);

const getStmt = db.prepare('SELECT content FROM finance_data WHERE id = ?');
const upsertStmt = db.prepare('INSERT OR REPLACE INTO finance_data (id, content) VALUES (?, ?)');

app.get('/api/data', (req, res) => {
  const row = getStmt.get('headroom');
  res.json(row ? JSON.parse(row.content) : null);
});

app.post('/api/data', (req, res) => {
  upsertStmt.run('headroom', JSON.stringify(req.body));
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on :${PORT}`));
