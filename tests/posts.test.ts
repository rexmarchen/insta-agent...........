import { describe, expect, it } from "vitest";
import { db } from "../src/db.js";
import { approve, reject, retryPost } from "../src/posts.js";

const make = (status: string, caption: string | null = "Great caption #realestate") =>
  Number(db.prepare("INSERT INTO posts (kind, src_path, media_url, status, caption) VALUES ('IMAGE', ?, 'u', ?, ?)").run(`p-${Math.random()}`, status, caption).lastInsertRowid);

describe("post state machine", () => {
  it("approves once, and a second tap cannot double-schedule", () => {
    const id = make("drafted");
    expect(approve(id)).toMatch(/^\d{4}-/);
    expect(() => approve(id)).toThrow(/already approved/);
  });

  it("refuses to approve a caption with a banned phrase", () => {
    const id = make("drafted", "This is guaranteed to work");
    expect(() => approve(id)).toThrow(/banned phrase/);
  });

  it("only retries failed posts with media still available", () => {
    expect(() => retryPost(make("published"))).toThrow(/only failed/);
    const gone = make("failed");
    db.prepare("UPDATE posts SET cloud_deleted = 1 WHERE id = ?").run(gone);
    expect(() => retryPost(gone)).toThrow(/expired/);
    const ok = make("failed");
    expect(retryPost(ok)).toMatch(/^\d{4}-/);
  });

  it("rejects only drafted or approved posts", () => {
    expect(() => reject(make("published"))).toThrow(/cannot be rejected/);
    expect(() => reject(make("drafted"))).not.toThrow();
  });
});
