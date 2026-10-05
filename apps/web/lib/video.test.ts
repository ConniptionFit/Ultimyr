import { describe, expect, it } from "vitest";
import { canPlay, playbackFor } from "./video";

const res = (url: string, kind = "video", tags: string[] = []) => ({ url, kind: kind as never, tags, title: "T" });

describe("playbackFor", () => {
  it("embeds YouTube through the no-cookie domain", () => {
    for (const url of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://m.youtube.com/embed/dQw4w9WgXcQ"]) {
      const p = playbackFor(res(url));
      expect(p).toMatchObject({ mode: "embed", provider: "YouTube" });
      expect((p as { src: string }).src.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?")).toBe(true);
    }
  });
  it("keeps the start time and playlist of a YouTube link", () => {
    const p = playbackFor(res("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s&list=PLabcdefghij12"));
    expect((p as { src: string }).src).toContain("start=90");
    expect((p as { src: string }).src).toContain("list=PLabcdefghij12");
  });
  it("embeds a whole playlist", () => {
    const p = playbackFor(res("https://www.youtube.com/playlist?list=PLabcdefghij12", "playlist"));
    expect((p as { src: string }).src).toBe("https://www.youtube-nocookie.com/embed/videoseries?rel=0&list=PLabcdefghij12");
  });
  it("rejects bad YouTube ids", () => {
    expect(playbackFor(res("https://www.youtube.com/watch?v=short")).mode).toBe("external");
    expect(playbackFor(res("https://www.youtube.com/watch?v=\"><script>x")).mode).toBe("external");
  });
  it("embeds Vimeo with do not track, including unlisted hashes", () => {
    expect((playbackFor(res("https://vimeo.com/123456789")) as { src: string }).src).toBe("https://player.vimeo.com/video/123456789?dnt=1");
    expect((playbackFor(res("https://vimeo.com/123456789/abcdef1234")) as { src: string }).src).toBe("https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234");
    expect((playbackFor(res("https://player.vimeo.com/video/123456789?h=abcdef1234")) as { src: string }).src).toContain("h=abcdef1234");
  });
  it("embeds Loom shares", () => {
    expect((playbackFor(res("https://www.loom.com/share/0123456789abcdef0123456789abcdef")) as { src: string }).src).toBe("https://www.loom.com/embed/0123456789abcdef0123456789abcdef");
  });
  it("plays direct video files", () => {
    expect(playbackFor(res("https://example.com/lecture.mp4?x=1"))).toEqual({ mode: "file", src: "https://example.com/lecture.mp4?x=1", type: "video/mp4" });
    expect(playbackFor(res("https://example.com/a.WEBM")).mode).toBe("file");
  });
  it("leaves unknown sites, non-video links and unsafe links external", () => {
    expect(playbackFor(res("https://example.com/watch/123")).mode).toBe("external");
    expect(playbackFor(res("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "article")).mode).toBe("external");
    expect(playbackFor(res("http://example.com/a.mp4")).mode).toBe("external");
    expect(playbackFor(res("https://user:pw@example.com/a.mp4")).mode).toBe("external");
    expect(playbackFor(res("not a url")).mode).toBe("external");
  });
  it("treats the video tag as video even when the kind is other", () => {
    expect(canPlay(res("https://youtu.be/dQw4w9WgXcQ", "other", ["content-type:video"]))).toBe(true);
    expect(canPlay(res("https://youtu.be/dQw4w9WgXcQ", "other"))).toBe(false);
  });
});
