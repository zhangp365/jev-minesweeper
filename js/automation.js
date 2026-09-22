/*
 * Playwright / Jev bridge. The normal result only exposes what a player can
 * see. Passing { includeMines: true } is reserved for local test fixtures and
 * replay verification; a Jev player should always call the default form.
 */
(function () {
  function getGame() {
    if (!window.minesweeperGame || !window.minesweeperGame.grid) {
      throw new Error("Minesweeper board is not ready yet");
    }
    return window.minesweeperGame;
  }

  function cellState(tile, x, y, includeMines) {
    var revealed = tile.is_revealed();
    var state = tile.get_state();
    var cell = {
      x: x,
      y: y,
      revealed: revealed,
      flagged: state === "flag",
      state: state,
      adjacentMines: revealed && !tile.is_a_mine() ? tile.get_mine_count() : null
    };

    if (includeMines) cell.isMine = tile.is_a_mine();
    return cell;
  }

  window.getBoardState = function (options) {
    var game = getGame();
    var grid = game.grid;
    var includeMines = !!(options && options.includeMines);
    var cells = [];
    var revealedCount = 0;
    var flaggedCount = 0;
    var exploded = false;

    for (var y = 0; y < grid.height; y++) {
      var row = [];
      for (var x = 0; x < grid.width; x++) {
        var cell = cellState(grid.tiles[x][y], x, y, includeMines);
        if (cell.revealed) revealedCount++;
        if (cell.flagged) flaggedCount++;
        if (cell.state === "mine_red") exploded = true;
        row.push(cell);
      }
      cells.push(row);
    }

    return {
      width: grid.width,
      height: grid.height,
      mines: game.number_mines,
      revealedCount: revealedCount,
      flaggedCount: flaggedCount,
      exploded: exploded,
      cleared: !exploded && revealedCount === grid.width * grid.height - game.number_mines,
      cells: cells
    };
  };

  // A concise, coordinate-labelled view suitable for a Jev choice prompt.
  window.getVisibleBoardText = function () {
    var board = window.getBoardState();
    var rows = [];
    for (var y = 0; y < board.height; y++) {
      var row = [];
      for (var x = 0; x < board.width; x++) {
        var cell = board.cells[y][x];
        var value = cell.flagged ? "F" : (cell.revealed ? String(cell.adjacentMines) : "#");
        row.push("(" + x + "," + y + ")=" + value);
      }
      rows.push(row.join(" "));
    }
    return rows.join("\n");
  };

  // Compact player-visible representation used by the runner. It avoids
  // serializing every DOM cell through the CLI on every AI turn.
  window.getJevBoardState = function () {
    var board = window.getBoardState();
    var rows = [];
    for (var y = 0; y < board.height; y++) {
      var row = "";
      for (var x = 0; x < board.width; x++) {
        var cell = board.cells[y][x];
        row += cell.flagged ? "F" : (!cell.revealed ? "#" : (cell.adjacentMines === 0 ? "." : String(cell.adjacentMines)));
      }
      rows.push(row);
    }
    return {
      width: board.width,
      height: board.height,
      mines: board.mines,
      revealedCount: board.revealedCount,
      flaggedCount: board.flaggedCount,
      exploded: board.exploded,
      cleared: board.cleared,
      rows: rows
    };
  };
})();
