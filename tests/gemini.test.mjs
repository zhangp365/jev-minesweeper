import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadLlmConfig, PROVIDER_NAMES } from "../scripts/config.mjs";
import { createJsonPoster } from "../scripts/http.mjs";
import { DECISION_INSTRUCTIONS } from "../scripts/prompt.mjs";
import { createGeminiProvider, resolveGeminiApiKey } from "../scripts/providers/gemini.mjs";

const context = {
  board: { width: 3, height: 2, mines: 1, flaggedCount: 0, rows: ["1##", "###"] },
  candidates: [{ x: 1, y: 0 }, { x: 2, y: 1 }],
  knownMines: new Set(),
  level: { name: "Beginner" },
  step: 1
};
const answer = { type: "choice", choice: "1,0", confidence: 0.85, probabilities: { "1,0": 0.85, "2,1": 0.15 } };

function providerReturning(body, status = 200, onRequest = () => {}) {
  return createGeminiProvider({
    endpoint: "https://generativelanguage.googleapis.com/v1beta/decisions",
    model: "gemini-decision-1",
    apiKey: "test-secret",
    postJson: async (url, request) => {
      onRequest(url, request);
      return { ok: status === 200, status, body };
    }
  });
}

test("Gemini REST transport sends visible state and maps a typed answer to a legal move", async (t) => {
  let received;
  const responseBody = {
    answers: { reveal: answer },
    usage: { total_input_tokens: 125, total_output_tokens: 0, total_tokens: 125 }
  };
  const server = createServer(async (request, response) => {
    let data = "";
    for await (const chunk of request) data += chunk;
    received = { method: request.method, path: request.url, headers: request.headers, body: JSON.parse(data) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(responseBody));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const postJson = await createJsonPoster({ proxyUrl: null, attempts: 1 });
  const provider = createGeminiProvider({
    endpoint: `http://127.0.0.1:${server.address().port}/v1beta/decisions`,
    model: "gemini-decision-1", apiKey: "test-secret", postJson
  });
  // Hidden debug state must never be forwarded to the model.
  const move = await provider.choose({ ...context, board: { ...context.board, cells: [{ isMine: true }] } });
  assert.equal(received.method, "POST");
  assert.equal(received.path, "/v1beta/decisions");
  assert.equal(received.headers["x-goog-api-key"], "test-secret");
  assert.equal(received.headers.authorization, undefined);
  assert.equal(received.body.model, "gemini-decision-1");
  assert.equal(received.body.state, undefined);
  const state = JSON.parse(received.body.input);
  assert.deepEqual(state.board.rows, context.board.rows);
  assert.equal(state.board.cells, undefined);
  assert.equal(state.board.remainingMines, 1);
  assert.equal(state.step, 2);
  assert.equal(state.level, "Beginner");
  assert.deepEqual(received.body.questions.reveal, {
    type: "choice", instructions: DECISION_INSTRUCTIONS,
    criteria: {
      "1,0": "numbers: (0,0)=1; confirmed mines: none",
      "2,1": "numbers: none; confirmed mines: none"
    }
  });
  assert.deepEqual([move.x, move.y], [1, 0]);
  assert.deepEqual(move.answer, answer);
  assert.deepEqual(move.usage, responseBody.usage);
  assert.equal(move.model, "gemini-decision-1");
  assert.deepEqual(move.response, responseBody);
  assert.deepEqual(move.request, received.body);
  assert.ok(Number.isFinite(move.requestMs) && move.requestMs >= 0);
  assert.ok(!JSON.stringify(move).includes("test-secret"));

  await t.test("screenshot mode sends a PNG alongside text and keeps Base64 out of logs", async () => {
    const png = readFileSync(new URL("../image/sprite.png", import.meta.url));
    const screenshot = {
      data: png.toString("base64"), bytes: png.length, path: "result/board-test.png",
      width: png.readUInt32BE(16), height: png.readUInt32BE(20)
    };
    const imageMove = await provider.choose({ ...context, screenshot });
    assert.equal(received.body.input.length, 2);
    assert.equal(received.body.input[0].type, "text");
    assert.deepEqual(JSON.parse(received.body.input[0].text), state);
    assert.deepEqual(received.body.input[1], {
      type: "image", data: screenshot.data, mime_type: "image/png", resolution: "high"
    });
    assert.deepEqual(Buffer.from(received.body.input[1].data, "base64"), png);
    assert.deepEqual(imageMove.screenshot, {
      path: screenshot.path, bytes: png.length, mimeType: "image/png", width: screenshot.width, height: screenshot.height
    });
    assert.match(imageMove.request.input[1].data, /base64 omitted/);
    assert.equal(imageMove.request.input[1].mime_type, "image/png");
    assert.ok(!JSON.stringify(imageMove).includes(screenshot.data));
    assert.ok(!JSON.stringify(imageMove).includes("test-secret"));
  });
});

test("invalid answers stop the game before a click can be requested", async (t) => {
  const cases = [
    [null, /invalid choice/],
    [{ answers: {} }, /invalid choice/],
    [{ answers: { reveal: { ...answer, choice: "9,9" } } }, /invalid choice/],
    [{ answers: { reveal: { ...answer, type: "noul" } } }, /invalid choice/],
    ...[undefined, null, "0.9", NaN, Infinity, -0.1, 1.1].map((confidence) => [
      { answers: { reveal: { ...answer, confidence } } }, /invalid confidence/
    ])
  ];
  for (const [index, [body, error]] of cases.entries()) {
    await t.test(`malformed response ${index + 1}`, async () => {
      await assert.rejects(providerReturning(body).choose(context), error);
    });
  }
  for (const confidence of [0, 1]) {
    const move = await providerReturning({ answers: { reveal: { ...answer, confidence } } }).choose(context);
    assert.equal(move.answer.confidence, confidence);
  }
});

test("Google HTTP failures preserve the status and error message", async () => {
  for (const status of [400, 401, 403, 404, 429, 500]) {
    await assert.rejects(
      providerReturning({ error: { message: "Google rejected this request" } }, status).choose(context),
      new RegExp(`Gemini Decisions HTTP ${status}:.*Google rejected this request`)
    );
  }
});

test("choice limits and duplicate candidates are checked before sending a request", async () => {
  const provider = providerReturning({ answers: { reveal: answer } }, 200, () => assert.fail("unexpected API call"));
  for (const candidates of [[], [context.candidates[0]], [context.candidates[0], context.candidates[0]],
    Array.from({ length: 256 }, (_, x) => ({ x, y: 0 }))]) {
    await assert.rejects(provider.choose({ ...context, candidates }), /2–255 distinct candidates/);
  }
});

test("Gemini key resolution prefers YAML, then the selected env var, then GOOGLE_API_KEY", () => {
  const env = { GEMINI_API_KEY: "gemini-key", GOOGLE_API_KEY: "google-key", CUSTOM_GOOGLE_KEY: "custom-key" };
  assert.equal(resolveGeminiApiKey("yaml-key", "GEMINI_API_KEY", env), "yaml-key");
  assert.equal(resolveGeminiApiKey(null, "GEMINI_API_KEY", env), "gemini-key");
  assert.equal(resolveGeminiApiKey(null, "CUSTOM_GOOGLE_KEY", env), "custom-key");
  assert.equal(resolveGeminiApiKey(null, "MISSING", env), "google-key");
  assert.equal(resolveGeminiApiKey(null, "GEMINI_API_KEY", {}), null);
});

test("YAML defaults to Jev 1.14 and normalizes the shared screenshot switch", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "minesweeper-config-"));
  const path = join(directory, "providers.yaml");
  t.after(() => { unlinkSync(path); rmdirSync(directory); });
  writeFileSync(path, "default_provider: jev\n");
  const defaults = loadLlmConfig(path);
  assert.equal(defaults.defaultProvider, "jev");
  assert.equal(defaults.jev.model, "jev-1.14.0");
  assert.equal(defaults.includeScreenshot, false);
  assert.deepEqual(defaults.gemini, {
    endpoint: "https://generativelanguage.googleapis.com/v1beta/decisions",
    model: "gemini-decision-1", apiKey: null, apiKeyEnv: "GEMINI_API_KEY"
  });
  writeFileSync(path, "default_provider: gemini\ninclude_screenshot: true\ngemini:\n  endpoint: http://localhost:8090/decisions\n  api_key: yaml-key\n  api_key_env: CUSTOM_KEY\n");
  const configured = loadLlmConfig(path);
  assert.equal(configured.defaultProvider, "gemini");
  assert.equal(configured.gemini.endpoint, "http://localhost:8090/decisions");
  assert.equal(configured.gemini.model, "gemini-decision-1");
  assert.equal(configured.gemini.apiKey, "yaml-key");
  assert.equal(configured.gemini.apiKeyEnv, "CUSTOM_KEY");
  assert.equal(configured.includeScreenshot, true);
  assert.ok(PROVIDER_NAMES.includes("gemini"));
});
