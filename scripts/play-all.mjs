#!/usr/bin/env node
/**
 * Records one three-level Minesweeper session.
 *
 * --verify            replays known-safe cells using the debug-only board API,
 *                     proving the DOM bridge and Playwright click path without
 *                     claiming an AI run.
 * --provider jev      let Jev select every reveal (default).
 * --provider openai   let any OpenAI-compatible chat model select every reveal.
 *
 * Provider endpoints/models/keys live in config/providers.yaml (see
 * config/providers.example.yaml). Both providers share the same decision
 * instructions, board state, candidate ranking, and move shape; only their
 * API request/output wrappers differ.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadLlmConfig, PROVIDER_NAMES } from "./config.mjs";
import { createJsonPoster } from "./http.mjs";
import { rankedCandidates } from "./board-analysis.mjs";
import { createJevProvider, resolveJevApiKey } from "./providers/jev.mjs";
import { createOpenAIProvider } from "./providers/openai.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifacts = join(root, "artifacts");
const resultDir = join(root, "result");
const configPath = join(root, "config", "providers.yaml");
const port = Number(process.env.MINESWEEPER_PORT || 4173);
const session = "minesweeper-three-levels";
const playwrightCliEntrypoint = process.platform === "win32" && process.env.APPDATA
  ? join(process.env.APPDATA, "npm", "node_modules", "@playwright", "cli", "playwright-cli.js")
  : null;

const isVerify = process.argv.includes("--verify");
const reuseSession = process.argv.includes("--reuse-session");
const externalServer = process.argv.includes("--external-server");
const levelArgument = process.argv.indexOf("--level");
const selectedLevel = levelArgument === -1 ? null : process.argv[levelArgument + 1]?.toLowerCase();
const providerArgument = providerFromArgv();
// Play each level to completion by default; set JEV_MAX_STEPS to cap model
// turns (e.g. while validating a new provider setup at minimal cost).
const maxSteps = Number(process.env.JEV_MAX_STEPS || 999);
const confidenceFloor = Number(process.env.JEV_MIN_CONFIDENCE || 0);
const candidateLimit = Number(process.env.JEV_CANDIDATE_LIMIT || 12);
const reviewMs = Math.max(0, Number(process.env.JEV_REVIEW_MS || 60_000));
const runStartedAt = new Date();

function providerFromArgv() {
  const index = process.argv.indexOf("--provider");
  if (index !== -1) return process.argv[index + 1]?.toLowerCase();
  if (process.argv.includes("--jev")) return "jev";
  return null;
}

const levels = [
  { id: "beginner", name: "Beginner" },
  { id: "intermediate", name: "Intermediate" },
  { id: "expert", name: "Expert" }
];
const levelsToPlay = selectedLevel ? levels.filter((level) => level.id === selectedLevel) : levels;
if (selectedLevel && !levelsToPlay.length) throw new Error(`Unknown level: ${selectedLevel}`);

const transcriptPath = join(resultDir, `jev-${runStartedAt.toISOString().replace(/[:.]/g, "-")}.json`);
const transcript = { mode: isVerify ? "verify" : null, provider: null, startedAt: runStartedAt.toISOString(), entries: [] };

let provider = null;
let providerModel = null;
let providerModels = null;
const providers = {};
const providerOptions = [];
if (!isVerify) {
  const config = loadLlmConfig(configPath);
  const providerName = (providerArgument || config.defaultProvider || "jev").toLowerCase();
  if (!PROVIDER_NAMES.includes(providerName)) {
    throw new Error(`未知 provider：${providerName}（可选：${PROVIDER_NAMES.join("、")}）`);
  }
  const postJson = await createJsonPoster({ proxyUrl: config.request.proxyUrl, attempts: config.request.attempts });
  // Create every usable provider: the page dropdown offers all of them, and
  // a selection made during the review window applies to the next game.
  const jevApiKey = resolveJevApiKey(config.jev.apiKey);
  if (jevApiKey) {
    providers.jev = createJevProvider({ ...config.jev, apiKey: jevApiKey, postJson });
    providerOptions.push({ id: "jev", label: `Jev（模型 ${config.jev.model}）` });
  } else {
    console.log("未找到 Jev 密钥，跳过 jev 决策方。");
  }
  const openaiApiKey = config.openai.apiKey || process.env[config.openai.apiKeyEnv];
  if (openaiApiKey) {
    providers.openai = createOpenAIProvider({ ...config.openai, apiKey: openaiApiKey, postJson });
    providerOptions.push({ id: "openai", label: `OpenAI 兼容（模型 ${config.openai.model}）` });
  } else {
    console.log("未找到 OpenAI 兼容密钥，跳过 openai 决策方。");
  }
  provider = providers[providerName];
  if (!provider) {
    throw new Error(`决策方 ${providerName} 不可用（缺少密钥或配置）。当前可用：${Object.keys(providers).join("、") || "无"}`);
  }
  providerModels = { jev: config.jev.model, openai: config.openai.model };
  providerModel = providerModels[providerName];
  transcript.mode = providerName;
  transcript.provider = provider.name;
  console.log(`决策提供方：${provider.name}（模型 ${providerModel}）。`);
}

function cli(command, ...args) {
  let output;
  if (process.platform === "win32" && playwrightCliEntrypoint && existsSync(playwrightCliEntrypoint)) {
    output = execFileSync(process.execPath, [playwrightCliEntrypoint, `-s=${session}`, command, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } else if (process.platform !== "win32") {
    output = execFileSync("playwright-cli", [`-s=${session}`, command, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } else {
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const commandLine = ["&", "playwright-cli", quote(`-s=${session}`), quote(command), ...args.map(quote)].join(" ");
    output = execFileSync("powershell.exe", ["-NoProfile", "-Command", commandLine], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  }
  if (output.includes("### Error")) throw new Error(`playwright-cli ${command} failed:\n${output}`);
  return output;
}

function openBrowser(url) {
  const args = [url, "--browser", "chrome", "--headed", "--persistent", "--profile", join(root, ".playwright-profile")];
  if (process.platform === "win32" && playwrightCliEntrypoint && existsSync(playwrightCliEntrypoint)) {
    try {
      execFileSync(process.execPath, [playwrightCliEntrypoint, `-s=${session}`, "open", ...args], {
        cwd: root,
        stdio: "ignore",
        timeout: 15000,
        windowsHide: true
      });
    } catch (error) {
      if (error.code !== "ETIMEDOUT") throw error;
    }
    return;
  }
  if (process.platform !== "win32") {
    cli("open", ...args);
    return;
  }
  // A headed persistent `open` can keep stdout/stderr handles open through
  // its daemon. Do not pipe them into execFileSync: it then waits forever for
  // EOF even though the named browser session has already started.
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const commandLine = ["&", "playwright-cli", quote(`-s=${session}`), quote("open"), ...args.map(quote)].join(" ");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", commandLine], {
    cwd: root,
    stdio: "ignore",
      timeout: 15000,
      windowsHide: true
    });
  } catch (error) {
    // The session may be ready even if the wrapper reached the safety timeout.
    if (error.code !== "ETIMEDOUT") throw error;
  }
}

function closeExistingSession() {
  try { cli("close"); } catch { /* no existing session */ }
}

