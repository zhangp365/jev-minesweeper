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
      : id === "openai" ? "OpenAI 兼容"
      : id;
  }

  window.jevPanel = {
    // Called once by the runner with the providers it can drive, e.g.
    // [{ id: "jev", label: "Jev（模型 jev-latest）" }, ...]. The select's
    // value is polled by the runner during the review window, so changing it
    // switches the provider used by the next 重跑.
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
        provider.textContent = "决策方：" + providerLabel(entry.provider) + "（模型 " + (entry.model || "未知") + "）";
        if (select && !select.hidden && entry.provider) select.value = entry.provider;
      }
      if (status) status.textContent = entry.status || "已收到模型返回。";
      var section = document.createElement("section");
      section.className = "jev_entry";
      var title = document.createElement("h3");
      title.textContent = entry.status || "模型调用";
      section.appendChild(title);
      appendJson(section, "本步耗时", entry.timings);
      appendJson(section, "请求（脱敏）", entry.request);
      appendJson(section, "返回", entry.response);
      log.appendChild(section);
      section.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  };

  $.ready(function () {
    var rerun = document.getElementById("button_rerun");
    if (rerun) rerun.addEventListener("click", function () { window.__jevRerun = true; });
  });
})();
