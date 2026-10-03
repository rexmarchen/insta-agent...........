import fs from "node:fs/promises";
import { env, DRY_RUN } from "./config.js";
import { setSetting, type Post } from "./db.js";
import { log } from "./log.js";
import { FatalError, retry, sleep } from "./util.js";

export function getGraphBase(tokenOverride?: string): string {
  if (process.env.IG_GRAPH_BASE) return process.env.IG_GRAPH_BASE.replace(/\/$/, "");
  const token = tokenOverride ?? env.IG_ACCESS_TOKEN ?? "";
  // Instagram user tokens (IGAA..., IGLQ..., etc.) use graph.instagram.com
  if (token.startsWith("IG")) {
    return `https://graph.instagram.com/${env.GRAPH_VERSION}`;
  }
  return `https://graph.facebook.com/${env.GRAPH_VERSION}`;
}

/** Token expired/revoked. Caller should pause publishing and alert the owner. */
export class AuthError extends FatalError {}
/** Instagram's rolling 24h publish limit was hit. Not a failure: the post is simply postponed. */
export class QuotaError extends Error {}

// Graph error codes: 190 = token invalid, 4/17/32/613 = rate limits (transient), 1/2 = transient server errors.
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

async function graph(method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<any> {
  const base = getGraphBase();
  return retry(`graph ${method} ${path}`, async () => {
    const headers = { Authorization: `Bearer ${env.IG_ACCESS_TOKEN}` }; // header, so the token never lands in a URL or log
    const qs = new URLSearchParams(params);
    const res =
      method === "GET"
        ? await fetch(`${base}${path}?${qs}`, { headers, signal: AbortSignal.timeout(30_000) })
        : await fetch(`${base}${path}`, { method, headers, body: qs, signal: AbortSignal.timeout(60_000) });
    const json: any = await res.json().catch(() => ({}));
    if (res.ok && !json.error) return json;

    const code: number | undefined = json.error?.code;
    const errText: string = json.error?.message ?? res.statusText;
    const msg = `Graph API ${path}: ${errText}`;
    const isBlocked = code === 200 && /access blocked|permission|checkpoint|restricted|developer/i.test(errText);
    if (code === 190 || res.status === 401 || isBlocked) {
      const hint = isBlocked
        ? " (Meta has blocked API access. Action required in Meta Developer portal developers.facebook.com: account confirmation or generate a new token)"
        : " (access token invalid or expired)";
      throw new AuthError(`${msg}${hint}`);
    }
    if (res.status >= 500 || (code && TRANSIENT_CODES.has(code))) throw new Error(msg); // retry
    throw new FatalError(msg); // bad request: retrying will not help
  });
}

/** Reels/videos are processed async; wait until the container is FINISHED. */
async function waitUntilReady(containerId: string) {
  for (let i = 0; i < 60; i++) {
    const s = await graph("GET", `/${containerId}`, { fields: "status_code,status" });
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED" || !s.status_code) return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new FatalError(`Instagram rejected the media: ${s.status ?? s.status_code}`);
    }
    await sleep(10_000);
  }
  throw new Error("Timed out waiting for Instagram to process the media");
}

/** Instagram allows up to 25-100 API posts per 24h. Returns false if we are at the limit. */
async function hasPublishingQuota(): Promise<boolean> {
  try {
    const r = await graph("GET", `/${env.IG_USER_ID}/content_publishing_limit`, { fields: "quota_usage,config" });
    const used = r.data?.[0]?.quota_usage ?? 0;
    const total = r.data?.[0]?.config?.quota_total ?? 25;
    return used < total;
  } catch (e) {
    log.warn({ err: (e as Error).message }, "could not read publishing limit, continuing");
    return true;
  }
}

/** Daily health check. Throws AuthError if the token no longer works. */
export async function checkToken(): Promise<string> {
  const me = await graph("GET", `/${env.IG_USER_ID}`, { fields: "username" });
  return (me.username as string) ?? "unknown";
}

/**
 * Refreshes an Instagram long-lived access token.
 * Extends expiration by another 60 days automatically.
 */
