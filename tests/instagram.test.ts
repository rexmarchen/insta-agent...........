import { describe, it, expect } from "vitest";
import { getGraphBase } from "../src/instagram.js";

describe("Instagram Graph Base resolution", () => {
  it("resolves graph.instagram.com for IG tokens", () => {
    const base = getGraphBase("IGAA12345");
    expect(base).toContain("graph.instagram.com");
  });

  it("resolves graph.facebook.com for standard tokens", () => {
    const base = getGraphBase("EAAB12345");
    expect(base).toContain("graph.facebook.com");
  });
});
