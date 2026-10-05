import { db } from "../src/db.js";
import fs from "node:fs/promises";
import { verifyMediaUrl } from "../src/media.js";

async function main() {
  const ids = [28, 14, 29, 15];
  for (const id of ids) {
    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as any;
    if (!post) continue;
    const localExists = await fs.stat(post.src_path).then(() => true).catch(() => false);
    const urlAlive = post.media_url ? await verifyMediaUrl(post.media_url) : false;
    console.log(`Post #${post.id} (${post.kind}):`);
    console.log(`  scheduled_at: ${post.scheduled_at}`);
    console.log(`  src_path: ${post.src_path} (exists: ${localExists})`);
    console.log(`  media_url: ${post.media_url} (alive: ${urlAlive})`);
    console.log(`  caption: ${post.caption}`);
    console.log("-----------------------------------------");
  }
}

main().catch(console.error);
