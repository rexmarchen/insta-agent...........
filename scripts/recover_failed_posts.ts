import { db } from "../src/db.ts";

const r = db.prepare("UPDATE posts SET status = 'drafted', error = NULL WHERE error = 'env is not defined'").run();
console.log(`Recovered ${r.changes} posts from 'env is not defined' error.`);

const posts = db.prepare("SELECT id, kind, status, scheduled_at, caption FROM posts WHERE status = 'drafted'").all();
console.log("Drafted posts ready for approval or scheduling:", posts.length);