export async function refreshLongLivedToken(): Promise<{ access_token: string; expires_in: number }> {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${env.IG_ACCESS_TOKEN}`;
  const res = await fetch(url);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new AuthError(`Token refresh failed: ${json.error?.message ?? res.statusText}`);
  }

  const newToken = json.access_token as string;
  const expiresIn = json.expires_in as number;

  // Update in-memory config and database
  env.IG_ACCESS_TOKEN = newToken;
  setSetting("ig_access_token", newToken);
  setSetting("ig_token_refreshed_at", new Date().toISOString());

  // Also update .env file if it exists
  try {
    const envPath = ".env";
    const content = await fs.readFile(envPath, "utf-8").catch(() => "");
    if (content) {
      const updated = content.replace(/^IG_ACCESS_TOKEN=.*$/m, `IG_ACCESS_TOKEN=${newToken}`);
      await fs.writeFile(envPath, updated, "utf-8");
    }
  } catch (e) {
    log.warn({ err: (e as Error).message }, "could not write new token to .env");
  }

  log.info({ expiresInDays: Math.round(expiresIn / 86400) }, "Instagram long-lived token refreshed successfully");
  return { access_token: newToken, expires_in: expiresIn };
}

/**
 * Updates and validates a new Instagram access token.
 * Syncs to runtime memory, SQLite DB settings, and updates the .env file.
 */
export async function updateAccessToken(newToken: string): Promise<string> {
  const cleanToken = newToken.trim();
  if (!cleanToken) throw new Error("Token cannot be empty");

  const prevToken = env.IG_ACCESS_TOKEN;
  env.IG_ACCESS_TOKEN = cleanToken;
  try {
    const account = await checkToken();
    setSetting("ig_access_token", cleanToken);
    setSetting("ig_token_refreshed_at", new Date().toISOString());
    setSetting("paused", "0"); // Automatically resume publishing on valid token

    try {
      const envPath = ".env";
      const content = await fs.readFile(envPath, "utf-8").catch(() => "");
      if (content) {
        const updated = content.replace(/^IG_ACCESS_TOKEN=.*$/m, `IG_ACCESS_TOKEN=${cleanToken}`);
        await fs.writeFile(envPath, updated, "utf-8");
      }
    } catch (e) {
      log.warn({ err: (e as Error).message }, "could not write new token to .env");
    }

    log.info({ account }, "Instagram access token updated and verified successfully");
    return account;
  } catch (err) {
    env.IG_ACCESS_TOKEN = prevToken;
    throw err;
  }
}

export async function publishToInstagram(post: Post): Promise<{ id: string; permalink: string }> {
  if (!post.caption) throw new FatalError("Post has no caption");

  if (DRY_RUN) {
    log.info({ post: post.id, kind: post.kind }, "[DRY_RUN] would publish");
    return { id: "dry-run", permalink: "(dry run, nothing was posted)" };
  }
  if (!(await hasPublishingQuota())) throw new QuotaError("Instagram 24h publishing limit reached");

  const params: Record<string, string> =
    post.kind === "REEL"
      ? { media_type: "REELS", video_url: post.media_url, caption: post.caption, share_to_feed: "true" }
      : { image_url: post.media_url, caption: post.caption, ...(post.alt_text ? { alt_text: post.alt_text } : {}) };

  const container = await graph("POST", `/${env.IG_USER_ID}/media`, params);
  await waitUntilReady(container.id);
  const published = await graph("POST", `/${env.IG_USER_ID}/media_publish`, { creation_id: container.id });
  const info = await graph("GET", `/${published.id}`, { fields: "permalink" });
  return { id: published.id, permalink: info.permalink };
}

export type RawMetrics = { reach: number; saved: number; shares: number; likes: number; comments: number };

export async function fetchInsights(mediaId: string): Promise<RawMetrics> {
  const out: RawMetrics = { reach: 0, saved: 0, shares: 0, likes: 0, comments: 0 };
  try {
    const ins = await graph("GET", `/${mediaId}/insights`, { metric: "reach,saved,shares" });
    for (const m of ins.data ?? []) {
      const v = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      if (m.name in out) (out as any)[m.name] = v;
    }
  } catch (e) {
    if (e instanceof AuthError) throw e;
    log.warn({ err: (e as Error).message, mediaId }, "insights unavailable");
  }
  try {
    const basic = await graph("GET", `/${mediaId}`, { fields: "like_count,comments_count" });
    out.likes = basic.like_count ?? 0;
    out.comments = basic.comments_count ?? 0;
  } catch (e) {
    log.warn({ err: (e as Error).message, mediaId }, "basic metrics unavailable");
  }
  return out;
}
