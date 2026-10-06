import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { cleanBody, localMedia, textOnly } from '../src/security.js';

const input=path.resolve(process.argv[2] || 'data/imported-posts.json');
const dataDir=path.resolve(process.env.DATA_DIR || 'data');
const posts=JSON.parse(await readFile(input,'utf8'));
if (!Array.isArray(posts)) throw new Error('Import file must contain a JSON array.');

const db=openDatabase(dataDir);
const upsert=db.prepare(`INSERT INTO posts
  (id,slug,title,category,status,visibility,excerpt,body,cover,lesson_date,class_name,featured,published_at,created_at,updated_at,version)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
  ON CONFLICT(slug) DO UPDATE SET title=excluded.title, category=excluded.category,
  status=excluded.status, visibility=excluded.visibility, excerpt=excluded.excerpt,
  body=excluded.body, cover=excluded.cover, published_at=excluded.published_at,
  updated_at=excluded.updated_at, version=posts.version+1`);
const allowedCategories=new Set(['lesson-report','notice','word-rhythm']);
let imported=0;
db.exec('BEGIN');
try {
  for (const post of posts) {
    const category=String(post.category || '');
    if (!allowedCategories.has(category)) throw new Error(`Invalid category: ${category}`);
    const slug=String(post.slug || '').trim().slice(0,200);
    const title=String(post.title || '').trim().slice(0,200);
    if (!slug || !title) throw new Error('Every post requires a slug and title.');
    const body=cleanBody(post.body);
    const excerpt=String(post.excerpt || textOnly(body)).replace(/\s+/g,' ').trim().slice(0,400);
    const publishedAt=new Date(post.published_at).toISOString();
    const createdAt=post.created_at ? new Date(post.created_at).toISOString() : publishedAt;
    const updatedAt=post.updated_at ? new Date(post.updated_at).toISOString() : publishedAt;
    upsert.run(randomUUID(),slug,title,category,'published','members',excerpt,body,localMedia(post.cover),'','',0,publishedAt,createdAt,updatedAt);
    imported++;
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally { db.close(); }
console.log(`Imported ${imported} protected posts from ${input}`);
