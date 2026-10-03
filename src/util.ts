import { log } from "./log.js";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FatalError extends Error {} // never retried (bad token, invalid request, etc.)

/** Retries transient failures with exponential backoff + jitter. FatalError is thrown straight through. */
export async function retry<T>(name: string, fn: () => Promise<T>, tries = 4, baseMs = 1500): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof FatalError) throw e;
      last = e;
      if (i === tries) break;
      const wait = baseMs * 2 ** (i - 1) + Math.random() * 500;
      log.warn({ err: (e as Error).message, attempt: i, wait: Math.round(wait) }, `${name} failed, retrying`);
      await sleep(wait);
    }
  }
  throw last;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
