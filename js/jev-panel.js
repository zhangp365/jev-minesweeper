(function () {
  function appendJson(section, title, value) {
    var heading = document.createElement("h3");
    heading.textContent = title;
    var content = document.createElement("pre");
    content.textContent = JSON.stringify(value || {}, null, 2);
    section.appendChild(heading);
    section.appendChild(content);
  }

  window.jevPanel = {
    update: function (entry) {
      var status = document.getElementById("jev_status");
      var provider = document.getElementById("jev_provider");
      var log = document.getElementById("jev_log");
      if (!log) return;
      if (provider && entry.provider) {
        var label = entry.provider === "jev" ? "Jev"
          : entry.provider === "openai" ? "OpenAI 兼容"
          : entry.provider;
        provider.textContent = "决策方：" + label + "（模型 " + (entry.model || "未知") + "）";
      }
      if (status) status.textContent = entry.status || "已收到模型返回。";

      var section = document.createElement("section");
      section.className = "jev_entry";
      var title = document.createElement("h3");
      title.textContent = entry.status || "Jev 调用";
      section.appendChild(title);
      appendJson(section, "本步耗时", entry.timings);
      appendJson(section, "请求（脱敏）", entry.request);
      appendJson(section, "返回", entry.response);
      log.appendChild(section);
      section.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  };
})();
