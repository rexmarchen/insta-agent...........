import { upload, verifyMediaUrl } from "../src/media.js";

async function main() {
  console.log("Testing upload for work/gen-1790869502335-showcase_reel.mp4...");
  const res = await upload("work/gen-1790869502335-showcase_reel.mp4", "video");
  console.log("Upload result:", res);
  const alive = await verifyMediaUrl(res.url);
  console.log("Verified alive:", alive);
}

main().catch(console.error);
