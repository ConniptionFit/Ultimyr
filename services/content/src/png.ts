import { createHash } from "node:crypto";
import { HttpError } from "@ultimyr/service-kit";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
export const MAX_ICON_BYTES = 512 * 1024;
export const MAX_ICON_PIXELS = 1024;
export const MIN_ICON_PIXELS = 16;

export interface CleanPng {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
}

/**
 * Validate an uploaded icon and strip everything but the image data.
 * Requires a PNG with an alpha channel (or a tRNS chunk), bounded size and dimensions.
 * Metadata chunks (text, EXIF, color profiles, animation) are dropped, never trusted.
 */
export function cleanIconPng(input: Buffer): CleanPng {
  if (input.length > MAX_ICON_BYTES) throw new HttpError(413, "icon_too_large", { maxBytes: MAX_ICON_BYTES });
  if (input.length < 33 || !input.subarray(0, 8).equals(SIGNATURE)) throw new HttpError(400, "icon_not_png");
  const chunks: Buffer[] = [SIGNATURE];
  let width = 0;
  let height = 0;
  let colorType = -1;
  let hasTrns = false;
  let sawIdat = false;
  let sawIend = false;
  let pos = 8;
  while (pos + 12 <= input.length && !sawIend) {
    const len = input.readUInt32BE(pos);
    const type = input.toString("latin1", pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (len > input.length || end > input.length) throw new HttpError(400, "icon_corrupt");
    if (pos === 8 && type !== "IHDR") throw new HttpError(400, "icon_corrupt");
    if (type === "IHDR") {
      if (len !== 13) throw new HttpError(400, "icon_corrupt");
      width = input.readUInt32BE(pos + 8);
      height = input.readUInt32BE(pos + 12);
      colorType = input[pos + 17]!;
    }
    if (type === "tRNS") hasTrns = true;
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") sawIend = true;
    if (KEEP.has(type)) chunks.push(input.subarray(pos, end));
    pos = end;
  }
  if (!sawIdat || !sawIend) throw new HttpError(400, "icon_corrupt");
  if (width < MIN_ICON_PIXELS || height < MIN_ICON_PIXELS || width > MAX_ICON_PIXELS || height > MAX_ICON_PIXELS) {
    throw new HttpError(400, "icon_bad_dimensions", { min: MIN_ICON_PIXELS, max: MAX_ICON_PIXELS });
  }
  const alpha = colorType === 4 || colorType === 6 || hasTrns;
  if (!alpha) throw new HttpError(400, "icon_needs_transparency");
  const bytes = Buffer.concat(chunks);
  return { bytes, width, height, sha256: createHash("sha256").update(bytes).digest("hex") };
}
