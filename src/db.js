import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(path.join(dataDir, 'uploads'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'smallworld.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE NOT NULL, name TEXT NOT NULL,
      password_hash TEXT, role TEXT NOT NULL CHECK(role IN ('admin','parent')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invitations (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('lesson-report','notice','word-rhythm')),
      status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
      visibility TEXT NOT NULL CHECK(visibility IN ('members','public')),
      excerpt TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '',
      lesson_date TEXT NOT NULL DEFAULT '', class_name TEXT NOT NULL DEFAULT '', featured INTEGER NOT NULL DEFAULT 0,
      published_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS posts_feed ON posts(status,visibility,category,published_at);
    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id), snapshot TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, filename TEXT UNIQUE NOT NULL, original_name TEXT NOT NULL,
      mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL,
      message TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (!db.prepare("SELECT 1 FROM settings WHERE key='seed-v1'").get()) {
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO posts (id,slug,title,category,status,visibility,excerpt,body,cover,featured,created_at,updated_at) VALUES (?,?,?,'notice','published','public',?,?,?,1,?,?)`);
    db.exec('BEGIN');
    try {
      const reading='月曜日18:00-19:00で、小学校高学年〜中学生対象。英語の絵本やリーダーなどの本を読む練習やシャドウイングをやります。また、授業の後半で英検や面接対策などを行います。';
      const toddler='new Toddler Class(3-5才)開講しました♪ 月曜18:00-19:00(毎週)と日曜日10:30-12:30(隔週)です。';
      insert.run('original-reading','reading-eiken-class','多読・英検クラス始めました',reading,`<p>${reading}</p>`,'/assets/f00f2c_7671cf6925ae4e8ba838538ee5adb9cb~mv2.png',now,now);
      insert.run('original-toddler','toddler-class','3~5才クラス開講しました！',toddler,`<p>${toddler}</p>`,'/assets/eabac4_5bd112a0ebe9492495951d2eee1857a5~mv2.png',now,now);
      db.prepare("INSERT INTO settings VALUES ('seed-v1','1')").run();
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}
