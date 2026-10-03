import { DatabaseSync } from "node:sqlite";
import { publishToInstagram } from "../src/instagram.js";
import { notify } from "../src/bot.js";
import { log } from "../src/log.js";
import type { Post } from "../src/db.js";

async function main() {
  const db = new DatabaseSync("data/agent.db");
  const post = db.prepare("SELECT * FROM posts WHERE id = 25").get() as Post | undefined;

  if (!post) {
    console.error("Post #25 not found in DB");
    return;
  }

  console.log("Found post #25:", {
    id: post.id,
    kind: post.kind,
    caption: post.caption?.slice(0, 80) + "...",
    status: post.status
  });

  const validMediaUrl = "https://d.uguu.se/rUMRZsHR.mp4";
  console.log("Using validated media URL:", validMediaUrl);

  // Update post in DB
  db.prepare("UPDATE posts SET media_url = ?, cloud_id = ?, status = 'publishing', error = NULL WHERE id = 25").run(
    validMediaUrl,
    "uguu:rUMRZsHR.mp4"
  );

  const updatedPost: Post = {
    ...post,
    media_url: validMediaUrl,
    cloud_id: "uguu:rUMRZsHR.mp4",
    status: "publishing"
  };

  try {
    console.log("Publishing post #25 to Instagram...");
    const result = await publishToInstagram(updatedPost);
    console.log("Successfully published to Instagram!", result);

    db.prepare(
      "UPDATE posts SET status = 'published', ig_media_id = ?, permalink = ?, published_at = datetime('now') WHERE id = 25"
    ).run(result.id, result.permalink);

    await notify(`🚀 Published #${post.id}\n${result.permalink}`);
    console.log("Post #25 published and Telegram notified!");
  } catch (err: any) {
    console.error("Publishing post #25 failed:", err);
    db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = 25").run(err.message);
    await notify(`❌ Publishing #25 failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
