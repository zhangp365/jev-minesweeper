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
const playwrightConfigPath = join(root, ".playwright", "cli.config.json");
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
// Keep the browser open until the user closes it. Set JEV_REVIEW_MS to a
// positive value only when an automatic review timeout is wanted.
const reviewMs = Math.max(0, Number(process.env.JEV_REVIEW_MS || 0));
const reviewPollMs = Math.max(50, Number(process.env.JEV_REVIEW_POLL_MS || 200));
const runStartedAt = new Date();

function providerFromArgv() {
  const index = process.argv.indexOf("--provider");
  if (index !== -1) return process.argv[index + 1]?.toLowerCase();
  if (process.argv.includes("--jev")) return "jev";
  return null;
}

const levels = [
  { id: "beginner", name: "Beginner", width: 9, height: 9 },
  { id: "intermediate", name: "Intermediate", width: 16, height: 16 },
  { id: "expert", name: "Expert", width: 30, height: 16 }
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
    throw new Error(`Unknown provider: ${providerName} (choose from ${PROVIDER_NAMES.join(", ")})`);
  }
  const postJson = await createJsonPoster({ proxyUrl: config.request.proxyUrl, attempts: config.request.attempts });
  // Create every usable provider: the page dropdown offers all of them, and
  // a selection made during the review window applies to the next game.
  const jevApiKey = resolveJevApiKey(config.jev.apiKey);
  if (jevApiKey) {
    providers.jev = createJevProvider({ ...config.jev, apiKey: jevApiKey, postJson });
    providerOptions.push({ id: "jev", label: `Jev (model ${config.jev.model})` });
  } else {
    console.log("Jev API key not found; skipping the Jev provider.");
  }
  const openaiApiKey = config.openai.apiKey || process.env[config.openai.apiKeyEnv];
  if (openaiApiKey) {
    providers.openai = createOpenAIProvider({ ...config.openai, apiKey: openaiApiKey, postJson });
    providerOptions.push({ id: "openai", label: `OpenAI-compatible (model ${config.openai.model})` });
  } else {
    console.log("OpenAI-compatible API key not found; skipping the OpenAI-compatible provider.");
  }
  provider = providers[providerName];
  if (!provider) {
    throw new Error(`Provider ${providerName} is unavailable (missing key or configuration). Available: ${Object.keys(providers).join(", ") || "none"}`);
  }
  providerModels = { jev: config.jev.model, openai: config.openai.model };
  providerModel = providerModels[providerName];
  transcript.mode = providerName;
  transcript.provider = provider.name;
  console.log(`Provider: ${provider.name} (model ${providerModel}).`);
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
  const args = [url, "--config", playwrightConfigPath, "--browser", "chrome", "--headed", "--persistent", "--profile", join(root, ".playwright-profile")];
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
      cli("eval", "() => document.readyState");
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

// A separate Playwright CLI process costs more than the DOM operation itself.
// Dispatch the same mousedown/mouseup sequence inside the real Chrome page so
// one eval can click, update the panel, and read the resulting board.
function clickAndRenderPanel(x, y, entry, button = 0) {
  const encoded = Buffer.from(JSON.stringify(entry)).toString("base64");
  return readJson(`(() => {
    var target = document.getElementById("cell-${x}-${y}");
    if (!target) throw new Error("Cell ${x},${y} is not present");
    var operationStarted = performance.now();
    var button = ${button};
    var buttons = button === 2 ? 2 : 1;
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: button, buttons: buttons }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: button, buttons: 0 }));
    var binary = atob(\`${encoded}\`);
    var bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
    var entry = JSON.parse(new TextDecoder().decode(bytes));
    if (entry.timings) entry.timings.playwrightClickMs = Math.round(performance.now() - operationStarted);
    if (window.jevPanel) window.jevPanel.update(entry);
    return window.getJevBoardState();
  })()`);
}

function clickCellsAndRead(cells, button = 2) {
  const encoded = JSON.stringify(cells);
  return readJson(`(() => {
    var cells = ${encoded};
    var button = ${button};
    var buttons = button === 2 ? 2 : 1;
    cells.forEach(function (cell) {
      var target = document.getElementById("cell-" + cell[0] + "-" + cell[1]);
      if (!target) throw new Error("Cell " + cell[0] + "," + cell[1] + " is not present");
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: button, buttons: buttons }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: button, buttons: 0 }));
    });
    return window.getJevBoardState();
  })()`);
}

function selectAndStartLevel(levelId) {
  return readJson(`(() => {
    var levelButton = document.getElementById("button_${levelId}");
    var replay = document.getElementById("button_rerun");
    if (!levelButton || !replay) throw new Error("Level controls are not ready");
    levelButton.click();
    replay.click();
    window.__jevRerun = false;
    return window.getSelectedLevel();
  })()`);
}

