rocket.extend($ = rocket.$, rocket);
var arcade = {};

arcade.minesweeper = function(play_area, face) {
  play_area.preventSelect();
  this.play_area = play_area;
}

arcade.minesweeper.prototype.play_area;
arcade.minesweeper.prototype.play_table;
arcade.minesweeper.prototype.grid;
arcade.minesweeper.prototype.grid_area;
arcade.minesweeper.prototype.header_td_mine_count;
arcade.minesweeper.prototype.header_td_timer;
arcade.minesweeper.prototype.width;
arcade.minesweeper.prototype.height;
arcade.minesweeper.prototype.number_mines;
arcade.minesweeper.prototype.mine_counter;
arcade.minesweeper.prototype.mouse = {"left": false, "right": false};

arcade.minesweeper.prototype.build = function(width, height) {

	this.play_table = $.createElement("table").setAttribute({"cellspacing": 0, "cellpadding": 0}).style({"border": "1px solid black", "width": width*16 + 22, "-moz-box-shadow": "3px 3px 6px 1px #999", "-webkit-box-shadow": "3px 3px 6px 1px #999", "box-shadow": "3px 3px 6px 1px #999", "margin": "auto"});
	var tbody = $.createElement("tbody");

	// 5 Rows
	var tr_border_top = $.createElement("tr");
	var tr_header = $.createElement("tr");
	var tr_border_middle = $.createElement("tr");
	var tr_border_bottom = $.createElement("tr");

	// Cells
	var td_border_top_left = $.createElement("td").style({"width": 10, "height": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "0px -81px"});
	var td_border_top_right = $.createElement("td").style({"width": 10, "height": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-26px -81px"});
	tr_border_top.appendChild(td_border_top_left);
  for(var i = 0; i < width; i++) {
    tr_border_top.appendChild($.createElement("td").style({"width": 16, "height": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-10px -81px"}));
  }
	tr_border_top.appendChild(td_border_top_right);
  tbody.appendChild(tr_border_top);

	var td_header_left = $.createElement("td").style({"width": 10, "height": 32, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-36px -81px"});
	var td_header_center = $.createElement("td").style({"background-color": "#c0c0c0"}).setAttribute({"colspan": width});
	var td_header_right = $.createElement("td").style({"width": 10, "height": 32, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-36px -81px"});
  tr_header.appendChild(td_header_left);
  tr_header.appendChild(td_header_center);
  tr_header.appendChild(td_header_right);
  tbody.appendChild(tr_header);

	var td_border_middle_left = $.createElement("td").style({"width": 10, "height": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-0px -91px"});
	var td_border_middle_right = $.createElement("td").style({"width": 10, "height": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-26px -91px"});
  tr_border_middle.appendChild(td_border_middle_left);
  for(var i = 0; i < width; i++) {
    tr_border_middle.appendChild($.createElement("td").style({"background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-10px -81px"}));
  }
  tr_border_middle.appendChild(td_border_middle_right);
  tbody.appendChild(tr_border_middle);

  var tr_grid_area = $.createElement("tr");
  tr_grid_area.appendChild($.createElement("td").style({"height": 16, "width": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-36px -81px"}));
  this.grid_area = $.createElement("td").setAttribute({"colspan": width, "rowspan": height});
  tr_grid_area.appendChild(this.grid_area);
  tr_grid_area.appendChild($.createElement("td").style({"height": 16, "width": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-36px -81px"}));
  tbody.appendChild(tr_grid_area);
  for(var i = 0; i < height-1; i++) {
    tr_grid_area = $.createElement("tr");
    tr_grid_area.appendChild($.createElement("td").style({"height": 16, "width": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-36px -81px"}));
    tr_grid_area.appendChild($.createElement("td").style({"height": 16, "width": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-36px -81px"}));
    tbody.appendChild(tr_grid_area);
  }

	var td_border_bottom_left = $.createElement("td").style({"width": 10, "height": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "0px -101px"});
	var td_border_bottom_right = $.createElement("td").style({"width": 10, "height": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-26px -101px"});
	tr_border_bottom.appendChild(td_border_bottom_left);
  for(var i = 0; i < width; i++) {
    tr_border_bottom.appendChild($.createElement("td").style({"width": 16, "height": 10, "background-image": "url('image/sprite.png')", "background-repeat": "no-repeat", "background-position": "-10px -101px"}));
  }
	tr_border_bottom.appendChild(td_border_bottom_right);
  tbody.appendChild(tr_border_bottom);

  this.play_table.appendChild(tbody);
  this.play_area.appendChild(this.play_table);

  // Header
  var header_table = $.createElement("table").setAttribute({"cellpadding": 0, "cellspacing": 0}).style({"width": "100%"});
  var header_tbody = $.createElement("tbody");
  var header_tr = $.createElement("tr");
  this.header_td_mine_count = $.createElement("td").style({"width": 53, "text-align": "center"});
  this.header_td_face = $.createElement("td").style({"text-align": "center"});
  this.header_td_timer = $.createElement("td").style({"width": 53, "text-align": "center"});
  header_tr.appendChild(this.header_td_mine_count);
  header_tr.appendChild(this.header_td_face);
  header_tr.appendChild(this.header_td_timer);
  header_tbody.appendChild(header_tr);
  header_table.appendChild(header_tbody);
  td_header_center.appendChild(header_table);
}

arcade.minesweeper.prototype.new_game = function(width, height, number_mines, start) {
  var self = this;

  // Level selection prepares an idle board. Only Replay (or the face) starts
  // the timer and begins a game.
  var shouldStart = start !== false;
  this.stop_timer();

  this.width = width;
  this.height = height;
  this.number_mines = number_mines;

  this.play_area.innerHTML("");

  this.build(width, height);

  var face = new arcade.minesweeper.face(this, this.header_td_face);

  this.play_table.removeEventListener("mousedown,mouseup").style({"cursor": "default", "border": "1px solid #444"});
  this.play_table
    .addEventListener("mousedown", function(e) {
      if(e.target === face.get_element()) return false;
      if(e.which === 1) face.set_state("scared");
    })
    .addEventListener("mouseup", function(e) {
      face.set_state("smile");
    });

  this.mine_counter = new arcade.minesweeper.ssd(this.header_td_mine_count, number_mines)
  this.timer = new arcade.minesweeper.ssd(this.header_td_timer, 0);

	this.grid = new arcade.minesweeper.grid(this, this.grid_area, width, height, face);
	this.grid.generate(number_mines);

  if (shouldStart) this.start_timer();
}
arcade.minesweeper.prototype.restart = function() {
  this.new_game(this.width, this.height, this.number_mines, true);
}
arcade.minesweeper.prototype.start_timer = function() {
  if(this.timer_interval || !this.timer) return;
  var timer = this.timer;
  // Show the running state immediately; waiting for the first one-second
  // interval made the first click appear unresponsive.
  timer.increment();
  this.timer_interval = setInterval(function() { timer.increment(); }, 1000);
}
arcade.minesweeper.prototype.stop_timer = function() {
  if(this.timer_interval) {
    clearInterval(this.timer_interval);
    this.timer_interval = null;
  }
}

$.ready(function() {
  var minesweeper = new arcade.minesweeper($("#play_area"));
  // Kept public for the automation bridge. Normal gameplay does not use it.
  window.minesweeperGame = minesweeper;
  var levels = {
    beginner: { width: 9, height: 9, mines: 10 },
    intermediate: { width: 16, height: 16, mines: 40 },
    expert: { width: 30, height: 16, mines: 99 }
  };
  var selectedLevel = "beginner";

  function selectLevel(levelId) {
    var level = levels[levelId];
    if (!level) return false;
    selectedLevel = levelId;
    window.__jevSelectedLevel = levelId;
    Object.keys(levels).forEach(function(id) {
      var button = $("#button_" + id);
      button[0].setAttribute("aria-pressed", id === levelId ? "true" : "false");
    });
    minesweeper.new_game(level.width, level.height, level.mines, false);
    return true;
  }

  window.getSelectedLevel = function() { return selectedLevel; };
  window.startSelectedGame = function() {
    minesweeper.restart();
    return selectedLevel;
  };

  Object.keys(levels).forEach(function(levelId) {
    $("#button_" + levelId).addEventListener("click", function() {
      selectLevel(levelId);
    });
  });
  selectLevel(selectedLevel);

  $(document)
    .addEventListener("mousedown", function(e) {
      // Playwright's synthetic mouse events set `button`; older browsers set
      // `which`. Supporting both keeps normal mouse play unchanged and makes
      // the DOM board safely automatable through real click events.
      var left_button = e.which == 1 || e.button === 0;
      var right_button = e.which == 3 || e.button === 2;
      if(left_button) minesweeper.mouse.left = true;
      else if(right_button) minesweeper.mouse.right = true;
      if(e.target.nodeName !== "TD") return false;

      var tile = minesweeper.grid.get_tile_from_td(e.target);
      if(!tile) return false;

      // On right click, mark the tile if the right mouse is the only button down
      if(minesweeper.mouse.right && !minesweeper.mouse.left) {
        var state = tile.mark();
        if(state === "flag") minesweeper.mine_counter.decrement();
        else if(state === "question") minesweeper.mine_counter.increment();
      }

      // On left click OR if I have both mouse buttons down
      if(minesweeper.mouse.left || (minesweeper.mouse.right && minesweeper.mouse.left)) {
        var tiles_to_highlight = [];
        tiles_to_highlight.push(minesweeper.grid.get_tile_from_td(e.target));

        // If I have both mouse buttons down, add the surrounding tiles to the highlight array
        if(minesweeper.mouse.left && minesweeper.mouse.right) {
          var coordinates = minesweeper.grid.get_coordinates_from_td(e.target);
          var surrounding_tiles = minesweeper.grid.get_surrounding_tiles(coordinates.x, coordinates.y);
          tiles_to_highlight = tiles_to_highlight.concat(surrounding_tiles);
        }

        // Highlight the tiles
        // console.log(tiles_to_highlight);
        for(var i in tiles_to_highlight) {
          if(tiles_to_highlight[i].highlight()) {
            minesweeper.grid.highlighted_tiles.push(tiles_to_highlight[i]);
          }
        }
      }
    })
    .addEventListener("mouseup", function(e) {
      var left_button = e.which == 1 || e.button === 0;
      var right_button = e.which == 3 || e.button === 2;
      if(e.target.nodeName !== "TD") {
        if(left_button) minesweeper.mouse.left = false;
        else if(right_button) minesweeper.mouse.right = false;
        return false;
      }
      // If I am releasing the left mouse button OR if both mouse buttons were down and I released either one of them
      if(minesweeper.mouse.left || (minesweeper.mouse.left && minesweeper.mouse.right)) {
        var click_coordinates = minesweeper.grid.get_coordinates_from_td(e.target);

        if(click_coordinates.x === -1 || click_coordinates.y === -1) {
          if(left_button) minesweeper.mouse.left = false;
          else if(right_button) minesweeper.mouse.right = false;
          return false;
        }

        // If I'm trying the quick reveal, do a couple of checks to make sure that all the mines are marked or don't reveal.
        if(minesweeper.mouse.left && minesweeper.mouse.right) {

          // Get the number of flagged tiles
          var flag_count = 0;
          for(var i in minesweeper.grid.highlighted_tiles) {
            if(minesweeper.grid.highlighted_tiles[i].get_state() === "flag") flag_count++;
          }

          // Compare. If all the mines are marked, reveal each of the surrounding tiles
          if(flag_count == minesweeper.grid.tiles[click_coordinates.x][click_coordinates.y].get_mine_count() && minesweeper.grid.tiles[click_coordinates.x][click_coordinates.y].is_revealed() ) {
            for(var i in minesweeper.grid.highlighted_tiles) {
              var coordinates = minesweeper.grid.get_coordinates_from_td(minesweeper.grid.highlighted_tiles[i].get_element());
              minesweeper.grid.reveal_area(coordinates.x, coordinates.y);
            }
          }
          else { // If not all of the tiles are marked and we're not revealing, unhighlight all of the tiles.
            for(var i in minesweeper.grid.highlighted_tiles) {
              minesweeper.grid.highlighted_tiles[i].unhighlight();
            }
          }

        }
        else { // Single tile reveals are simple
          minesweeper.grid.reveal_area(click_coordinates.x, click_coordinates.y);
        }

        // Clear highlighted tile array
        minesweeper.grid.highlighted_tiles = [];
      }
      if(left_button) minesweeper.mouse.left = false;
      else if(right_button) minesweeper.mouse.right = false;
    })
    .addEventListener("keydown", function() {

    });
});
