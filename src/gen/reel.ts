import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config.js";
import { brand } from "../brand.js";
import { ffmpeg } from "../media.js";

/** ---------- Pure layout (unit tested) ---------- */

export type ReelContent =
  | { template: "tips"; headline: string; tips: string[]; cta: string }
  | { template: "quote"; statement: string; subtext: string; cta: string }
  | { template: "showcase"; softwareName: string; problemHook: string; features: string[]; cta: string };

export type TextItem = { text: string; size: number; x: number; y: number; t0: number; color: string };
export type BoxItem = { x: number; y: number; w: number; h: number; color: string; t0: number };
export type ReelSpec = { duration: number; texts: TextItem[]; boxes: BoxItem[]; endCardAt: number };

const W = 1080;
const MARGIN = 90;
const SAFE_BOTTOM = 1500; // Instagram UI covers the bottom of a Reel
const P = brand.visual.palette;

export const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).trim() + "…";
};

/** Greedy word wrap by character budget derived from the font size (bold sans is ~0.62em per char). */
export function wrapText(text: string, widthPx: number, size: number): string[] {
  const maxChars = Math.max(6, Math.floor(widthPx / (size * 0.62)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if ((line + " " + word).length <= maxChars) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const block = (text: string, size: number, x: number, y: number, t0: number, color: string, widthPx: number, stagger = 0.12) => {
  const lines = wrapText(text, widthPx, size);
  const lh = Math.round(size * 1.25);
  return {
    items: lines.map((l, i) => ({ text: l, size, x, y: y + i * lh, t0: t0 + i * stagger, color })),
    height: lines.length * lh,
  };
};

export function buildReelSpec(c: ReelContent): ReelSpec {
  const isWebsitePredictor = c.template === "showcase" && /future|predict|website|builder/i.test((c.softwareName ?? "") + " " + (c.problemHook ?? ""));
  const brandTitle = isWebsitePredictor ? "REXION · AI FUTURE PREDICTOR" : "REXION · AI CAREER PLATFORM";
  const texts: TextItem[] = [{ text: brandTitle, size: 28, x: MARGIN, y: 190, t0: 0.2, color: P.crimson }];
  const boxes: BoxItem[] = [{ x: MARGIN, y: 230, w: 120, h: 3, color: P.crimson, t0: 0.4 }];

  if (c.template === "showcase") {
    const features = c.features.slice(0, 3).map((f) => clip(f, 65));
    const h = block(clip(c.problemHook, 55), 48, MARGIN, 240, 0.5, P.text, W - 2 * MARGIN);
    texts.push(...h.items);
    const rule = 240 + h.height + 18;
    boxes.push({ x: MARGIN, y: rule, w: 160, h: 3, color: P.crimson, t0: 1.0 });

    const softName = (c.softwareName || "REXION").toUpperCase();
    const soft = block(`MEET ${softName}`, 40, MARGIN, rule + 25, 1.8, P.crimson, W - 2 * MARGIN);
    texts.push(...soft.items);

    let y = rule + 25 + soft.height + 30;
    features.forEach((feat, i) => {
      const t0 = 3.2 + i * 2.6;
      texts.push({ text: "•", size: 36, x: MARGIN, y: y - 2, t0, color: P.crimson });
      const b = block(feat, 32, MARGIN + 35, y, t0 + 0.1, P.text, W - MARGIN - (MARGIN + 35));
      texts.push(...b.items);
      y += Math.max(b.height, 32 * 1.3) + 22;
    });

    const endCardAt = 3.2 + features.length * 2.6 + 0.8;
    const duration = endCardAt + 2.8;
    return finish({ duration, texts, boxes, endCardAt }, c.cta);
  }

  if (c.template === "tips") {
    const tips = c.tips.slice(0, 4).map((t) => clip(t, 60));
    let headSize = 62;
    let tipSize = 38;
    let laid: { texts: TextItem[]; rule: number; bottom: number } | null = null;

    for (let attempt = 0; attempt < 8 && !laid; attempt++) {
      const out: TextItem[] = [];
      const h = block(clip(c.headline, 48), headSize, MARGIN, 260, 0.5, P.text, W - 2 * MARGIN);
      out.push(...h.items);
      const rule = 260 + h.height + 20;
      let y = rule + 40;
      tips.forEach((tip, i) => {
        const t0 = 3.0 + i * 3.0;
        const num = String(i + 1).padStart(2, "0");
        out.push({ text: num, size: tipSize + 2, x: MARGIN, y, t0, color: P.crimson });
        const b = block(tip, tipSize, MARGIN + 85, y, t0 + 0.1, P.text, W - MARGIN - (MARGIN + 85));
        out.push(...b.items);
        y += Math.max(b.height, tipSize * 1.3) + 28;
      });
      if (y <= 740 || (headSize <= 46 && tipSize <= 30)) laid = { texts: out, rule, bottom: y };
      else {
        headSize = Math.max(46, headSize - 4);
        tipSize = Math.max(30, tipSize - 3);
      }
    }
    const l = laid!;
    texts.push(...l.texts);
    boxes.push({ x: MARGIN, y: l.rule, w: 180, h: 3, color: P.crimson, t0: 1.0 });
    const endCardAt = 3.0 + tips.length * 3.0 + 0.6;
    const duration = endCardAt + 2.8;
    return finish({ duration, texts, boxes, endCardAt }, c.cta);
  }

  // quote
  const st = block(clip(c.statement, 90), 62, MARGIN, 280, 0.5, P.text, W - 2 * MARGIN, 0.18);
  texts.push(...st.items);
  const sub = block(clip(c.subtext, 70), 38, MARGIN, 280 + st.height + 40, 2.4, P.crimson, W - 2 * MARGIN);
  texts.push(...sub.items);
  boxes.push({ x: MARGIN, y: 280 + st.height + 20, w: 160, h: 3, color: P.crimson, t0: 2.0 });
  const endCardAt = 5.4;
  return finish({ duration: endCardAt + 2.6, texts, boxes, endCardAt }, c.cta);
}

/** Adds the end card: a clean warm cream cover with the CTA in large type. */
function finish(spec: ReelSpec, cta: string): ReelSpec {
  const t0 = spec.endCardAt + 0.3;
  const c = block(clip(cta, 40), 56, MARGIN, 540, t0, P.crimson, W - 2 * MARGIN);
  spec.texts.push(...c.items);
  spec.texts.push({ text: "rexion.ai", size: 44, x: MARGIN, y: 540 + c.height + 35, t0: t0 + 0.3, color: P.text });
  spec.texts.push({ text: "AI CAREER PLATFORM", size: 26, x: MARGIN, y: 540 + c.height + 95, t0: t0 + 0.5, color: P.crimson });
  spec.boxes.push({ x: MARGIN, y: 505, w: 100, h: 3, color: P.crimson, t0 });
  return spec;
}

/** ---------- ffmpeg rendering ---------- */

/** Escapes a path for use inside an ffmpeg filter option (handles Windows drive letters). */
export const ffPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

const ease = (t0: number) => `min(1,max(0,(t-${t0})/0.45))`;

export function buildFilter(spec: ReelSpec, textFiles: string[], hasImageBg: boolean): string {
  const bg = hasImageBg
    ? `[0:v]scale=1242:2208:force_original_aspect_ratio=increase,crop=1242:2208,` +
      `zoompan=z='1+0.0002*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30`
    : `[0:v]`;

  const parts: string[] = [];
  // Clean minimal top progress bar in terracotta
  parts.push(`drawbox=x=0:y=0:w='min(${W},${W}*(t/${spec.duration.toFixed(2)}))':h=5:color=${brand.visual.palette.crimson}:t=fill`);

  // Floating upper card: warm cream with soft rounded appearance and subtle border, leaving the lower desk & laptop fully visible!
  parts.push(`drawbox=x=60:y=150:w=960:h=660:color=0xFAF7F2@0.94:t=fill:enable='lt(t,${spec.endCardAt})'`);
  parts.push(`drawbox=x=60:y=150:w=960:h=660:color=0xDE6B48@0.35:t=2:enable='lt(t,${spec.endCardAt})'`);

  // Content boxes/texts that appear before the end card, then the cover, then the end-card items.
  const before = (t0: number) => t0 < spec.endCardAt;
  const drawBox = (b: BoxItem) => `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=${b.color}:t=fill:enable='gte(t,${b.t0})'`;
  const drawText = (t: TextItem, i: number) =>
    `drawtext=fontfile='${ffPath(env.BRAND_FONT)}':textfile='${ffPath(textFiles[i])}':fontsize=${t.size}:fontcolor=${t.color}:` +
    `shadowcolor=0x000000@0.15:shadowx=1:shadowy=1:x=${t.x}:y='${t.y}+12*(1-${ease(t.t0)})':alpha='${ease(t.t0)}':enable='gte(t,${t.t0})'`;

  spec.boxes.filter((b) => before(b.t0)).forEach((b) => parts.push(drawBox(b)));
  spec.texts.forEach((t, i) => before(t.t0) && parts.push(drawText(t, i)));
  // End card: semi-translucent warm cream backdrop over the cozy workspace instead of an abrupt black/solid wipe
  parts.push(`drawbox=x=0:y=0:w=${W}:h=1920:color=0xFAF7F2@0.88:t=fill:enable='gte(t,${spec.endCardAt})'`);
  parts.push(`drawbox=x=60:y=450:w=960:h=420:color=0xFFFFFF@0.94:t=fill:enable='gte(t,${spec.endCardAt})'`);
  parts.push(`drawbox=x=60:y=450:w=960:h=420:color=0xDE6B48@0.35:t=2:enable='gte(t,${spec.endCardAt})'`);
  spec.boxes.filter((b) => !before(b.t0)).forEach((b) => parts.push(drawBox(b)));
  spec.texts.forEach((t, i) => !before(t.t0) && parts.push(drawText(t, i)));

  return `${bg},${parts.join(",")},fade=t=in:st=0:d=0.3[v]`;
}

function musicFile(): Promise<string | null> {
  return fs
    .readdir("assets/music")
    .then((f) => {
      const tracks = f.filter((n) => /\.(mp3|m4a|wav|aac)$/i.test(n));
      return tracks.length ? path.join("assets/music", tracks[Math.floor(Math.random() * tracks.length)]) : null;
    })
    .catch(() => null);
}

/** Renders a 1080x1920 30fps Reel with animated text. Optionally over a (generated) background image and royalty-free music you own. */
export async function renderReel(content: ReelContent, out: string, opts: { bgImage?: string; workDir: string }): Promise<{ file: string; duration: number }> {
  const spec = buildReelSpec(content);
  await fs.mkdir(opts.workDir, { recursive: true });

  const textFiles: string[] = [];
  for (let i = 0; i < spec.texts.length; i++) {
    const f = path.join(opts.workDir, `t-${Date.now()}-${i}.txt`);
    await fs.writeFile(f, spec.texts[i].text, "utf8"); // no trailing newline
    textFiles.push(f);
  }

  const D = spec.duration.toFixed(2);
  const music = await musicFile();
  const sfxPath = "assets/sfx/tech_whoosh.wav";
  const hasSfx = false; // clean peaceful aesthetic, no robotic whooshes

  const fallbackBg = (await fs.stat("assets/reference_rexion.png").catch(() => null))?.isFile()
    ? "assets/reference_rexion.png"
    : undefined;
  const chosenBg = opts.bgImage || fallbackBg;

  const args: string[] = [];
  if (chosenBg) args.push("-loop", "1", "-framerate", "30", "-t", D, "-i", chosenBg);
  else {
    const p = brand.visual.palette;
    args.push("-f", "lavfi", "-i", `gradients=s=1080x1920:r=30:d=${D}:c0=${p.background}:c1=0xF0E6D8:x0=0:y0=0:x1=1080:y1=1920:speed=0.008`);
  }
  if (music) args.push("-stream_loop", "-1", "-i", music);
  else args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");

  let audioFilter = "";
  if (music) {
    if (hasSfx) {
      args.push("-i", sfxPath);
      audioFilter =
        `;[2:a]adelay=400|400,volume=0.7[sw1];` +
        `[2:a]adelay=1800|1800,volume=0.7[sw2];` +
        `[1:a]volume=0.55,afade=t=in:st=0:d=0.5,afade=t=out:st=${(spec.duration - 1.2).toFixed(2)}:d=1.2[bgm];` +
        `[bgm][sw1][sw2]amix=inputs=3:duration=first:dropout_transition=2[a]`;
    } else {
      audioFilter = `;[1:a]volume=0.55,afade=t=in:st=0:d=0.5,afade=t=out:st=${(spec.duration - 1.2).toFixed(2)}:d=1.2[a]`;
    }
  }

  const filter = buildFilter(spec, textFiles, !!chosenBg) + audioFilter;

  try {
    await ffmpeg([
      ...args,
      "-filter_complex", filter,
      "-map", "[v]", "-map", music ? "[a]" : "1:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart",
      "-t", D, out,
    ]);
  } finally {
    await Promise.all(textFiles.map((f) => fs.rm(f, { force: true })));
  }
  return { file: out, duration: spec.duration };
}
