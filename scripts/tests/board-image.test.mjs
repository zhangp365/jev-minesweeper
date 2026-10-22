// Unit tests for the pure board-image helpers. Zero deps: node --test style
// runner kept hand-rolled to match the project's no-devDependencies setup.
// Run: node scripts/tests/board-image.test.mjs
import assert from "node:assert/strict";
import { normalizeBoardScale, sanitizeRequestForLog, readPngDimensions } from "../board-image.mjs";

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

// --- readPngDimensions: parses IHDR width/height from PNG bytes ---

test("readPngDimensions parses width and height from a PNG buffer", () => {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0); // signature
  png.writeUInt32BE(13, 8); // IHDR length
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(1024, 16); // width
  png.writeUInt32BE(546, 20); // height
  assert.deepEqual(readPngDimensions(png), { width: 1024, height: 546 });
});

// --- sanitizeRequestForLog: base64 never reaches transcripts or the panel ---

test("sanitizeRequestForLog replaces data_base64 with a byte-count placeholder", () => {
  const request = {
    model: "jev-1.14.0",
    assets: {
      "jev-board-snapshot-image": { type: "image", format: "png", data_base64: "QUJD" }
    },
    state: { image: "jev-board-snapshot-image" }
  };
  const logged = sanitizeRequestForLog(request);
  assert.equal(logged.assets["jev-board-snapshot-image"].data_base64, "<base64 omitted: 4 bytes>");
  assert.equal(logged.state.image, "jev-board-snapshot-image"); // reference text kept
  assert.equal(logged.model, "jev-1.14.0");
});

test("sanitizeRequestForLog does not mutate the original request", () => {
  const request = { assets: { ref: { data_base64: "QUJD" } } };
  sanitizeRequestForLog(request);
  assert.equal(request.assets.ref.data_base64, "QUJD");
});

test("sanitizeRequestForLog passes a request without assets through unchanged", () => {
  const request = { model: "jev-1.14.0", state: { board: "..." }, questions: {} };
  assert.deepEqual(sanitizeRequestForLog(request), request);
});

// --- normalizeBoardScale: keep the board's own fit scale when it already
// satisfies the API limits; the layout clips anything larger anyway ---

test("normalizeBoardScale keeps a fit scale that is already within limits", () => {
  const { scale, adjusted } = normalizeBoardScale(166, 207, 3.53);
  assert.equal(adjusted, false);
  assert.equal(scale, 3.53);
});

test("normalizeBoardScale scales down when the fit scale exceeds 1536 px", () => {
  const { scale, adjusted } = normalizeBoardScale(278, 367, 14);
  assert.equal(adjusted, true);
  assert.ok(Math.abs(367 * scale - 1536) < 1, `longest side ~1536, got ${367 * scale}`);
});

test("normalizeBoardScale scales up only when below the API minimums", () => {
  const { scale, adjusted } = normalizeBoardScale(166, 207, 1);
  assert.equal(adjusted, true);
  assert.ok(207 * scale >= 256, `short side must reach the minimum, got ${207 * scale}`);
});

test("normalized result always satisfies the API limits", () => {
  for (const [w, h, current] of [[166, 207, 3.53], [278, 367, 14], [166, 207, 1], [508, 367, 2.45], [166, 207, 20]]) {
    const { scale } = normalizeBoardScale(w, h, current);
    const width = w * scale;
    const height = h * scale;
    assert.ok(width >= 256 && width <= 1568, `width ${width} out of range for ${w}x${h}@${current}`);
    assert.ok(height >= 256 && height <= 1568, `height ${height} out of range for ${w}x${h}@${current}`);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL - ${name}\n  ${error.message}`);
  }
}
if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\n${tests.length} tests passed`);
