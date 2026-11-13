import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { createJsonPoster } from "../scripts/http.mjs";
import { createJevProvider } from "../scripts/providers/jev.mjs";
import { createOpenAIProvider } from "../scripts/providers/openai.mjs";
import { DECISION_INSTRUCTIONS } from "../scripts/prompt.mjs";

const context = {
  board: { width: 3, height: 2, mines: 1, flaggedCount: 0, rows: ["1##", "###"], cells: [{ isMine: true }] },
  candidates: [{ x: 1, y: 0 }, { x: 2, y: 1 }],
  knownMines: new Set(), level: { name: "Beginner" }, step: 1
};
const png = readFileSync(new URL("../image/sprite.png", import.meta.url));
const screenshot = {
  data: png.toString("base64"), bytes: png.length, path: "result/board-test.png",
  width: png.readUInt32BE(16), height: png.readUInt32BE(20)
};
const answer = { type: "choice", choice: "1,0", confidence: 0.85 };

async function transport(t, reply) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let data = "";
    for await (const chunk of request) data += chunk;
    requests.push({ path: request.url, headers: request.headers, body: JSON.parse(data) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(reply(requests.length)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    postJson: await createJsonPoster({ proxyUrl: null, attempts: 1 }), requests
  };
}

function assertLoggedImage(move) {
  assert.deepEqual(move.screenshot, {
    path: screenshot.path, bytes: png.length, mimeType: "image/png",
    width: screenshot.width, height: screenshot.height
  });
  assert.deepEqual([move.x, move.y], [1, 0]);
  assert.match(JSON.stringify(move.request), /base64 omitted/);
  assert.ok(!JSON.stringify(move).includes(screenshot.data));
  assert.ok(!JSON.stringify(move).includes("test-secret"));
}

test("Jev 1.14 sends referenced PNG assets with the image header, then returns to text-only", async (t) => {
  const response = { model: "jev-1.14.0", answers: { reveal: answer }, usage: { input_tokens: 700 } };
  const { baseUrl, postJson, requests } = await transport(t, () => response);
  const provider = createJevProvider({ endpoint: `${baseUrl}/v1/systemone`, model: "jev-1.14.0", apiKey: "test-secret", postJson });
  const move = await provider.choose({ ...context, screenshot });
  const sent = requests[0];
  assert.equal(sent.path, "/v1/systemone");
  assert.equal(sent.headers.authorization, "Bearer test-secret");
  assert.equal(sent.headers["typesafe-danger-zone-images"], "true");
  assert.equal(sent.body.model, "jev-1.14.0");
  const reference = sent.body.state.board_image;
  assert.match(reference, /^[\da-f-]{36}$/);
  assert.deepEqual(Object.keys(sent.body.assets), [reference]);
  assert.deepEqual(sent.body.assets[reference], { type: "image", format: "png", data_base64: screenshot.data });
  assert.deepEqual(Buffer.from(sent.body.assets[reference].data_base64, "base64"), png);
  assert.deepEqual(sent.body.state.board.rows, context.board.rows);
  assert.equal(sent.body.state.board.cells, undefined);
  assert.equal(sent.body.questions.reveal.instructions, DECISION_INSTRUCTIONS);
  assertLoggedImage(move);
  assert.deepEqual(move.response, response);

  const textMove = await provider.choose(context);
  assert.equal(requests[1].headers["typesafe-danger-zone-images"], undefined);
  assert.equal(requests[1].body.assets, undefined);
  assert.equal(requests[1].body.state.board_image, undefined);
  assert.equal(textMove.screenshot, undefined);
  assert.deepEqual(textMove.request, requests[1].body);
});

test("OpenAI-compatible requests carry PNG data URLs and retain the image during corrective retry", async (t) => {
  const { baseUrl, postJson, requests } = await transport(t, (count) => ({
    model: "vision-model", choices: [{ message: { content: count === 1 ? "invalid answer" : JSON.stringify(answer) } }]
  }));
  const provider = createOpenAIProvider({ baseUrl: `${baseUrl}/v1`, model: "vision-model", apiKey: "test-secret", postJson, log: () => {} });
  const move = await provider.choose({ ...context, screenshot });
  assert.equal(requests.length, 2);
  for (const sent of requests) {
    assert.equal(sent.path, "/v1/chat/completions");
    assert.equal(sent.headers.authorization, "Bearer test-secret");
    assert.equal(sent.headers["typesafe-danger-zone-images"], undefined);
    const content = sent.body.messages[1].content;
    assert.equal(content[0].type, "text");
    assert.ok(content[0].text.includes(DECISION_INSTRUCTIONS));
    assert.ok(!content[0].text.includes("isMine"));
    assert.deepEqual(content[1], {
      type: "image_url", image_url: { url: `data:image/png;base64,${screenshot.data}`, detail: "high" }
    });
  }
  assert.equal(requests[1].body.messages.length, 4);
  assert.equal(move.request.messages.length, 4);
  assert.equal(move.request.messages[2].role, "assistant");
  assertLoggedImage(move);

  const textMove = await provider.choose(context);
  assert.equal(requests.length, 3);
  assert.equal(typeof requests[2].body.messages[1].content, "string");
  assert.equal(textMove.screenshot, undefined);
  assert.deepEqual(textMove.request, requests[2].body);
});
