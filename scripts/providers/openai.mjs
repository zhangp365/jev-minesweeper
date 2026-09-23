// OpenAI-compatible chat-completions provider (OpenAI, vLLM, one-api, ...).
// The prompt demands a strict JSON answer; LLM output is still parsed
// defensively because models routinely wrap JSON in prose or code fences.
import { neighborSummary } from "../board-analysis.mjs";
import { DECISION_INSTRUCTIONS } from "../prompt.mjs";

// Best-effort JSON extraction: plain JSON > fenced block > first {...} span >
// repaired span (trailing commas, curly quotes). Throws when nothing parses.
export function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("模型回复为空，无法解析 JSON");
  let candidate = text.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) candidate = fence[1].trim();

  const tryParse = (value) => {
    try { return JSON.parse(value); } catch { return undefined; }
  };
  let parsed = tryParse(candidate);
  if (parsed === undefined) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const span = candidate.slice(start, end + 1);
      parsed = tryParse(span);
      if (parsed === undefined) {
        parsed = tryParse(span
          .replace(/,\s*([}\]])/g, "$1")
          // Fullwidth punctuation that slips in from Chinese output: inside
          // values this only perturbs the free-text reason field, so a global
          // replace is safe.
          .replace(/[\uFF0C]/g, ",")
          .replace(/[\uFF1A]/g, ":")
          .replace(/[\u201c\u201d]/g, '"')
          .replace(/[\u2018\u2019]/g, "'"));
      }
    }
  }
  if (parsed === undefined) throw new Error(`无法从模型回复中解析 JSON：${text.slice(0, 200)}`);
  return parsed;
}

// Accept the many shapes a model may use for the choice: "x,y", "x, y",
// "（x, y）", {x, y} — and only return it when it names a legal candidate.
function normalizeChoiceKey(value, candidateKeys) {
  if (value && typeof value === "object") {
    const x = Number(value.x);
    const y = Number(value.y);
    if (Number.isInteger(x) && Number.isInteger(y)) {
      const key = `${x},${y}`;
      return candidateKeys.has(key) ? key : null;
    }
    return null;
  }
  if (value === null || value === undefined) return null;
  const key = String(value).trim()
    .replace(/[\uFF0C\u3001]/g, ",")
    .replace(/[\uFF08]/g, "(")
    .replace(/[\uFF09]/g, ")")
    .replace(/[(){}[\]"'\s]/g, "");
  return candidateKeys.has(key) ? key : null;
}

function interpretAnswer(content, candidateKeys) {
  let parsed;
  try {
    parsed = extractJson(content);
  } catch {
    return null;
  }
  const key = normalizeChoiceKey(parsed.choice ?? parsed.cell ?? parsed.position ?? parsed, candidateKeys);
  if (!key) return null;
  const confidence = Number(parsed.confidence);
  return {
    key,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 1,
    reason: parsed.reason ?? null
  };
}

const JSON_FORMAT_HINT = '{"choice": "x,y", "confidence": 0.0到1的小数, "reason": "一句话理由"}';

export function createOpenAIProvider({ baseUrl, model, apiKey, temperature = 0, jsonMode = true, postJson, log = console.log }) {
  return {
    name: "openai",
    async choose({ board, candidates, knownMines, level, step }) {
      const candidateKeys = new Set(candidates.map((cell) => `${cell.x},${cell.y}`));
      const messages = [
        { role: "system", content: "你是一名扫雷专家。无论发生什么，你只输出一个 JSON 对象。" },
        { role: "user", content: buildPrompt({ board, candidates, knownMines, level, step }) }
      ];
      const requestPayload = {
        model,
        temperature,
        messages,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {})
      };

      const requestStarted = performance.now();
      let response = await postJson(`${baseUrl}/chat/completions`, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: requestPayload
      });
      if (!response.ok) throw new Error(`OpenAI 兼容接口 HTTP ${response.status}：${JSON.stringify(response.body)?.slice(0, 400)}`);
      let content = response.body?.choices?.[0]?.message?.content ?? "";
      let answer = interpretAnswer(content, candidateKeys);

      // Models occasionally ignore the format or name an off-list cell. One
      // corrective re-ask before giving up keeps a run alive on flaky models.
      if (!answer) {
        log(`模型回复无法解析为合法选择，追加纠错提示重问一次。原始回复：${String(content).slice(0, 120)}`);
        const retryMessages = [
          ...messages,
          { role: "assistant", content: String(content).slice(0, 500) },
          { role: "user", content: `上面的回复无法解析为合法选择。请严格只输出一个 JSON 对象，格式：${JSON_FORMAT_HINT}。choice 必须取自候选列表。` }
        ];
        response = await postJson(`${baseUrl}/chat/completions`, {
          headers: { authorization: `Bearer ${apiKey}` },
          body: { ...requestPayload, messages: retryMessages }
        });
        if (!response.ok) throw new Error(`OpenAI 兼容接口 HTTP ${response.status}：${JSON.stringify(response.body)?.slice(0, 400)}`);
        content = response.body?.choices?.[0]?.message?.content ?? "";
        answer = interpretAnswer(content, candidateKeys);
      }
      const requestMs = Math.round(performance.now() - requestStarted);
      if (!answer) throw new Error(`无法从模型回复解析出合法候选：${String(content).slice(0, 300)}`);

      const [x, y] = answer.key.split(",").map(Number);
      return {
        x,
        y,
        answer: { choice: answer.key, confidence: answer.confidence, reason: answer.reason },
        usage: response.body?.usage ?? null,
        model: response.body?.model ?? model,
        request: requestPayload,
        response: response.body,
        requestMs
      };
    }
  };
}

function buildPrompt({ board, candidates, knownMines, level, step }) {
  const rows = board.rows.map((row, y) => `y=${y}: ${row.split("").join(" ")}`).join("\n");
  const candidateLines = candidates.map((cell) => `(${cell.x},${cell.y}) ${neighborSummary(board, cell.x, cell.y, knownMines)}`).join("\n");
  return [
    `这是一局扫雷游戏：${level.name}，棋盘 ${board.width}x${board.height}，共 ${board.mines} 颗雷，已插旗 ${board.flaggedCount} 颗，当前第 ${step + 1} 步。`,
    "棋盘记号：#=未翻开，F=插旗，.=已翻开的 0，1-8=相邻雷数。行自上而下为 y=0 到 " + (board.height - 1) + "，列自左向右为 x=0 到 " + (board.width - 1) + "。",
    "",
    "当前棋盘：",
    rows,
    "",
    "你只能从以下候选格中选择一个翻开（已排除由数字约束确定的雷）：",
    candidateLines,
    "",
    DECISION_INSTRUCTIONS,
    "",
    "输出要求：只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块，格式：",
    JSON_FORMAT_HINT,
    "其中 choice 必须取自上面的候选列表，confidence 是你对“该格无雷”的把握程度。"
  ].join("\n");
}
