import { probeDuration } from "../src/media.js";
import fs from "node:fs/promises";

async function main() {
  const file = "work/gen-1790869502335-showcase_reel.mp4";
  const stat = await fs.stat(file);
  const dur = await probeDuration(file);
  console.log(`Video file: ${file}`);
  console.log(`Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Duration: ${dur.toFixed(2)} seconds`);
}

main().catch(console.error);
