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
  console.log(`=== PUBLISHING TODAY'S (OCT 7) SCHEDULED POST ===`);
  console.log(`Current Time (IST): ${now.toFormat("yyyy-MM-dd HH:mm:ss")}`);

  // 1. Verify Instagram API connection
  const username = await checkToken();
  console.log(`Instagram connected: @${username}`);

  // 2. Find today's due post (Post #31 scheduled for 17:00 IST)
  const post = db.prepare("SELECT * FROM posts WHERE id = 31").get() as Post | undefined;
  if (!post) {
    throw new Error("Post #31 not found in DB");
  }

  console.log(`Target Post: #${post.id} (${post.kind})`);
  console.log(`Scheduled for: ${post.scheduled_at}`);
  console.log(`Caption preview: ${post.caption?.slice(0, 100)}...`);
  console.log(`Local file: ${post.src_path}`);

  // 3. Upload fresh media to public host
  console.log(`Uploading ${post.src_path}...`);
  const uploaded = await upload(post.src_path!, post.kind === "REEL" ? "video" : "image");
  console.log(`Public URL: ${uploaded.url}`);

  const isAlive = await verifyMediaUrl(uploaded.url);
  if (!isAlive) {
    throw new Error(`Public URL verification failed: ${uploaded.url}`);
  }
  console.log(`Media URL verified reachable.`);

  // 4. Update status to publishing
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

  // 5. Publish to Instagram
  console.log(`Publishing to Instagram Graph API...`);
  const result = await publishToInstagram(updatedPost);
  console.log(`SUCCESS! Live on Instagram:`, result);

  // 6. Record published in DB
  db.prepare(
    "UPDATE posts SET status = 'published', ig_media_id = ?, permalink = ?, published_at = datetime('now') WHERE id = ?"
  ).run(result.id, result.permalink, post.id);

  // 7. Notify Telegram
  await notify(`🚀 Published #${post.id} (${post.kind})\n${result.permalink}\n\n${post.caption?.split("\n")[0]}`).catch(() => {});

  // 8. Reschedule missed posts from Oct 6 to Oct 10 so queue is clean
  db.prepare("UPDATE posts SET scheduled_at = '2026-10-10T11:30:00.000Z' WHERE id = 30 AND status = 'approved'").run();
  db.prepare("UPDATE posts SET scheduled_at = '2026-10-10T13:30:00.000Z' WHERE id = 26 AND status = 'approved'").run();

  // 9. Check tonight's Reel
  const tonightReel = db.prepare("SELECT id, kind, scheduled_at, status FROM posts WHERE id = 27").get() as any;
  console.log(`Tonight's Reel (#${tonightReel?.id}): Scheduled for ${tonightReel?.scheduled_at} (7:00 PM IST) [${tonightReel?.status}]`);

  console.log(`\n========================================`);
  console.log(`RESULT_PERMALINK: ${result.permalink}`);
  console.log(`RESULT_MEDIA_ID: ${result.id}`);
  console.log(`========================================`);
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
