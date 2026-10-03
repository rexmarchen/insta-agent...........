import fsSync from "node:fs";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { retry } from "./util.js";

const run = promisify(execFile);
const BIG = { maxBuffer: 50 * 1024 * 1024 };
const VIDEO = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm"]);
const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export function findBin(name: "ffmpeg" | "ffprobe"): string {
  if (name === "ffmpeg" && process.env.FFMPEG_PATH && fsSync.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  if (name === "ffprobe" && process.env.FFPROBE_PATH && fsSync.existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH;
  }
  if (process.platform === "win32") {
    const wingetBin = path.join(
      process.env.LOCALAPPDATA ?? "",
      "Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin",
      `${name}.exe`
    );
    if (fsSync.existsSync(wingetBin)) return wingetBin;
  }
  return name;
}

export type Kind = "REEL" | "IMAGE";
export const ffmpeg = (args: string[]) => run(findBin("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", ...args], BIG);

export function kindOf(file: string): Kind | null {
  const ext = path.extname(file).toLowerCase();
  return VIDEO.has(ext) ? "REEL" : IMAGE.has(ext) ? "IMAGE" : null;
}

async function probe(file: string, entries: string, stream = false): Promise<string> {
  const args = ["-v", "error", ...(stream ? ["-select_streams", "v:0"] : []), "-show_entries", entries, "-of", "csv=p=0", file];
  return (await run(findBin("ffprobe"), args)).stdout.trim();
}

export const probeDuration = async (file: string) => parseFloat(await probe(file, "format=duration"));

function assertReelLength(duration: number) {
  if (!(duration >= 3)) throw new Error(`Video too short for a Reel (${duration.toFixed(1)}s, minimum 3s)`);
  if (duration > 900) throw new Error(`Video too long for a Reel (${Math.round(duration)}s, maximum 15 min)`);
}

/** Re-encode to Instagram Reels spec: 1080x1920, 30fps, H.264 + AAC, faststart. */
export async function prepareVideo(src: string, dir: string) {
  const duration = await probeDuration(src);
  assertReelLength(duration);
  const out = path.join(dir, `${Date.now()}-${path.parse(src).name}.mp4`);
  await ffmpeg([
    "-i", src,
    "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
    "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", out,
  ]);
  return { out, duration };
}

/** Videos we rendered ourselves already match the spec, so skip the lossy second encode. */
export async function passthroughVideo(src: string) {
  const duration = await probeDuration(src);
  assertReelLength(duration);
  return { out: src, duration };
}

/** Convert to JPEG (max 1440px wide). Rejects aspect ratios Instagram feed won't accept. */
export async function prepareImage(src: string, dir: string) {
  const [w, h] = (await probe(src, "stream=width,height", true)).split(",").map(Number);
  const ratio = w / h;
  if (ratio < 0.8 || ratio > 1.91) {
    throw new Error(`Image ratio ${ratio.toFixed(2)} is outside Instagram's 4:5 to 1.91:1 range. Crop it first.`);
  }
  const out = path.join(dir, `${Date.now()}-${path.parse(src).name}.jpg`);
  await ffmpeg(["-i", src, "-vf", "scale=min(1440\\,iw):-2", "-q:v", "2", out]);
  return { out };
}

/** Center-crop (cover) any image to exactly w x h. Used for generated images: 1080x1350 feed, 1080x1920 reel. */
export async function coverCrop(src: string, out: string, w: number, h: number) {
  await ffmpeg(["-i", src, "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`, "-q:v", "2", out]);
  return out;
}

/** Small JPEG frames so Claude can actually see the content. */
export async function extractFrames(video: string, dir: string, duration: number, n = 3) {
  const frames: string[] = [];
  for (let i = 1; i <= n; i++) {
    const out = path.join(dir, `${path.parse(video).name}-f${i}.jpg`);
    await ffmpeg(["-ss", ((duration * i) / (n + 1)).toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=768:-2", out]);
    frames.push(out);
  }
  return frames;
}

export async function thumbnail(image: string, dir: string) {
  const out = path.join(dir, `${path.parse(image).name}-thumb.jpg`);
  await ffmpeg(["-i", image, "-vf", "scale=768:-2", out]);
  return out;
}

export type Uploaded = { url: string; publicId: string };

/** Verifies that a public URL is accessible by Instagram's crawler and contains real data (> 0 bytes). */
export async function verifyMediaUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status !== 200) return false;
    const len = Number(res.headers.get("content-length") || "0");
    return len > 0;
  } catch {
    return false;
  }
}

async function uploadUguu(file: string, type: "image" | "video"): Promise<Uploaded> {
  const data = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mimeType = type === "video" ? "video/mp4" : ext === ".png" ? "image/png" : "image/jpeg";
  const form = new FormData();
  form.append("files[]", new Blob([data], { type: mimeType }), path.basename(file));
  const res = await fetch("https://uguu.se/upload", { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json()) as any;
  if (!json?.success || !json.files?.[0]?.url) {
    throw new Error(`Uguu upload failed: ${JSON.stringify(json)}`);
  }
  const url = json.files[0].url;
  const verified = await verifyMediaUrl(url);
  if (!verified) throw new Error(`Uguu returned unverified or empty file: ${url}`);
  return { url, publicId: `uguu:${json.files[0].hash || path.basename(file)}` };
}

async function uploadLitterbox(file: string, type: "image" | "video"): Promise<Uploaded> {
  const data = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mimeType = type === "video" ? "video/mp4" : ext === ".png" ? "image/png" : "image/jpeg";
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", "24h");
  form.append("fileToUpload", new Blob([data], { type: mimeType }), path.basename(file));
  const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
    method: "POST",
    headers: { "User-Agent": "Mozilla/5.0" },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const url = (await res.text()).trim();
  if (!url.startsWith("http")) throw new Error(`Litterbox upload error: ${url}`);
  const verified = await verifyMediaUrl(url);
  if (!verified) throw new Error(`Litterbox returned unverified or empty file: ${url}`);
  return { url, publicId: `litterbox:${path.basename(file)}` };
}

async function uploadTmpfiles(file: string, type: "image" | "video"): Promise<Uploaded> {
  const data = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mimeType = type === "video" ? "video/mp4" : ext === ".png" ? "image/png" : "image/jpeg";
  const form = new FormData();
  form.append("file", new Blob([data], { type: mimeType }), path.basename(file));
  const res = await fetch("https://tmpfiles.org/api/v1/upload", { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json()) as any;
  if (!json?.data?.url) throw new Error(`tmpfiles upload error: ${JSON.stringify(json)}`);
  const url = json.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
  return { url, publicId: `tmpfiles:${path.basename(file)}` };
}

async function uploadCatbox(file: string): Promise<Uploaded> {
  const data = await fs.readFile(file);
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", new Blob([data]), path.basename(file));
  const res = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  const url = (await res.text()).trim();
  if (!url.startsWith("http")) throw new Error(`Catbox upload error: ${url}`);
  const verified = await verifyMediaUrl(url);
  if (!verified) throw new Error(`Catbox returned 0-byte or inaccessible file: ${url}`);
  return { url, publicId: `catbox:${path.basename(file)}` };
}

/** Uploads media to a high-availability host and returns the public HTTPS URL Instagram will fetch. */
export async function upload(file: string, type: "image" | "video"): Promise<Uploaded> {
  const hasCloudinary = Boolean(process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_URL.includes("API_KEY"));
  if (hasCloudinary) {
    try {
      const opts = { resource_type: type, folder: "rexeditzz-agent" } as const;
      const res = (await retry("cloudinary upload", async () =>
        type === "video"
          ? cloudinary.uploader.upload_large(file, { ...opts, chunk_size: 6_000_000 })
          : cloudinary.uploader.upload(file, opts),
      )) as { secure_url: string; public_id: string };
      return { url: res.secure_url, publicId: res.public_id };
    } catch (e) {
      console.warn("Cloudinary upload failed, falling back to public hosts:", (e as Error).message);
    }
  }

  // Resilient multi-provider fallback chain
  const providers: Array<{ name: string; fn: () => Promise<Uploaded> }> = [
    { name: "uguu", fn: () => uploadUguu(file, type) },
    { name: "litterbox", fn: () => uploadLitterbox(file, type) },
    { name: "tmpfiles", fn: () => uploadTmpfiles(file, type) },
    { name: "catbox", fn: () => uploadCatbox(file) },
  ];

  for (const provider of providers) {
    try {
      return await retry(`${provider.name} upload`, provider.fn, 2);
    } catch (e) {
      console.warn(`Provider ${provider.name} upload failed, trying next:`, (e as Error).message);
    }
  }

  throw new Error("All media upload providers failed. Please check network connectivity or configure CLOUDINARY_URL.");
}

/** Cleans up uploaded media when no longer needed. */
export async function deleteUpload(publicId: string, type: "image" | "video") {
  if (!publicId || !publicId.includes("/")) return; // only Cloudinary public IDs contain slashes / folders
  await cloudinary.uploader.destroy(publicId, { resource_type: type, invalidate: true }).catch(() => {});
}

