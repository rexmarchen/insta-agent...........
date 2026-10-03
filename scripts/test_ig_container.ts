import { DatabaseSync } from "node:sqlite";

async function test() {
  const url = "https://d.uguu.se/rUMRZsHR.mp4";
  const head = await fetch(url, { method: "HEAD", headers: { "User-Agent": "facebookexternalhit/1.1" } });
  console.log("Uguu HEAD:", head.status, head.headers.get("content-type"), head.headers.get("content-length"));

  const db = new DatabaseSync("data/agent.db");
  const token = (db.prepare("SELECT value FROM settings WHERE key = 'ig_access_token'").get() as any).value;
  const userId = "39134971926150240";
  const base = "https://graph.instagram.com/v21.0";

  console.log("Sending container request to Instagram with Uguu URL...");
  const res = await fetch(`${base}/${userId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams({
      media_type: "REELS",
      video_url: url,
      caption: "Testing uguu upload",
      share_to_feed: "true"
    })
  });
  const json = await res.json();
  console.log("Instagram container response:", json);

  if (json.id) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const s = await (
        await fetch(`${base}/${json.id}?fields=status_code,status`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ).json();
      console.log("Poll", i, s);
      if (s.status_code === "FINISHED" || s.status_code === "ERROR") break;
    }
  }
}

test().catch(console.error);
