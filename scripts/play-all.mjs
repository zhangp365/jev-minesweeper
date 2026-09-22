#!/usr/bin/env node
/**
 * Records one three-level Minesweeper session.
 *
 * --jev     asks Jev to select every reveal (requires TYPESAFE_API_KEY).
 * --verify  replays known-safe cells using the debug-only board API, proving
 *           the DOM bridge and Playwright click path without claiming an AI run.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifacts = join(root, "artifacts");
const resultDir = join(root, "result");
const port = Number(process.env.MINESWEEPER_PORT || 4173);
const session = "minesweeper-three-levels";
const playwrightCliEntrypoint = process.platform === "win32" && process.env.APPDATA
  ? join(process.env.APPDATA, "npm", "node_modules", "@playwright", "cli", "playwright-cli.js")
  : null;
function readConfiguredKey() {
  const inherited = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
  if (inherited || process.platform !== "win32") return inherited;
  // A machine-scoped variable is not automatically inherited by a long-lived
  // desktop app. Read it only into this process; never log or write the value.
  const script = "[Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY','Machine'); [Environment]::GetEnvironmentVariable('JEV_API_KEY','Machine')";
  const values = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return values[0];
}
const key = readConfiguredKey();
const mode = process.argv.includes("--verify") ? "verify" : "jev";
const reuseSession = process.argv.includes("--reuse-session");
const externalServer = process.argv.includes("--external-server");
const levelArgument = process.argv.indexOf("--level");
const selectedLevel = levelArgument === -1 ? null : process.argv[levelArgument + 1]?.toLowerCase();
// The direct route to the Jev API is flaky from some networks (connection
// resets mid-TLS). When a proxy is configured, route through it; this needs
// the optional "undici" package because Node's built-in fetch ignores
// HTTPS_PROXY. Without it the run still works, just direct + retried.
const proxyUrl = process.env.JEV_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const requestAttempts = Number(process.env.JEV_REQUEST_ATTEMPTS || 3);
let proxiedFetch = null;
if (proxyUrl) {
  try {
    const { fetch: undiciFetch, ProxyAgent } = await import("undici");
    const dispatcher = new ProxyAgent(proxyUrl);
    proxiedFetch = (url, init) => undiciFetch(url, { ...init, dispatcher });
    console.log(`Jev 请求走本地代理 ${proxyUrl}。`);
  } catch {
    console.log(`检测到代理 ${proxyUrl}，但未安装 undici，仍直连。可运行 "npm install undici" 启用代理。`);
  }
}

// Network-level failures (socket reset, connect timeout) are transient on the
// direct route; retry the same payload before giving up. HTTP error statuses
// are real answers and are not retried.
async function sendJevRequest(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= requestAttempts; attempt++) {
    try {
      return await (proxiedFetch || fetch)(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < requestAttempts) {
        const backoffMs = 1000 * 2 ** (attempt - 1) + Math.random() * 500;
        console.log(`Jev 请求连接失败（第 ${attempt} 次：${error.cause?.code || error.cause?.message || error.message}），${Math.round(backoffMs)} ms 后重试。`);
        await delay(backoffMs);
      }
    }
  }
  throw new Error(`连接 ${new URL(url).host} 连续 ${requestAttempts} 次失败：${lastError.cause?.code || lastError.cause?.message || lastError.message}`);
}
// Start conservatively while validating a new Playwright/Jev setup. Increase
// explicitly with JEV_MAX_STEPS once a short run has changed the board.
const maxSteps = Number(process.env.JEV_MAX_STEPS || 5);
const confidenceFloor = Number(process.env.JEV_MIN_CONFIDENCE || 0);
const candidateLimit = Number(process.env.JEV_CANDIDATE_LIMIT || 12);
const reviewMs = Math.max(0, Number(process.env.JEV_REVIEW_MS || 60_000));
const runStartedAt = new Date();
const transcript = { mode, startedAt: runStartedAt.toISOString(), entries: [] };
const transcriptPath = join(resultDir, `jev-${runStartedAt.toISOString().replace(/[:.]/g, "-")}.json`);
const levels = [
  { id: "beginner", name: "Beginner" },
  { id: "intermediate", name: "Intermediate" },
  { id: "expert", name: "Expert" }
];
const levelsToPlay = selectedLevel ? levels.filter((level) => level.id === selectedLevel) : levels;
if (selectedLevel && !levelsToPlay.length) throw new Error(`Unknown level: ${selectedLevel}`);
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

function surroundingCells(board, x, y) {
  const cells = [];
  for (let yOffset = -1; yOffset <= 1; yOffset++) {
    for (let xOffset = -1; xOffset <= 1; xOffset++) {
      const neighborX = x + xOffset;
      const neighborY = y + yOffset;
      if ((xOffset || yOffset) && neighborX >= 0 && neighborX < board.width && neighborY >= 0 && neighborY < board.height) {
        cells.push({ x: neighborX, y: neighborY, value: board.rows[neighborY][neighborX] });
      }
    }
  }
  return cells;
}

function rankedCandidates(board) {
  const covered = [];
  const constraintRisk = new Map();
  const adjacentNumber = new Map();
  const knownSafe = new Set();
  const knownMines = new Set();
  const coordinate = (x, y) => `${x},${y}`;

  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const value = board.rows[y][x];
      if (value === "#") covered.push({ x, y });
      if (!/[1-8]/.test(value)) continue;
      const neighbors = surroundingCells(board, x, y);
      const unknown = neighbors.filter((cell) => cell.value === "#");
      const flags = neighbors.filter((cell) => cell.value === "F").length;
      const remaining = Number(value) - flags;
      if (!unknown.length || remaining < 0) continue;
      if (remaining === 0) unknown.forEach((cell) => knownSafe.add(coordinate(cell.x, cell.y)));
      if (remaining === unknown.length) unknown.forEach((cell) => knownMines.add(coordinate(cell.x, cell.y)));
      const localRisk = Math.max(0, Math.min(1, remaining / unknown.length));
      unknown.forEach((cell) => {
        const key = coordinate(cell.x, cell.y);
        constraintRisk.set(key, Math.max(constraintRisk.get(key) || 0, localRisk));
        adjacentNumber.set(key, Math.min(adjacentNumber.get(key) ?? 9, Number(value)));
      });
    }
  }

  const globalRisk = Math.max(0, (board.mines - board.flaggedCount) / Math.max(1, covered.length));
  const centerX = (board.width - 1) / 2;
  const centerY = (board.height - 1) / 2;
  const legal = covered.filter((cell) => !knownMines.has(coordinate(cell.x, cell.y)));
  const ranked = (legal.length ? legal : covered).map((cell) => {
    const key = coordinate(cell.x, cell.y);
    const risk = knownSafe.has(key) ? 0 : (constraintRisk.has(key) ? constraintRisk.get(key) : globalRisk);
    return {
      ...cell,
      risk: Number(risk.toFixed(3)),
      forcedSafe: knownSafe.has(key),
      adjacentNumber: adjacentNumber.get(key) ?? null,
      distanceFromCenter: Math.abs(cell.x - centerX) + Math.abs(cell.y - centerY)
    };
  });

  // Give Jev a focused local set first: covered cells next to the smallest
  // revealed numbers are the most useful places for deterministic deduction.
  const boundaryLimit = Math.min(10, candidateLimit);
  const boundary = ranked
    .filter((cell) => cell.adjacentNumber !== null)
    .sort((left, right) => left.adjacentNumber - right.adjacentNumber
      || left.risk - right.risk
      || left.distanceFromCenter - right.distanceFromCenter)
    .slice(0, boundaryLimit);
  const chosen = new Set(boundary.map((cell) => coordinate(cell.x, cell.y)));

  // Add representatives from cells that are not adjacent to any revealed
  // number. Pick separated points so these represent different unexplored
  // directions instead of repeating one local patch.
  const unexplored = ranked.filter((cell) => !chosen.has(coordinate(cell.x, cell.y)) && cell.adjacentNumber === null);
  const regionCount = Math.min(unexplored.length, Math.max(0, candidateLimit - boundary.length));
  const regions = [];
  const remaining = [...unexplored];
  while (regions.length < regionCount && remaining.length) {
    let pickIndex = 0;
    if (regions.length) {
      pickIndex = remaining.reduce((bestIndex, cell, index) => {
        const nearest = Math.min(...regions.map((region) => Math.abs(cell.x - region.x) + Math.abs(cell.y - region.y)));
        const bestNearest = Math.min(...regions.map((region) => Math.abs(remaining[bestIndex].x - region.x) + Math.abs(remaining[bestIndex].y - region.y)));
        return nearest > bestNearest ? index : bestIndex;
      }, 0);
    }
    regions.push(remaining.splice(pickIndex, 1)[0]);
  }

  const selected = [...boundary, ...regions];
  if (selected.length < candidateLimit) {
    selected.push(...ranked
      .filter((cell) => !chosen.has(coordinate(cell.x, cell.y)) && !selected.some((item) => item.x === cell.x && item.y === cell.y))
      .sort((left, right) => left.risk - right.risk || left.distanceFromCenter - right.distanceFromCenter)
      .slice(0, candidateLimit - selected.length));
  }
  return { cells: selected.slice(0, candidateLimit), knownMines };
}

// Per-candidate criteria text: which of the 8 neighbours hold a number, given
// as position=count, plus every neighbour confirmed to be a mine (flagged, or
// forced by a satisfied number constraint).
function neighborSummary(board, x, y, knownMines) {
  const numbers = [];
  const mines = [];
  surroundingCells(board, x, y).forEach((cell) => {
    if (/[1-8]/.test(cell.value)) numbers.push(`(${cell.x},${cell.y})=${cell.value}`);
    else if (cell.value === "F" || knownMines.has(`${cell.x},${cell.y}`)) mines.push(`(${cell.x},${cell.y})`);
  });
  return `numbers: ${numbers.join(" ") || "none"}; confirmed mines: ${mines.join(" ") || "none"}`;
}

async function chooseWithJev(board, level, step) {
  const { cells: candidates, knownMines } = rankedCandidates(board);
  if (!candidates.length) throw new Error("No covered cells remain");
  // One candidate is not a choice: click it locally instead of spending a
  // Jev request on the forced answer.
  if (candidates.length === 1) {
    const only = candidates[0];
    return {
      x: only.x,
      y: only.y,
      source: "single-candidate",
      answer: { choice: `${only.x},${only.y}`, confidence: 1 },
      usage: null,
      model: "local",
      request: { source: "本地规则", action: "只剩一个合法候选，直接点击，未发送 Jev 请求", choice: { x: only.x, y: only.y } },
      response: { result: "本地直选，无需判断" },
      requestMs: 0
    };
  }
  const candidateKeys = new Set(candidates.map((cell) => `${cell.x},${cell.y}`));
  const instructions = "You are a Minesweeper expert playing a Minesweeper game. Select one candidate cell to reveal. Return only the single safest choice.\n1. Use adjacent numbers to determine whether there is a mine, and return a cell that cannot contain a mine.\n2. If the numbers are insufficient to deduce this, evaluate the total number of mines on the board and try the lowest-risk choice.\n3. Each option's criterion lists its 8 surrounding cells: numbered neighbours as (x,y)=count, and any neighbour confirmed to be a mine.";
  // Jev's choice schema requires criteria to be a dictionary. The coordinate
  // keys identify the choices; each value describes that candidate's immediate
  // neighbourhood so Jev can judge it without rescanning the whole board.
  const criteria = Object.fromEntries(candidates.map((cell) => [`${cell.x},${cell.y}`, neighborSummary(board, cell.x, cell.y, knownMines)]));
  const requestPayload = {
    model: "jev-latest",
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
  const response = await sendJevRequest("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(requestPayload)
  });
  const body = await response.json();
  const requestMs = Math.round(performance.now() - requestStarted);
  if (!response.ok) throw new Error(`Jev HTTP ${response.status}: ${JSON.stringify(body)}`);
  const answer = body.answers && body.answers.reveal;
  const choice = answer && answer.choice;
  if (!candidateKeys.has(choice)) throw new Error(`Jev returned an invalid choice: ${choice}`);
  if (Number(answer.confidence ?? 1) < confidenceFloor) {
    throw new Error(`Jev confidence ${answer.confidence} below JEV_MIN_CONFIDENCE=${confidenceFloor}`);
  }
  const [x, y] = choice.split(",").map(Number);
  return { x, y, answer, usage: body.usage, model: body.model, request: requestPayload, response: body, requestMs };
}

function replaySafeCells(board) {
  return board.cells.flat().filter((cell) => !cell.isMine).map((cell) => [cell.x, cell.y]);
}

function openingMove(board) {
  // The game moves a first-click mine before revealing it. Start in the center
  // to open a useful area without spending a Jev request on an empty board.
  return { x: Math.floor(board.width / 2), y: Math.floor(board.height / 2) };
}

async function playLevel(level) {
  cli("click", `button#button_${level.id}`);
  const started = performance.now();
  const moves = [];

  if (mode === "verify") {
    const debugBoard = readJson("window.getBoardState({ includeMines: true })");
    const safeCells = replaySafeCells(debugBoard);
    // A short, screen-recorded smoke run makes one real Playwright CLI click
    // on each level. Full autonomous play belongs to --jev, whose every move
    // is selected by the API and clicked through the same CLI.
    const [first] = safeCells;
    cli("click", `td#cell-${first[0]}-${first[1]}`);
    await delay(900);
    const result = readJson("window.getJevBoardState()");
    return { level: level.name, mode, moves: 1, elapsedMs: Math.round(performance.now() - started), cleared: result.cleared, exploded: result.exploded };
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
    const timings = { boardReadMs, jevRequestMs: 0, playwrightClickMs: clickMs };
    const panelReadStarted = performance.now();
    currentBoard = readBoardAndRenderPanel({
      status: `第 1 步：安全开局，直接点击中心格 (${move.x}, ${move.y})。`,
      request: {
        source: "本地安全开局",
        action: "直接点击中心格；不发送 Jev 请求",
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
    const board = currentBoard;
    if (board.cleared || board.exploded) break;
    const move = await chooseWithJev(board, level, step);
    const clickStarted = performance.now();
    cli("click", `td#cell-${move.x}-${move.y}`);
    const clickMs = Math.round(performance.now() - clickStarted);
    const timings = { boardReadMs, jevRequestMs: move.requestMs, playwrightClickMs: clickMs };
    const panelReadStarted = performance.now();
    const afterClick = readBoardAndRenderPanel({
      status: move.model === "local"
        ? `第 ${step + 1} 步：只剩唯一候选 (${move.x}, ${move.y})，本地直接点击。`
        : `第 ${step + 1} 步：Jev 选择 (${move.x}, ${move.y})，置信度 ${move.answer.confidence ?? "未知"}。`,
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
    moves.push({ step: step + 1, source: move.source || "jev", x: move.x, y: move.y, confidence: move.answer.confidence, usage: move.usage, model: move.model, timings });
    transcript.entries.push({
      level: level.name,
      step: step + 1,
      request: move.request,
      response: move.response,
      timings
    });
    await saveTranscript();
  }
  const result = readJson("window.getJevBoardState()");
  return { level: level.name, mode, moves, elapsedMs: Math.round(performance.now() - started), cleared: result.cleared, exploded: result.exploded, stepLimitReached: !result.cleared && !result.exploded && moves.length === maxSteps };
}

async function waitForReviewOrClose() {
  if (!reviewMs) return;
  const deadline = Date.now() + reviewMs;
  console.log(`运行结束：浏览器会保留最多 ${Math.ceil(reviewMs / 1000)} 秒；手动关闭浏览器即可立即结束。`);
  while (Date.now() < deadline) {
    await delay(Math.min(3_000, deadline - Date.now()));
    try {
      cli("eval", "() => document.readyState");
    } catch {
      console.log("检测到浏览器已手动关闭。");
      return;
    }
  }
}

if (mode === "jev" && !key) {
  throw new Error("TYPESAFE_API_KEY (or JEV_API_KEY) is required for a Jev run. Use --verify only for the non-AI bridge replay.");
}

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
const report = { mode, startedAt: runStartedAt.toISOString(), resultFile: `result/${transcriptPath.split(/[\\/]/).pop()}`, levels: [] };

try {
  if (!reuseSession) {
    openBrowser(`http://127.0.0.1:${port}/`);
    await waitForBrowser();
  } else {
    cli("resize", "1280", "820");
  }
  for (const level of levelsToPlay) {
    const result = await playLevel(level);
    report.levels.push(result);
    console.log(`${result.level}: ${result.cleared ? "cleared" : result.exploded ? "mine" : "stopped"} in ${result.elapsedMs} ms`);
  }
  await waitForReviewOrClose();
} finally {
  report.finishedAt = new Date().toISOString();
  await saveTranscript();
  await writeFile(join(artifacts, "run-report.json"), JSON.stringify(report, null, 2));
  server?.kill();
  try { cli("close"); } catch { /* browser is already gone */ }
}