function selectStartAndRenderOpening(levelId, x, y, entry) {
  const encoded = Buffer.from(JSON.stringify(entry)).toString("base64");
  return readJson(`(() => {
    var levelButton = document.getElementById("button_${levelId}");
    var replay = document.getElementById("button_rerun");
    if (!levelButton || !replay) throw new Error("Level controls are not ready");
    levelButton.click();
    replay.click();
    window.__jevRerun = false;
    var target = document.getElementById("cell-${x}-${y}");
    if (!target) throw new Error("Opening cell ${x},${y} is not present");
    var operationStarted = performance.now();
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
    var binary = atob(\`${encoded}\`);
    var bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
    var entry = JSON.parse(new TextDecoder().decode(bytes));
    if (entry.timings) entry.timings.playwrightClickMs = Math.round(performance.now() - operationStarted);
    if (window.jevPanel) window.jevPanel.update(entry);
    return window.getJevBoardState();
  })()`);
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
    request: { source: "Local rule", action: "Only one legal candidate remains; clicked locally without a model request", choice: { x: candidate.x, y: candidate.y } },
    response: { result: "Local forced choice; no model judgment was needed" },
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
    throw new Error(`${provider.name} returned a cell outside the candidate list (${move.x},${move.y})`);
  }
  if (Number(move.answer.confidence ?? 1) < confidenceFloor) {
    throw new Error(`${provider.name} confidence ${move.answer.confidence} is below JEV_MIN_CONFIDENCE=${confidenceFloor}`);
  }
  return move;
}

