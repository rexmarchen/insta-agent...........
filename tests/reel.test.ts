import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReelSpec, clip, ffPath, renderReel, wrapText } from "../src/gen/reel.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return fs.existsSync(process.env.BRAND_FONT ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
  } catch {
    return false;
  }
})();

describe("text layout", () => {
  it("wraps by width and never returns empty lines", () => {
    const lines = wrapText("Open with the best exterior shot in the first two seconds", 780, 50);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length > 0 && l.length <= 25)).toBe(true);
  });

  it("clips at a word boundary", () => {
    expect(clip("one two three four five", 12)).toBe("one two…");
    expect(clip("short", 12)).toBe("short");
  });

  it("escapes Windows paths for ffmpeg filters", () => {
    expect(ffPath("C:\\Windows\\Fonts\\arialbd.ttf")).toBe("C\\:/Windows/Fonts/arialbd.ttf");
  });

  it("keeps worst-case tips content inside Instagram's safe area", () => {
    const spec = buildReelSpec({
      template: "tips",
      headline: "x".repeat(20) + " " + "y".repeat(20) + " " + "z".repeat(6),
      tips: Array(4).fill("word ".repeat(11).trim()),
      cta: "Save this for later",
    });
    const contentTexts = spec.texts.filter((t) => t.t0 < spec.endCardAt);
    for (const t of contentTexts) expect(t.y + t.size).toBeLessThanOrEqual(1560);
    expect(spec.duration).toBeGreaterThan(8);
  });
});

describe.skipIf(!hasFfmpeg)("ffmpeg render", () => {
  it("renders a valid 1080x1920 Reel", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
    const out = path.join(dir, "q.mp4");
    const r = await renderReel({ template: "quote", statement: "Your listing video is your first showing.", subtext: "Make the first 3 seconds count.", cta: "Save this" }, out, { workDir: dir });
    const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]).toString().trim().replace(/,+$/, "");
    expect(probe).toBe("1080,1920");
    expect(r.duration).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