async function waitForBrowser() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      cli("resize", "1280", "820");
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError || new Error("Playwright browser session did not start");
}

async function waitForPageReady() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if (readJson("document.getElementById('button_beginner') !== null")) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error("Minesweeper page did not finish loading");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function saveTranscript() {
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2));
}

function readJson(expression) {
  const output = cli("eval", `() => JSON.stringify(${expression})`);
  const match = output.match(/### Result\r?\n([\s\S]*?)\r?\n### /);
  if (!match) throw new Error(`Could not parse playwright-cli eval output: ${output}`);
  return JSON.parse(JSON.parse(match[1].trim()));
}

function readBoardAndRenderPanel(entry) {
  const encoded = Buffer.from(JSON.stringify(entry)).toString("base64");
  return readJson(`(() => { var binary = atob(\`${encoded}\`); var bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); }); var entry = JSON.parse(new TextDecoder().decode(bytes)); if (window.jevPanel) window.jevPanel.update(entry); return window.getJevBoardState(); })()`);
}

function replaySafeCells(board) {
  return board.cells.flat().filter((cell) => !cell.isMine).map((cell) => [cell.x, cell.y]);
}

function openingMove(board) {
  // The game moves a first-click mine before revealing it. Start in the center
  // to open a useful area without spending a model request on an empty board.
  return { x: Math.floor(board.width / 2), y: Math.floor(board.height / 2) };
}

// One candidate is not a choice: click it locally instead of spending a model
// request on the forced answer.
function forcedCandidateMove(candidate) {
  return {
    x: candidate.x,
    y: candidate.y,
    source: "single-candidate",
    answer: { choice: `${candidate.x},${candidate.y}`, confidence: 1 },
    usage: null,
    model: "local",
    request: { source: "本地规则", action: "只剩一个合法候选，直接点击，未发送模型请求", choice: { x: candidate.x, y: candidate.y } },
    response: { result: "本地直选，无需判断" },
    requestMs: 0
  };
}

// Every provider returns the same move shape; game rules (legal candidate,
// confidence floor) are enforced here once, independent of the provider.
async function chooseMove(board, level, step) {
  const { cells: candidates, knownMines } = rankedCandidates(board, candidateLimit);
  if (!candidates.length) throw new Error("No covered cells remain");
  const move = candidates.length === 1
    ? forcedCandidateMove(candidates[0])
    : await provider.choose({ board, candidates, knownMines, level, step });
  if (!candidates.some((cell) => cell.x === move.x && cell.y === move.y)) {
    throw new Error(`${provider.name} 返回了候选之外的格子 (${move.x},${move.y})`);
  }
  if (Number(move.answer.confidence ?? 1) < confidenceFloor) {
    throw new Error(`${provider.name} 置信度 ${move.answer.confidence} 低于 JEV_MIN_CONFIDENCE=${confidenceFloor}`);
  }
  return move;
}

async function playLevel(level) {
  cli("click", `button#button_${level.id}`);
  const started = performance.now();
  const moves = [];

  if (isVerify) {
    const debugBoard = readJson("window.getBoardState({ includeMines: true })");
    const safeCells = replaySafeCells(debugBoard);
    // A short, screen-recorded smoke run makes one real Playwright CLI click
    // on each level. Full autonomous play belongs to --provider runs, whose
    // every move is selected by the model and clicked through the same CLI.
    const [first] = safeCells;
    cli("click", `td#cell-${first[0]}-${first[1]}`);
    await delay(900);
    const result = readJson("window.getJevBoardState()");
    return { level: level.name, mode: "verify", moves: 1, elapsedMs: Math.round(performance.now() - started), cleared: result.cleared, exploded: result.exploded };
  }

  let currentBoard;
  if (maxSteps > 0) {
    const turnStarted = performance.now();
    const boardReadStarted = performance.now();
    const board = readJson("window.getJevBoardState()");
    const boardReadMs = Math.round(performance.now() - boardReadStarted);
    const move = openingMove(board);
    const clickStarted = performance.now();
    cli("click", `td#cell-${move.x}-${move.y}`);
    const clickMs = Math.round(performance.now() - clickStarted);
    const timings = { boardReadMs, modelRequestMs: 0, playwrightClickMs: clickMs };
    const panelReadStarted = performance.now();
    currentBoard = readBoardAndRenderPanel({
      status: `第 1 步：安全开局，直接点击中心格 (${move.x}, ${move.y})。`,
      provider: provider.name,
      model: providerModel,
      request: {
        source: "本地安全开局",
        action: "直接点击中心格；不发送模型请求",
        choice: move
      },
      response: {
        result: "扫雷首点保护已启用：若该格原本有雷，游戏会在翻开前移动该雷。"
      },
      timings
    });
    timings.stateReadAndPanelMs = Math.round(performance.now() - panelReadStarted);
    timings.turnTotalMs = Math.round(performance.now() - turnStarted);
    moves.push({ step: 1, source: "opening", x: move.x, y: move.y, timings });
  }

  for (let step = moves.length; step < maxSteps; step++) {
    const turnStarted = performance.now();
    let boardReadMs = 0;
    if (!currentBoard) {
      const boardReadStarted = performance.now();
      currentBoard = readJson("window.getJevBoardState()");
      boardReadMs = Math.round(performance.now() - boardReadStarted);
    }
    let board = currentBoard;
    if (board.cleared || board.exploded) break;
    // Deterministic bookkeeping before every model turn: flag the mines that
    // number constraints force. Flagging can satisfy further numbers, so
    // re-read and re-rank until no new forced mine shows up.
    const autoFlagStarted = performance.now();
    const autoFlagged = [];
    for (let pass = 0; pass < 3; pass++) {
      const { knownMines } = rankedCandidates(board, candidateLimit);
      const unflagged = [...knownMines].filter((key) => {
        const [x, y] = key.split(",").map(Number);
        return board.rows[y][x] === "#";
      });
      if (!unflagged.length) break;
      for (const key of unflagged) {
        const [x, y] = key.split(",").map(Number);
        cli("click", `td#cell-${x}-${y}`, "right");
        autoFlagged.push(key);
      }
      board = readJson("window.getJevBoardState()");
    }
    currentBoard = board;
    const autoFlagMs = Math.round(performance.now() - autoFlagStarted);
    const move = await chooseMove(board, level, step);
    const clickStarted = performance.now();
    cli("click", `td#cell-${move.x}-${move.y}`);
    const clickMs = Math.round(performance.now() - clickStarted);
    const timings = { boardReadMs, autoFlagMs, modelRequestMs: move.requestMs, playwrightClickMs: clickMs };
    const panelReadStarted = performance.now();
    const chooserLabel = move.source === "single-candidate" ? "唯一候选直选" : `${provider.name}（${move.model}）`;
    const afterClick = readBoardAndRenderPanel({
      status: `第 ${step + 1} 步：${chooserLabel} 选择 (${move.x}, ${move.y})，置信度 ${move.answer.confidence ?? "未知"}。`,
      provider: provider.name,
      model: move.source === "single-candidate" ? providerModel : (move.model || providerModel),
      request: move.request,
      response: move.response,
      timings
    });
    timings.stateReadAndPanelMs = Math.round(performance.now() - panelReadStarted);
    timings.turnTotalMs = Math.round(performance.now() - turnStarted);
    if (!afterClick.cleared && !afterClick.exploded
      && afterClick.revealedCount === board.revealedCount
      && afterClick.flaggedCount === board.flaggedCount) {
      throw new Error(`Playwright click at (${move.x},${move.y}) did not change the board`);
    }
    currentBoard = afterClick;
    moves.push({ step: step + 1, source: move.source || provider.name, provider: move.source === "single-candidate" ? "local" : provider.name, x: move.x, y: move.y, confidence: move.answer.confidence, usage: move.usage, model: move.model, autoFlagged: autoFlagged.length || undefined, timings });
    transcript.entries.push({
      level: level.name,
      step: step + 1,
      provider: move.source === "single-candidate" ? "local" : provider.name,
      request: move.request,
      response: move.response,
      autoFlagged: autoFlagged.length ? autoFlagged : undefined,
      timings
    });
    await saveTranscript();
  }
  const result = readJson("window.getJevBoardState()");
  return { level: level.name, mode: transcript.mode, provider: provider.name, moves, elapsedMs: Math.round(performance.now() - started), cleared: result.cleared, exploded: result.exploded, stepLimitReached: !result.cleared && !result.exploded && moves.length === maxSteps };
}

// Review window between games: poll the page for the 重跑 button and the
// provider dropdown. Returns { rerun, providerName } — rerun true means the
// user asked for another game with providerName as the decision provider.
async function waitForReviewOrClose() {
  if (!reviewMs) return { rerun: false, providerName: null };
  const deadline = Date.now() + reviewMs;
  console.log(`运行结束：浏览器保留最多 ${Math.ceil(reviewMs / 1000)} 秒——页面「重跑」按钮可再来一局（下拉框切换决策方，下一局生效），手动关闭浏览器立即结束。`);
  while (Date.now() < deadline) {
    await delay(Math.min(3000, deadline - Date.now()));
    try {
      // A page reload wipes the dropdown; re-push the options whenever the
      // select is missing so the controls survive refreshes.
      const state = readJson(`(() => { var s = document.getElementById('jev_provider_select'); if ((!s || s.hidden) && window.jevPanel && window.jevPanel.setProviders) window.jevPanel.setProviders(${JSON.stringify(providerOptions)}, ${JSON.stringify(transcript.mode)}); var s2 = document.getElementById('jev_provider_select'); return { rerun: window.__jevRerun === true, provider: s2 && !s2.hidden ? s2.value : null }; })()`);
      if (state.rerun) {
        cli("eval", "() => (window.__jevRerun = false, true)");
        return { rerun: true, providerName: state.provider };
      }
    } catch {
      console.log("检测到浏览器已手动关闭。");
      return { rerun: false, providerName: null };
    }
  }
  return { rerun: false, providerName: null };
}

if (!isVerify && !provider) throw new Error("provider 初始化失败");

await mkdir(artifacts, { recursive: true });
await mkdir(resultDir, { recursive: true });
// Keep the server in a separate process: Playwright CLI calls are synchronous
// and would otherwise pause the in-process HTTP server while navigation loads.
const server = externalServer ? null : spawn(process.execPath, [join(root, "scripts", "static-server.mjs"), root, String(port)], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true
});
if (!externalServer) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) break;
    } catch { /* the server is still starting */ }
    await delay(100);
    if (attempt === 29) throw new Error(`Static server did not start on port ${port}`);
  }
}
const report = { mode: transcript.mode, provider: transcript.provider, startedAt: runStartedAt.toISOString(), resultFile: `result/${transcriptPath.split(/[\\/]/).pop()}`, levels: [] };

