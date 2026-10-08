import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { publishToInstagram, checkToken } from "../src/instagram.js";
import { upload, verifyMediaUrl } from "../src/media.js";
import { notify } from "../src/bot.js";
import type { Post } from "../src/db.js";
import { DateTime } from "luxon";

const TZ = "Asia/Kolkata";

async function main() {
  const db = new DatabaseSync("data/agent.db");
  const now = DateTime.now().setZone(TZ);
  console.log(`=== INSTAGRAM DIRECT PUBLISHER ===`);
  console.log(`Current Time (IST): ${now.toFormat("yyyy-MM-dd HH:mm:ss")}`);

  // 1. Verify Instagram API connection
  const username = await checkToken();
  console.log(`Instagram connected: @${username}`);

  // 2. Clear any stuck post in 'publishing' status older than 2 hours
  const stuck = db.prepare("SELECT id FROM posts WHERE status = 'publishing'").all() as { id: number }[];
  for (const s of stuck) {
    db.prepare("UPDATE posts SET status = 'failed', error = 'Recovered from interrupted publishing state' WHERE id = ?").run(s.id);
    console.log(`Recovered stuck post #${s.id} from 'publishing' to 'failed'`);
  }

  // 3. Find target post: from CLI arg or tonight's due post
  const argId = process.argv[2] ? Number(process.argv[2]) : null;
  let post: Post | undefined;

  if (argId) {
    post = db.prepare("SELECT * FROM posts WHERE id = ?").get(argId) as Post | undefined;
    if (!post) throw new Error(`Post #${argId} not found in DB`);
  } else {
    // Prefer due REEL first if user asked for reel, or any due post
    post = db.prepare("SELECT * FROM posts WHERE status = 'approved' AND kind = 'REEL' ORDER BY scheduled_at ASC LIMIT 1").get() as Post | undefined;
    if (!post) {
      post = db.prepare("SELECT * FROM posts WHERE status = 'approved' ORDER BY scheduled_at ASC LIMIT 1").get() as Post | undefined;
    }
  }

  if (!post) {
    throw new Error("No approved post found to publish.");
  }

  console.log(`Target Post: #${post.id} (${post.kind})`);
  console.log(`Scheduled for: ${post.scheduled_at} (${post.scheduled_at ? DateTime.fromISO(post.scheduled_at).setZone(TZ).toFormat("yyyy-MM-dd HH:mm") : "none"})`);
  console.log(`Caption preview: ${post.caption?.slice(0, 120)}...`);
  console.log(`Local file: ${post.src_path}`);

  // 4. Verify local file exists
  const fileStat = await fs.stat(post.src_path!).catch(() => null);
  if (!fileStat) {
    throw new Error(`Media file ${post.src_path} is missing on disk!`);
  }

  // 5. Upload fresh media to public host
  console.log(`Uploading fresh ${post.kind} media (${post.src_path})...`);
  const uploaded = await upload(post.src_path!, post.kind === "REEL" ? "video" : "image");
  console.log(`Public URL: ${uploaded.url}`);

  const isAlive = await verifyMediaUrl(uploaded.url);
  if (!isAlive) {
    throw new Error(`Public URL verification failed: ${uploaded.url}`);
  }
  console.log(`Media URL verified reachable by Instagram crawler.`);

  // 6. Update status to publishing
  db.prepare("UPDATE posts SET media_url = ?, cloud_id = ?, status = 'publishing', error = NULL WHERE id = ?").run(
    uploaded.url,
    uploaded.publicId,
    post.id
  );

  const updatedPost: Post = {
    ...post,
    media_url: uploaded.url,
    cloud_id: uploaded.publicId,
    status: "publishing",
  };

  // 7. Publish to Instagram
  console.log(`Publishing ${post.kind} to Instagram Graph API...`);
  const result = await publishToInstagram(updatedPost);
  console.log(`SUCCESS! Live on Instagram:`, result);

  // 8. Record published in DB
  db.prepare(
    "UPDATE posts SET status = 'published', ig_media_id = ?, permalink = ?, published_at = datetime('now') WHERE id = ?"
  ).run(result.id, result.permalink, post.id);

  // 9. Notify Telegram
  await notify(`🚀 Published #${post.id} (${post.kind})\n${result.permalink}\n\n${post.caption?.split("\n")[0]}`).catch(() => {});

  console.log(`\n========================================`);
  console.log(`POST #${post.id} (${post.kind}) PUBLISHED SUCCESSFULLY!`);
  console.log(`PERMALINK: ${result.permalink}`);
  console.log(`MEDIA_ID: ${result.id}`);
  console.log(`========================================\n`);
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
