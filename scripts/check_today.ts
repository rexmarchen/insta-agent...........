import { db } from "../src/db.js";
import { checkToken } from "../src/instagram.js";

async function main() {
  console.log("=== CHECKING SETTINGS ===");
  const settings = db.prepare("SELECT * FROM settings").all();
  console.log(settings);

  console.log("\n=== CHECKING INSTAGRAM TOKEN ===");
  try {
    const username = await checkToken();
    console.log("Instagram connected successfully as:", username);
  } catch (err: any) {
    console.error("Instagram checkToken failed:", err.message);
  }

  console.log("\n=== POSTS SCHEDULED FOR TODAY (2026-10-05) ===");
  const todayPosts = db.prepare("SELECT id, kind, status, scheduled_at, published_at, media_url, src_path, substr(caption, 1, 100) as caption FROM posts WHERE scheduled_at LIKE '2026-10-05%' OR (status = 'approved' AND scheduled_at <= datetime('now')) ORDER BY scheduled_at ASC").all();
  console.log(JSON.stringify(todayPosts, null, 2));

  console.log("\n=== ALL PUBLISHED POSTS ===");
  const published = db.prepare("SELECT id, kind, status, scheduled_at, published_at, permalink FROM posts WHERE status = 'published' ORDER BY id ASC").all();
  console.log(JSON.stringify(published, null, 2));
}

main().catch(console.error);
