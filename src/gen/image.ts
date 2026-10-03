import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { env } from "../config.js";
import { brand } from "../brand.js";
import { log } from "../log.js";
import { retry, FatalError, errMsg } from "../util.js";

export type Aspect = "4:5" | "9:16";
type Provider = (prompt: string, negative: string, aspect: Aspect, refImage?: string) => Promise<Buffer>;

const need = (v: string | undefined, name: string) => {
  if (!v) throw new FatalError(`${name} is not set`);
  return v;
};

async function json(res: Response): Promise<any> {
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `${res.status} ${JSON.stringify(body).slice(0, 300)}`;
    // 4xx (except 429) will not fix itself on retry
    throw res.status >= 500 || res.status === 429 ? new Error(msg) : new FatalError(msg);
  }
  return body;
}

/** Local GPU: AUTOMATIC1111 / Forge started with --api. Unlimited and free. */
const a1111: Provider = async (prompt, negative, aspect) => {
  const base = need(env.A1111_URL, "A1111_URL").replace(/\/$/, "");
  const [width, height] = aspect === "4:5" ? [832, 1040] : [768, 1344];
  const res = await fetch(`${base}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, negative_prompt: negative, steps: 28, width, height, cfg_scale: 6, sampler_name: "DPM++ 2M" }),
    signal: AbortSignal.timeout(300_000),
  });
  const b = await json(res);
  if (!b.images?.[0]) throw new Error("A1111 returned no image");
  return Buffer.from(b.images[0], "base64");
};

/** Cloudflare Workers AI, FLUX.1 schnell. Free daily allowance. */
const cloudflare: Provider = async (prompt, negative) => {
  const account = need(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const token = need(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: `${prompt}\nAvoid: ${negative}`, steps: 6 }),
    signal: AbortSignal.timeout(90_000),
  });
  const b = await json(res);
  const img = b.result?.image;
  if (!img) throw new Error("Cloudflare returned no image");
  return Buffer.from(img, "base64");
};

/** Google Gemini image model (free tier via AI Studio key). */
const gemini: Provider = async (prompt, negative, aspect) => {
  const key = need(env.GEMINI_API_KEY, "GEMINI_API_KEY");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_IMAGE_MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompt}\nAspect ratio ${aspect}. Avoid: ${negative}` }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const b = await json(res);
  const parts: any[] = b.candidates?.[0]?.content?.parts ?? [];
  const data = parts.map((p) => p.inlineData?.data ?? p.inline_data?.data).find(Boolean);
  if (!data) throw new Error("Gemini returned no image (possibly blocked by safety filters)");
  return Buffer.from(data, "base64");
};

/** OpenAI image provider (GPT-image edit or DALL-E) */
const openai: Provider = async (prompt, negative, aspect, refImagePath) => {
  const key = need(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  if (refImagePath && fsSync.existsSync(refImagePath)) {
    try {
      const formData = new FormData();
      const fileBytes = await fs.readFile(refImagePath);
      formData.append("image", new Blob([fileBytes], { type: "image/png" }), "reference.png");
      formData.append("prompt", prompt);
      formData.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
      formData.append("size", aspect === "4:5" ? "1024x1536" : "1024x1792");

      const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: formData,
        signal: AbortSignal.timeout(120_000),
      });
      const b = await json(res);
      const b64 = b.data?.[0]?.b64_json;
      if (b64) return Buffer.from(b64, "base64");
      const url = b.data?.[0]?.url;
      if (url) {
        const imgRes = await fetch(url);
        return Buffer.from(await imgRes.arrayBuffer());
      }
    } catch (e) {
      log.warn({ err: errMsg(e) }, "openai images/edits failed, falling back to generations");
    }
  }

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `${prompt}. Avoid: ${negative}`,
      model: process.env.OPENAI_IMAGE_MODEL || "dall-e-3",
      size: "1024x1792",
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const b = await json(res);
  const data = b.data?.[0]?.b64_json;
  if (!data) throw new Error("OpenAI returned no image");
  return Buffer.from(data, "base64");
};

const PROVIDERS: Record<string, Provider> = { a1111, cloudflare, gemini, openai };

export async function generateImage(
  scene: string,
  aspect: Aspect,
  outDir: string,
  opts?: { style?: string; negative?: string; rawPrompt?: boolean; refImage?: string }
): Promise<{ file: string; provider: string }> {
  const prompt = opts?.rawPrompt
    ? scene.trim()
    : opts?.style !== undefined
    ? `${scene.trim()}${opts.style ? `. ${opts.style}` : ""}`
    : `${scene.trim()}. ${brand.visual.style}`;
  const negative = opts?.negative ?? brand.visual.negative;
  const errors: string[] = [];

  for (const name of env.IMAGE_PROVIDERS.split(",").map((s) => s.trim()).filter(Boolean)) {
    const provider = PROVIDERS[name];
    if (!provider) {
      errors.push(`${name}: unknown provider`);
      continue;
    }
    try {
      const buf = await retry(`image:${name}`, () => provider(prompt, negative, aspect, opts?.refImage), 2, 2000);
      await fs.mkdir(outDir, { recursive: true });
      const file = path.join(outDir, `gen-${Date.now()}-${name}.png`);
      await fs.writeFile(file, buf);
      return { file, provider: name };
    } catch (e) {
      log.warn({ provider: name, err: errMsg(e) }, "image provider failed, trying next");
      errors.push(`${name}: ${errMsg(e)}`);
    }
  }
  throw new Error(`All image providers failed:\n${errors.join("\n")}`);
}
