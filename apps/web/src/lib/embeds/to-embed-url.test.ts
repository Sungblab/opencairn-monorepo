import { describe, it, expect } from "vitest";
import { toEmbedUrl } from "./to-embed-url";

describe("toEmbedUrl", () => {
  // ─── YouTube ──────────────────────────────────────────────────────────────
  it("converts youtube.com/watch?v= URL", () => {
    expect(toEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });
  it("converts youtu.be short URL", () => {
    expect(toEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });
  it("strips youtube playlist params but keeps video id", () => {
    expect(
      toEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42s"),
    ).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });
  it("converts m.youtube.com URL", () => {
    expect(toEmbedUrl("https://m.youtube.com/watch?v=abc12345DEF")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/abc12345DEF",
    });
  });

  // ─── Vimeo ───────────────────────────────────────────────────────────────
  it("converts vimeo numeric URL", () => {
    expect(toEmbedUrl("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
  });
  it("converts vimeo with hash fragment", () => {
    expect(toEmbedUrl("https://vimeo.com/123456789/abcdef")).toEqual({
      provider: "vimeo",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
  });

  // ─── Loom ────────────────────────────────────────────────────────────────
  it("converts loom share URL", () => {
    expect(
      toEmbedUrl("https://www.loom.com/share/abc123def456"),
    ).toEqual({
      provider: "loom",
      embedUrl: "https://www.loom.com/embed/abc123def456",
    });
  });
  it("converts loom share URL without www subdomain", () => {
    expect(toEmbedUrl("https://loom.com/share/abc123def456")).toEqual({
      provider: "loom",
      embedUrl: "https://www.loom.com/embed/abc123def456",
    });
  });

  // ─── Negatives ───────────────────────────────────────────────────────────
  it("rejects unknown host", () => {
    expect(toEmbedUrl("https://example.com/foo")).toBeNull();
  });
  it("rejects malformed URL", () => {
    expect(toEmbedUrl("not a url")).toBeNull();
  });
  it("rejects youtube URL without video id", () => {
    expect(toEmbedUrl("https://www.youtube.com/feed/trending")).toBeNull();
  });
  it("rejects vimeo URL without numeric id", () => {
    expect(toEmbedUrl("https://vimeo.com/channels/staffpicks")).toBeNull();
  });
  it("rejects loom URL not under /share/", () => {
    expect(toEmbedUrl("https://www.loom.com/looks/abc123")).toBeNull();
  });
  it("rejects javascript: URL", () => {
    expect(toEmbedUrl("javascript:alert(1)")).toBeNull();
  });
});
