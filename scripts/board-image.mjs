// Pure helpers for sending the rendered board screenshot to the Jev API:
// scale math, PNG header parsing, and log sanitization. No browser or
// network code here so the unit tests can import this module directly.

// The Jev images API rejects images outside 256-1568 px per side and under
// 78,400 total px. Exported so the browser-side eval in play-all.mjs can
// inline the same numbers.
export const MAX_SIDE = 1536;
export const MIN_SIDE = 256;
export const MIN_TOTAL_PIXELS = 78400;
// Aim slightly above the hard minimum so rounding never lands a pixel short.
const MIN_SIDE_TARGET = 260;

// The board table carries a fit-to-window CSS scale chosen by the page. That
// view is the largest COMPLETE board the layout can show — anything larger
// overflows and gets clipped — so keep it whenever it already satisfies the
// API limits, and clamp it only when it does not.
export function normalizeBoardScale(naturalWidth, naturalHeight, currentScale) {
  const longest = Math.max(naturalWidth, naturalHeight);
  const shortest = Math.min(naturalWidth, naturalHeight);
  let scale = currentScale;
  if (longest * scale > MAX_SIDE) scale = MAX_SIDE / longest;
  const floorScale = Math.max(
    MIN_SIDE_TARGET / shortest,
    Math.sqrt(MIN_TOTAL_PIXELS / (naturalWidth * naturalHeight))
  );
  if (scale < floorScale) scale = floorScale;
  return { scale, adjusted: Math.abs(scale - currentScale) > 1e-9 };
}

// PNG IHDR: 8-byte signature, 4-byte length, "IHDR", then 4-byte width and
// height at offsets 16 and 20. Enough to sanity-check the screenshot without
// pulling in an image library.
export function readPngDimensions(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// Transcripts and the side panel embed the full request; megabytes of base64
// per turn would bloat both, so the payload is swapped for a byte count.
// Returns a deep-copied request and never mutates the original.
export function sanitizeRequestForLog(request) {
  if (!request?.assets) return request;
  const logged = JSON.parse(JSON.stringify(request));
  for (const asset of Object.values(logged.assets)) {
    if (typeof asset.data_base64 === "string") {
      asset.data_base64 = `<base64 omitted: ${asset.data_base64.length} bytes>`;
    }
  }
  return logged;
}
