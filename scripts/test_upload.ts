import { upload, verifyMediaUrl } from "../src/media.js";

async function main() {
  console.log("Testing upload for work/gen-1791032402029-feed.jpg...");
  const res = await upload("work/gen-1791032402029-feed.jpg", "image");
  console.log("Upload result:", res);
  const alive = await verifyMediaUrl(res.url);
  console.log("Verified alive:", alive);
}

main().catch(console.error);
