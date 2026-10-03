import { db } from '../src/db.ts';

const posts = db.prepare('SELECT id, kind, status, scheduled_at, caption, src_path FROM posts ORDER BY id DESC LIMIT 15').all();
console.log('--- RECENT POSTS ---');
console.log(JSON.stringify(posts, null, 2));

const memories = db.prepare('SELECT id, category, fact FROM memories').all();
console.log('--- MEMORIES ---');
console.log(JSON.stringify(memories, null, 2));

const projects = db.prepare('SELECT * FROM projects').all();
console.log('--- PROJECTS ---');
console.log(JSON.stringify(projects, null, 2));
