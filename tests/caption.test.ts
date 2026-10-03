import { describe, expect, it } from "vitest";
import { captionProblems, cleanHashtags, finalizeCaption } from "../src/caption.js";

describe("caption helpers", () => {
  it("cleans, dedupes and caps hashtags", () => {
    expect(cleanHashtags(["#Real Estate", "realestate", "#Reels!", "a", "x1", "x2", "x3"], 5)).toEqual(["#realestate", "#reels", "#x1", "#x2", "#x3"]);
  });

  it("never exceeds 2200 chars and keeps the hashtags", () => {
    const out = finalizeCaption("word ".repeat(1000), ["one", "two", "three"]);
    expect(out.length).toBeLessThanOrEqual(2200);
    expect(out.endsWith("#one #two #three")).toBe(true);
  });

  it("flags empty, oversized and banned captions", () => {
    expect(captionProblems("")).toContain("caption is empty");
    expect(captionProblems("a".repeat(2201))).toContain("caption is over 2200 characters");
    expect(captionProblems("This is GUARANTEED to work", ["guaranteed"])).toEqual(['contains banned phrase "guaranteed"']);
    expect(captionProblems("Solid caption #realestate", ["guaranteed"])).toEqual([]);
  });
});
