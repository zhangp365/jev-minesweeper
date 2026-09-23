// Jev choice-API provider. The request shape (state + choice questions with
// criteria) is fixed by the Jev schema; criteria values carry each candidate's
// neighbourhood so Jev can judge locally.
import { execFileSync } from "node:child_process";
import { neighborSummary } from "../board-analysis.mjs";
import { DECISION_INSTRUCTIONS } from "../prompt.mjs";

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

export function createJevProvider({ endpoint, model, apiKey, postJson }) {
  return {
    name: "jev",
    async choose({ board, candidates, knownMines, level, step }) {
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
          board: { width: board.width, height: board.height, mines: board.mines, rows: board.rows, notation: "#=covered, F=flagged, .=revealed zero, 1-8=adjacent mine count; rows go from y=0 downward and x=0 to the right" },
          candidates: candidates.map(({ x, y }) => ({ x, y }))
        },
        questions: {
          reveal: {
            type: "choice",
            instructions,
            criteria
          }
        }
      };
      const requestStarted = performance.now();
      const response = await postJson(endpoint, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: requestPayload
      });
      const requestMs = Math.round(performance.now() - requestStarted);
      if (!response.ok) throw new Error(`Jev HTTP ${response.status}: ${JSON.stringify(response.body)}`);
      const answer = response.body?.answers?.reveal;
      const choice = answer?.choice;
      if (!candidateKeys.has(choice)) throw new Error(`Jev 返回了非法候选：${choice}`);
      const [x, y] = choice.split(",").map(Number);
      return { x, y, answer, usage: response.body.usage ?? null, model: response.body.model ?? model, request: requestPayload, response: response.body, requestMs };
    }
  };
}