async function playLevel(level, { alreadyStarted = false } = {}) {
  const started = performance.now();
  const moves = [];
  let currentBoard;
  let openingStarted = false;

  if (!alreadyStarted && !isVerify && maxSteps > 0) {
    // The initial selection, Replay, safe opening, and panel update fit in one
    // browser eval. This removes two CLI process launches before the first
    // visible move.
    const turnStarted = performance.now();
    const move = openingMove(level);
    const timings = { boardReadMs: 0, modelRequestMs: 0, playwrightClickMs: 0 };
    currentBoard = selectStartAndRenderOpening(level.id, move.x, move.y, {
      status: `Step 1: safe opening; clicked the center cell (${move.x}, ${move.y}).`,
      provider: provider.name,
      model: providerModel,
      request: {
        source: "Local safe opening",
        action: "Clicked the center cell; no model request was sent",
        choice: move
      },
      response: {
        result: "First-click protection is enabled: if the cell contained a mine, the game moved it before revealing the cell."
      },
      timings
    });
    timings.playwrightClickMs = Math.round(performance.now() - turnStarted);
    timings.stateReadAndPanelMs = 0;
    timings.turnTotalMs = Math.round(performance.now() - turnStarted);
    moves.push({ step: 1, source: "opening", x: move.x, y: move.y, timings });
    openingStarted = true;
  } else if (!alreadyStarted) {
    // Selecting a level only prepares an idle board. Replay is the explicit
    // start action and is also what starts the game's timer.
    selectAndStartLevel(level.id);
  }

  if (isVerify) {
    const debugBoard = readJson("window.getBoardState({ includeMines: true })");
    const safeCells = replaySafeCells(debugBoard);
    // A short, screen-recorded smoke run makes one real Playwright CLI click
    // on each level. Full autonomous play belongs to --provider runs, whose
    // every move is selected by the model and clicked through the same CLI.
    const [first] = safeCells;
    cli("click", `td#cell-${first[0]}-${first[1]}`);
    await delay(100);
    const result = readJson("window.getJevBoardState()");
    return { level: level.name, mode: "verify", moves: 1, elapsedMs: Math.round(performance.now() - started), cleared: result.cleared, exploded: result.exploded };
  }

  if (maxSteps > 0 && !openingStarted) {
    const turnStarted = performance.now();
    // Replay has already prepared the selected level and started its timer;
    // its dimensions are known locally, so do not read the untouched board
    // through another CLI process before the safe opening click.
    const move = openingMove(level);
    const timings = { boardReadMs: 0, modelRequestMs: 0, playwrightClickMs: 0 };
    const panelReadStarted = performance.now();
    currentBoard = clickAndRenderPanel(move.x, move.y, {
      status: `Step 1: safe opening; clicked the center cell (${move.x}, ${move.y}).`,
      provider: provider.name,
      model: providerModel,
      request: {
        source: "Local safe opening",
        action: "Clicked the center cell; no model request was sent",
        choice: move
      },
      response: {
        result: "First-click protection is enabled: if the cell contained a mine, the game moved it before revealing the cell."
      },
      timings
    });
    timings.playwrightClickMs = Math.round(performance.now() - panelReadStarted);
    timings.stateReadAndPanelMs = 0;
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
      const flagCells = unflagged.map((key) => key.split(",").map(Number));
      board = clickCellsAndRead(flagCells, 2);
      autoFlagged.push(...unflagged);
    }
    currentBoard = board;
    const autoFlagMs = Math.round(performance.now() - autoFlagStarted);
    const move = await chooseMove(board, level, step);
    const timings = { boardReadMs, autoFlagMs, modelRequestMs: move.requestMs, playwrightClickMs: 0 };
    const panelReadStarted = performance.now();
    const chooserLabel = move.source === "single-candidate" ? "local forced choice" : `${provider.name} (${move.model})`;
    const afterClick = clickAndRenderPanel(move.x, move.y, {
      status: `Step ${step + 1}: ${chooserLabel} selected (${move.x}, ${move.y}), confidence ${move.answer.confidence ?? "unknown"}.`,
      provider: provider.name,
      model: move.source === "single-candidate" ? providerModel : (move.model || providerModel),
      request: move.request,
      response: move.response,
      timings
    });
    timings.playwrightClickMs = Math.round(performance.now() - panelReadStarted);
    timings.stateReadAndPanelMs = 0;
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

// Review window between games: poll the page for the Replay button and the
// provider dropdown. Returns the selected provider and level when the user
// asks for another game.
async function waitForReviewOrClose() {
  const deadline = reviewMs > 0 ? Date.now() + reviewMs : Number.POSITIVE_INFINITY;
  console.log(reviewMs > 0
    ? `Run finished. The browser stays open for up to ${Math.ceil(reviewMs / 1000)} seconds; click Replay to start another game or close the browser to stop.`
    : "Run finished. The browser stays open; click Replay to start another game or close the browser to stop.");
  while (Date.now() < deadline) {
    try {
      // A page reload wipes the dropdown; re-push the options whenever the
      // select is missing so the controls survive refreshes.
      const state = readJson(`(() => { var s = document.getElementById('jev_provider_select'); if ((!s || s.hidden) && window.jevPanel && window.jevPanel.setProviders) window.jevPanel.setProviders(${JSON.stringify(providerOptions)}, ${JSON.stringify(transcript.mode)}); var s2 = document.getElementById('jev_provider_select'); var level = typeof window.getSelectedLevel === 'function' ? window.getSelectedLevel() : window.__jevSelectedLevel; return { rerun: window.__jevRerun === true, provider: s2 && !s2.hidden ? s2.value : null, level: level || null }; })()`);
      if (state.rerun) {
        cli("eval", "() => (window.__jevRerun = false, true)");
        return { rerun: true, providerName: state.provider, levelId: state.level };
      }
    } catch {
      console.log("Browser closed by the user.");
      return { rerun: false, providerName: null, levelId: null };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(reviewPollMs, remaining));
  }
  return { rerun: false, providerName: null, levelId: null };
}

if (!isVerify && !provider) throw new Error("Provider initialization failed");

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
  let levelsForRun = levelsToPlay;
  let alreadyStarted = false;
  while (rerun) {
    rerun = false;
    for (const level of levelsForRun) {
      const result = await playLevel(level, { alreadyStarted });
      alreadyStarted = false;
      report.levels.push(result);
      const outcome = result.mode === "verify"
        ? "verified (1 safe click)"
        : result.cleared
          ? "cleared"
          : result.exploded
            ? "mine"
            : `stopped (step limit ${maxSteps}; adjust JEV_MAX_STEPS if needed)`;
      console.log(`${result.level}: ${outcome} in ${result.elapsedMs} ms`);
    }
    if (provider) {
      const action = await waitForReviewOrClose();
      rerun = action.rerun;
      if (rerun && action.providerName && providers[action.providerName] && action.providerName !== transcript.mode) {
        transcript.mode = action.providerName;
        provider = providers[action.providerName];
        providerModel = providerModels[action.providerName];
        console.log(`Switched provider: ${provider.name} (model ${providerModel}).`);
      }
      if (rerun) {
        const selected = levels.find((level) => level.id === action.levelId);
        const allowed = Boolean(selected);
        levelsForRun = allowed ? [selected] : levelsToPlay;
        // The Replay button has already reset and started the selected board.
        // If its level is unavailable (for example after a page reload), let
        // playLevel perform the normal select-then-Replay sequence instead.
        alreadyStarted = Boolean(allowed);
      }
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await saveTranscript();
  await writeFile(join(artifacts, "run-report.json"), JSON.stringify(report, null, 2));
  server?.kill();
  // Provider runs intentionally leave Chrome open. The review loop ends only
  // after the user closes the browser, so there is no automatic close here.
  if (isVerify) {
    try { cli("close"); } catch { /* browser is already gone */ }
  }
}
