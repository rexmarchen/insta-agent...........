/** Pure caption helpers (no I/O) so they are easy to test. */

export function cleanHashtags(tags: string[], max = 5): string[] {
  const out = tags
    .map((t) => "#" + t.replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase())
    .filter((t) => t.length > 2); // a lone letter is noise
  return [...new Set(out)].slice(0, max);
}

export function finalizeCaption(body: string, tags: string[]): string {
  const hashtags = cleanHashtags(tags).join(" ");
  const text = body.trim();
  // Instagram caps captions at 2200 chars. Trim the body, never the hashtags.
  const room = 2200 - (hashtags ? hashtags.length + 2 : 0);
  return hashtags ? `${text.slice(0, room).trim()}\n\n${hashtags}` : text.slice(0, 2200);
}

/** Returns a list of problems. An empty list means the caption is safe to publish. */
export function captionProblems(caption: string, banned: string[] = []): string[] {
  const problems: string[] = [];
  if (!caption.trim()) problems.push("caption is empty");
  if (caption.length > 2200) problems.push("caption is over 2200 characters");
  if ((caption.match(/#\p{L}[\p{L}\p{N}_]*/gu) ?? []).length > 30) problems.push("more than 30 hashtags");
  const lower = caption.toLowerCase();
  for (const b of banned) if (b && lower.includes(b.toLowerCase())) problems.push(`contains banned phrase "${b}"`);
  return problems;
}
