import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";

async function uploadUguu(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isVideo = ext === ".mp4" || ext === ".mov";
  const mimeType = isVideo ? "video/mp4" : ext === ".png" ? "image/png" : "image/jpeg";
  const form = new FormData();
  form.append("files[]", new Blob([data], { type: mimeType }), path.basename(filePath));
  const res = await fetch("https://uguu.se/upload", { method: "POST", body: form });
  const json = (await res.json()) as any;
  if (!json.success || !json.files?.[0]?.url) {
    throw new Error(`Uguu upload failed: ${JSON.stringify(json)}`);
  }
  return json.files[0].url;
}

async function verifyUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "facebookexternalhit/1.1" },
      signal: AbortSignal.timeout(10000)
    });
    const len = Number(res.headers.get("content-length") || "0");
    return res.status === 200 && len > 0;
  } catch {
    return false;
  }
}

async function main() {
  const db = new DatabaseSync("data/agent.db");
  const posts = db
    .prepare("SELECT id, kind, status, scheduled_at, media_url, src_path FROM posts WHERE status IN ('approved', 'drafted', 'new') ORDER BY scheduled_at ASC")
    .all() as any[];

  console.log(`Found ${posts.length} pending posts:`);
  for (const p of posts) {
    const valid = p.media_url ? await verifyUrl(p.media_url) : false;
    console.log(`Post #${p.id} [${p.kind}] status=${p.status} scheduled=${p.scheduled_at} validUrl=${valid} url=${p.media_url}`);

    if (!valid && p.src_path) {
      console.log(`Fixing Post #${p.id}: Re-uploading from ${p.src_path}...`);
      try {
        const newUrl = await uploadUguu(p.src_path);
        const verified = await verifyUrl(newUrl);
        if (verified) {
          db.prepare("UPDATE posts SET media_url = ?, cloud_id = ? WHERE id = ?").run(
            newUrl,
            `uguu:${path.basename(newUrl)}`,
            p.id
          );
          console.log(`✅ Post #${p.id} fixed with new verified URL: ${newUrl}`);
        } else {
          console.error(`❌ Post #${p.id} new URL verification failed`);
        }
      } catch (err: any) {
        console.error(`❌ Post #${p.id} re-upload failed:`, err.message);
      }
    }
  }
}

main().catch(console.error);