try {
  if (!reuseSession) {
    // A crashed previous run can leave the fixed named session open on an old
    // page. Close it before opening a fresh page; --reuse-session is the
    // explicit opt-in for intentionally continuing an existing session.
    closeExistingSession();
    openBrowser(`http://127.0.0.1:${port}/`);
    await waitForBrowser();
    await waitForPageReady();
  } else {
    cli("resize", "1280", "820");
    await waitForPageReady();
  }
  if (provider) {
    // The page may still be loading when the browser session is ready;
    // window.jevPanel exists as soon as the head scripts run, so also wait
    // for the body elements before pushing the provider options.
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const pushed = readJson(`(() => { if (!window.jevPanel || !window.jevPanel.setProviders) return false; if (!document.getElementById('jev_provider_select') || !document.getElementById('button_beginner')) return false; window.jevPanel.setProviders(${JSON.stringify(providerOptions)}, ${JSON.stringify(transcript.mode)}); return true; })()`);
        if (pushed) break;
      } catch { /* page not ready yet */ }
      await delay(500);
    }
  }
  let rerun = true;
  while (rerun) {
    rerun = false;
    for (const level of levelsToPlay) {
      const result = await playLevel(level);
      report.levels.push(result);
      const outcome = result.mode === "verify"
        ? "verified (1 safe click)"
        : result.cleared
          ? "cleared"
          : result.exploded
            ? "mine"
            : `stopped (步数上限 ${maxSteps}，可用 JEV_MAX_STEPS 调整)`;
      console.log(`${result.level}: ${outcome} in ${result.elapsedMs} ms`);
    }
    if (provider) {
      const action = await waitForReviewOrClose();
      rerun = action.rerun;
      if (rerun && action.providerName && providers[action.providerName] && action.providerName !== transcript.mode) {
        transcript.mode = action.providerName;
        provider = providers[action.providerName];
        providerModel = providerModels[action.providerName];
        console.log(`切换决策方：${provider.name}（模型 ${providerModel}）。`);
      }
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await saveTranscript();
  await writeFile(join(artifacts, "run-report.json"), JSON.stringify(report, null, 2));
  server?.kill();
  try { cli("close"); } catch { /* browser is already gone */ }
}
