// Scale the fixed-size game table up to fill the play area (window height).
// The table is rebuilt on every new_game, so observe the container as well as
// window resizes. Pixelated rendering keeps the sprite art crisp when scaled.
(function () {
  function fitBoard() {
    var area = document.getElementById("play_area");
    if (!area) return;
    var table = area.querySelector("table");
    if (!table) return;
    var naturalWidth = table.offsetWidth;
    var naturalHeight = table.offsetHeight;
    if (!naturalWidth || !naturalHeight) return;
    var scale = Math.min(area.clientWidth / naturalWidth, area.clientHeight / naturalHeight);
    if (!isFinite(scale) || scale <= 0) return;
    table.style.transformOrigin = "center center";
    table.style.transform = "scale(" + scale + ")";
  }

  $.ready(function () {
    var area = document.getElementById("play_area");
    if (!area) return;
    window.addEventListener("resize", fitBoard);
    if (window.MutationObserver) {
      new MutationObserver(fitBoard).observe(area, { childList: true });
    }
    fitBoard();
  });
})();
