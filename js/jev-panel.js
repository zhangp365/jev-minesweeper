(function () {
  function appendJson(section, title, value) {
    var heading = document.createElement("h3");
    heading.textContent = title;
    var content = document.createElement("pre");
    content.textContent = JSON.stringify(value || {}, null, 2);
    section.appendChild(heading);
    section.appendChild(content);
  }

  function providerLabel(id) {
    return id === "jev" ? "Jev"
      : id === "openai" ? "OpenAI-compatible"
      : id;
  }

  window.jevPanel = {
    // Called once by the runner with the providers it can drive, e.g.
    // [{ id: "jev", label: "Jev (model jev-latest)" }, ...]. The select's
    // value is polled by the runner during the review window, so changing it
    // switches the provider used by the next replay.
    setProviders: function (options, activeId) {
      var select = document.getElementById("jev_provider_select");
      if (!select || !options || !options.length) return;
      select.innerHTML = "";
      options.forEach(function (option) {
        var item = document.createElement("option");
        item.value = option.id;
        item.textContent = option.label;
        select.appendChild(item);
      });
      select.value = activeId;
      select.hidden = false;
    },
    getSelectedProvider: function () {
      var select = document.getElementById("jev_provider_select");
      return select && !select.hidden ? select.value : null;
    },
    update: function (entry) {
      var status = document.getElementById("jev_status");
      var provider = document.getElementById("jev_provider_label");
      var select = document.getElementById("jev_provider_select");
      var log = document.getElementById("jev_log");
      if (!log) return;
      if (provider && entry.provider) {
        provider.textContent = "Provider: " + providerLabel(entry.provider) + " (model " + (entry.model || "unknown") + ")";
        if (select && !select.hidden && entry.provider) select.value = entry.provider;
      }
      if (status) status.textContent = entry.status || "Model response received.";
      var section = document.createElement("section");
      section.className = "jev_entry";
      var title = document.createElement("h3");
      title.textContent = entry.status || "Model call";
      section.appendChild(title);
      appendJson(section, "Step timings", entry.timings);
      appendJson(section, "Request (sanitized)", entry.request);
      appendJson(section, "Response", entry.response);
      log.appendChild(section);
      section.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  };

  function bindControls() {
    var rerun = document.getElementById("button_rerun");
    if (!rerun || rerun.__jevBound) return;
    rerun.__jevBound = true;
    rerun.addEventListener("click", function () {
      // Replay the currently selected level. Level buttons only select and
      // prepare an idle board; this is the action that starts the timer.
      if (typeof window.startSelectedGame === "function") {
        window.startSelectedGame();
      } else if (window.minesweeperGame && typeof window.minesweeperGame.restart === "function") {
        window.minesweeperGame.restart();
      }
      window.__jevRerun = true;
      var status = document.getElementById("jev_status");
      if (status) status.textContent = "Replay requested. Starting a new game...";
    });
  }

  $.ready(bindControls);
  if (document.readyState !== "loading") bindControls();
})();
