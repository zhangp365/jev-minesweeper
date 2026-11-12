// Gemini Decisions uses typed choice questions, not chat completions.
// https://aistudio.google.com/docs/decisions-api
import { neighborSummary } from "../board-analysis.mjs";
import { DECISION_INSTRUCTIONS } from "../prompt.mjs";

export function resolveGeminiApiKey(configured, apiKeyEnv = "GEMINI_API_KEY", env = process.env) {
  return configured || env[apiKeyEnv] || env.GOOGLE_API_KEY || null;
}

export function createGeminiProvider({ endpoint, model, apiKey, postJson }) {
  return {
    name: "gemini",
    async choose({ board, candidates, knownMines, level, step }) {
      const candidateKeys = new Set(candidates.map((cell) => `${cell.x},${cell.y}`));
      // The runner handles a single candidate locally. Google accepts 2–255
      // distinct options per choice question; never silently drop candidates.
      if (candidates.length < 2 || candidates.length > 255 || candidateKeys.size !== candidates.length) {
        throw new Error("Gemini Decisions requires 2–255 distinct candidates per choice question");
      }
      const state = {
        level: level.name,
        step: step + 1,
        board: {
          width: board.width, height: board.height, mines: board.mines,
          flaggedCount: board.flaggedCount, remainingMines: board.mines - board.flaggedCount,
          rows: board.rows,
          notation: "#=covered, F=flagged, .=revealed zero, 1-8=adjacent mine count; rows go from y=0 downward and x=0 to the right"
        }
      };
      const requestPayload = {
        model,
        // Structured state must be serialized as text in the Decisions API.
        input: JSON.stringify(state),
        questions: {
          reveal: {
            type: "choice",
            instructions: DECISION_INSTRUCTIONS,
            criteria: Object.fromEntries(candidates.map((cell) => [
              `${cell.x},${cell.y}`, neighborSummary(board, cell.x, cell.y, knownMines)
            ]))
          }
        }
      };
      const requestStarted = performance.now();
      const response = await postJson(endpoint, {
        headers: { "x-goog-api-key": apiKey },
        body: requestPayload
      });
      const requestMs = Math.round(performance.now() - requestStarted);
      if (!response.ok) {
        const message = JSON.stringify(response.body)?.slice(0, 400);
        throw new Error(`Gemini Decisions HTTP ${response.status}: ${message}`);
      }
      const answer = response.body?.answers?.reveal;
      if (answer?.type !== "choice" || !candidateKeys.has(answer.choice)) {
        throw new Error(`Gemini Decisions returned an invalid choice: ${answer?.choice}`);
      }
      if (typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence)
        || answer.confidence < 0 || answer.confidence > 1) {
        throw new Error("Gemini Decisions returned an invalid confidence (expected a number between 0 and 1)");
      }
      const [x, y] = answer.choice.split(",").map(Number);
      return {
        x, y, answer,
        usage: response.body.usage ?? null,
        model: response.body.model ?? model,
        request: requestPayload,
        response: response.body,
        requestMs
      };
    }
  };
}
