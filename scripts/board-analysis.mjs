// Pure board analysis shared by every decision provider: candidate ranking,
// forced-mine deduction and the per-candidate neighbourhood summary.

export function surroundingCells(board, x, y) {
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

// Per-candidate criteria text: which of the 8 neighbours hold a number, given
// as position=count, plus every neighbour confirmed to be a mine (flagged, or
// forced by a satisfied number constraint).
export function neighborSummary(board, x, y, knownMines) {
  const numbers = [];
  const mines = [];
  surroundingCells(board, x, y).forEach((cell) => {
    if (/[1-8]/.test(cell.value)) numbers.push(`(${cell.x},${cell.y})=${cell.value}`);
    else if (cell.value === "F" || knownMines.has(`${cell.x},${cell.y}`)) mines.push(`(${cell.x},${cell.y})`);
  });
  return `numbers: ${numbers.join(" ") || "none"}; confirmed mines: ${mines.join(" ") || "none"}`;
}

// Full candidate description shared by every provider: neighbourhood facts
// plus the heuristic risk estimated from the visible number constraints, so
// models can compare candidates without redoing the arithmetic.
export function describeCandidate(board, cell, knownMines) {
  const parts = [neighborSummary(board, cell.x, cell.y, knownMines), `risk≈${cell.risk}`];
  if (cell.forcedSafe) parts.push("PROVEN SAFE");
  return parts.join("; ");
}

// Rank covered cells into a focused candidate list and deduce the mines that
// are forced by satisfied number constraints. Uses only player-visible state.
export function rankedCandidates(board, candidateLimit) {
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

  // A focused local set first: covered cells next to the smallest revealed
  // numbers are the most useful places for deterministic deduction.
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
