// Jev choice-API provider. The request shape (state + choice questions with
// criteria) is fixed by the Jev schema; criteria values carry each candidate's
// neighbourhood so Jev can judge locally.
import { execFileSync } from "node:child_process";
import { neighborSummary } from "../board-analysis.mjs";
import { sanitizeRequestForLog } from "../board-image.mjs";
import { DECISION_INSTRUCTIONS } from "../prompt.mjs";

// Reference string placed in the request state; the API swaps it for the
// board image before the model sees it.
const BOARD_IMAGE_REF = "jev-board-snapshot-image";

// Key precedence: YAML api_key > process env > Windows machine-scoped env.
// A machine-scoped variable is not automatically inherited by a long-lived
// desktop app. Read it only into this process; never log or write the value.
export function resolveJevApiKey(configured) {
  if (configured) return configured;
  const inherited = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
  if (inherited || process.platform !== "win32") return inherited;
  const script = "[Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY','Machine'); [Environment]::GetEnvironmentVariable('JEV_API_KEY','Machine')";
  const values = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return values[0];
}

export function createJevProvider({ endpoint, model, apiKey, postJson, boardImage = true, log = console.log }) {
  return {
    name: "jev",
    async choose({ board, candidates, knownMines, level, step, boardImage: snapshot }) {
      const candidateKeys = new Set(candidates.map((cell) => `${cell.x},${cell.y}`));
      // Shared decision prompt core — identical to every provider by design.
      const instructions = DECISION_INSTRUCTIONS;
      // Jev's choice schema requires criteria to be a dictionary. The coordinate
      // keys identify the choices; each value describes that candidate's immediate
      // neighbourhood so Jev can judge it without rescanning the whole board.
      const criteria = Object.fromEntries(candidates.map((cell) => [`${cell.x},${cell.y}`, neighborSummary(board, cell.x, cell.y, knownMines)]));
      const requestPayload = {
        model,
        state: {
          level: level.name,
          step: step + 1,
          board: { width: board.width, height: board.height, mines: board.mines, flaggedCount: board.flaggedCount, remainingMines: board.mines - board.flaggedCount, rows: board.rows, notation: "#=covered, F=flagged, .=revealed zero, 1-8=adjacent mine count; rows go from y=0 downward and x=0 to the right" }
        },
        questions: {
          reveal: {
            type: "choice",
            instructions,
            criteria
          }
        }
      };
      // Image input: a PNG screenshot of the board as rendered in the browser,
      // declared once in the top-level assets map and referenced from state.
      const useImage = boardImage && Boolean(snapshot);
      if (useImage) {
        requestPayload.assets = { [BOARD_IMAGE_REF]: { type: "image", format: "png", data_base64: snapshot.base64 } };
        requestPayload.state.image = BOARD_IMAGE_REF;
        requestPayload.state.imageNote = 'The string in "image" is a reference to a PNG screenshot of this exact board as rendered in the browser; same grid and notation as rows.';
      }
      const imageHeaders = useImage ? { "TypeSafe-Danger-Zone-Images": "true" } : {};
      const requestStarted = performance.now();
      let response = await postJson(endpoint, {
        headers: { authorization: `Bearer ${apiKey}`, ...imageHeaders },
        body: requestPayload
      });
      if (!response.ok && useImage && (response.status === 400 || response.status === 413)) {
        // The image path is strictly validated server-side (dimensions, size);
        // degrade to the text-only request instead of losing the turn.
        log(`Jev 拒绝了图像请求（HTTP ${response.status}），本步退回纯文本状态。`);
        delete requestPayload.assets;
        delete requestPayload.state.image;
        delete requestPayload.state.imageNote;
        response = await postJson(endpoint, {
          headers: { authorization: `Bearer ${apiKey}` },
          body: requestPayload
        });
      }
      const requestMs = Math.round(performance.now() - requestStarted);
      if (!response.ok) throw new Error(`Jev HTTP ${response.status}: ${JSON.stringify(response.body)}`);
      const answer = response.body?.answers?.reveal;
      const choice = answer?.choice;
      if (!candidateKeys.has(choice)) throw new Error(`Jev 返回了非法候选：${choice}`);
      const [x, y] = choice.split(",").map(Number);
      // Transcripts and the panel embed the full request; swap the image bytes
      // for a byte count so neither bloats.
      return { x, y, answer, usage: response.body.usage ?? null, model: response.body.model ?? model, request: sanitizeRequestForLog(requestPayload), response: response.body, requestMs };
    }
  };
}
