"use client";

import { useEffect, useRef } from "react";
import { DOT_GRID, makeShapes, sample, shapeCount, sizeAt, step, type Shape } from "@/lib/dot-grid";

/** The shapes that float through the grid: the Lucide icons that best say learning and study. */
const ICONS = ["book-open", "graduation-cap", "brain", "lightbulb", "pencil-line", "library", "atom", "flask-conical", "calculator", "languages", "microscope", "target", "sigma"];

const MASK = 48;

type Node = Array<[string, Record<string, string>]>;

const attrs = (a: Record<string, string>) => Object.entries(a).map(([k, v]) => `${k}="${v.replace(/"/g, "&quot;")}"`).join(" ");

/** Draw an icon thick and white, then keep only how much of each pixel it covers. */
function iconMask(node: Node | null | undefined): Promise<Float32Array> {
  const out = new Float32Array(MASK * MASK);
  if (!node) return Promise.resolve(out);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MASK}" height="${MASK}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
    node.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join("") +
    "</svg>";
  return new Promise((resolve) => {
    const img = new Image(MASK, MASK);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = MASK;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (g) {
        g.drawImage(img, 0, 0, MASK, MASK);
        const px = g.getImageData(0, 0, MASK, MASK).data;
        for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3]! / 255;
      }
      resolve(out);
    };
    img.onerror = () => resolve(out);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Fetch the icon shapes (small, cached hard) and turn each into a coverage mask. A failure just leaves a plain dot grid. */
async function loadMasks(): Promise<Float32Array[]> {
  const res = await fetch(`/api/icons?names=${ICONS.join(",")}`);
  if (!res.ok) return [];
  const nodes = (await res.json()) as Record<string, Node | null>;
  return Promise.all(ICONS.map((n) => iconMask(nodes[n])));
}

function isDark(): boolean {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const m = /^#([0-9a-f]{6})$/i.exec(bg);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 128;
}

/**
 * A grid of small dots behind the page. Slowly floating study shapes make the dots under them larger and coloured.
 * Decorative only: it never takes clicks, and it stands still with reduced motion or Calm mode.
 */
export function DotGridBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const G = DOT_GRID;
    let masks: Float32Array[] = [];
    let shapes: Shape[] = [];
    let cols = 0;
    let rows = 0;
    let dark = isDark();
    let raf = 0;
    let last = 0;
    let t = 0;
    let alive = true;

    const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "calm";

    const layout = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / G.spacing) + 1;
      rows = Math.ceil(h / G.spacing) + 1;
      shapes = makeShapes(shapeCount(w, h), cols, rows, ICONS.length, 7);
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const rest = dark ? G.restDark : G.restLight;
      const tone = dark ? G.dark : G.light;
      const restStyle = `rgba(${rest}, ${G.baseAlpha})`;
      const sizes = shapes.map((s) => sizeAt(s, t));
      // Keep the middle, where the text and buttons sit, calm so words stay easy to read.
      const cx = canvas.clientWidth / 2;
      const cy = canvas.clientHeight / 2;
      const rx = Math.min(G.quietX, canvas.clientWidth * 0.5);
      const ry = Math.min(G.quietY, canvas.clientHeight * 0.45);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          let cov = 0;
          let hue = 0;
          if (masks.length) {
            for (let k = 0; k < shapes.length; k++) {
              const s = shapes[k]!;
              const size = sizes[k]!;
              const u = (i - s.x) / size + 0.5;
              const v = (j - s.y) / size + 0.5;
              if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
              const c = sample(masks[s.icon]!, MASK, u, v);
              if (c > cov) {
                cov = c;
                hue = s.hue;
              }
            }
          }
          const d = Math.hypot((i * G.spacing - cx) / rx, (j * G.spacing - cy) / ry);
          const k = Math.min(1, Math.max(0, (d - 0.55) / 0.6));
          const calm = G.quietFloor + (1 - G.quietFloor) * k * k * (3 - 2 * k);
          cov *= calm;
          const r = G.baseRadius + (G.maxRadius - G.baseRadius) * cov;
          ctx.fillStyle = cov > 0.02 ? `hsla(${hue}, ${tone.s}%, ${tone.l}%, ${G.baseAlpha + (G.maxAlpha - G.baseAlpha) * cov})` : (calm < 1 ? `rgba(${rest}, ${G.baseAlpha * (0.4 + 0.6 * calm)})` : restStyle);
          ctx.beginPath();
          ctx.arc(i * G.spacing, j * G.spacing, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!alive) return;
      if (calm() || document.hidden) {
        draw();
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.25);
      if (dt >= 1 / G.fps) {
        last = now;
        t += dt;
        for (const s of shapes) step(s, dt, cols, rows);
        draw();
      }
      raf = requestAnimationFrame(frame);
    };

    const kick = () => {
      if (!raf && alive) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const onResize = () => {
      layout();
      draw();
      kick();
    };
    const onTheme = () => {
      dark = isDark();
      draw();
      kick();
    };

    layout();
    // Start the shapes part way through their day so a still frame is never blank.
    for (let n = 0; n < 40; n++) for (const s of shapes) step(s, 0.5, cols, rows);
    draw();
    loadMasks()
      .then((m) => {
        if (!alive) return;
        masks = m;
        draw();
        kick();
      })
      .catch(() => kick());

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", kick);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const rm = matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", onTheme);
    rm.addEventListener("change", kick);
    const obs = new MutationObserver(onTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", kick);
      mq.removeEventListener("change", onTheme);
      rm.removeEventListener("change", kick);
      obs.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10" />;
}
