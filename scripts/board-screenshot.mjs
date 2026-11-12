// Self-contained so the runner can pass this function to Playwright CLI.
export async function screenshotBoard(page) {
  return page.evaluate(async () => {
    const table = document.getElementById("minesweeper_grid");
    const game = window.minesweeperGame;
    const rows = table ? Array.from(table.rows) : [];
    if (!game || rows.length !== game.height || rows.some((row) => row.cells.length !== game.width)
      || table.querySelectorAll("[data-cell]").length !== game.width * game.height) {
      throw new Error("Screenshot grid does not contain the complete Minesweeper board");
    }
    const tileWidth = parseFloat(rows[0].cells[0].style.width);
    const tileHeight = parseFloat(rows[0].cells[0].style.height);
    const width = game.width * tileWidth;
    const height = game.height * tileHeight;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error("Screenshot grid has invalid native dimensions");
    }

    // Snapshot only player-visible tile styles, never hidden mine data. Tiles
    // are sprite backgrounds, so drawing those same pixels onto a detached
    // canvas preserves their appearance without moving or resizing the page.
    const tiles = rows.flatMap((row, y) => Array.from(row.cells, (cell, x) => {
      const style = getComputedStyle(cell);
      const image = style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);
      return {
        x, y, color: style.backgroundColor, image: image ? image[1] : null,
        offsetX: parseFloat(style.backgroundPositionX), offsetY: parseFloat(style.backgroundPositionY)
      };
    }));
    let background = "#fff";
    for (let element = table; element; element = element.parentElement) {
      const color = getComputedStyle(element).backgroundColor;
      if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") { background = color; break; }
    }
    const images = new Map();
    await Promise.all([...new Set(tiles.map((tile) => tile.image).filter(Boolean))].map(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      images.set(url, image);
    }));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    for (const tile of tiles) {
      const x = tile.x * tileWidth, y = tile.y * tileHeight;
      context.save();
      context.beginPath();
      context.rect(x, y, tileWidth, tileHeight);
      context.clip();
      context.fillStyle = tile.color;
      context.fillRect(x, y, tileWidth, tileHeight);
      if (tile.image) context.drawImage(images.get(tile.image), x + tile.offsetX, y + tile.offsetY);
      context.restore();
    }
    return { width, height, columns: game.width, rows: game.height, data: canvas.toDataURL("image/png").split(",")[1] };
  });
}
