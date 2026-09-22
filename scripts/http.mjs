// Shared JSON POST transport for all decision providers: exponential-backoff
// retry for transient network failures (never for HTTP error statuses) and an
// optional proxy. Node's built-in fetch ignores HTTPS_PROXY, so a proxy needs
// the "undici" package's ProxyAgent; without it we degrade to direct fetch.
export async function createJsonPoster({ proxyUrl, attempts = 3, log = console.log }) {
  let send = fetch;
  if (proxyUrl) {
    try {
      const { fetch: undiciFetch, ProxyAgent } = await import("undici");
      const dispatcher = new ProxyAgent(proxyUrl);
      send = (url, init) => undiciFetch(url, { ...init, dispatcher });
      log(`LLM 请求走代理 ${proxyUrl}。`);
    } catch {
      log(`检测到代理 ${proxyUrl}，但未安装 undici，仍直连。可运行 "npm install undici" 启用代理。`);
    }
  }

  return async function postJson(url, { headers = {}, body }) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await send(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body)
        });
        let json = null;
        try { json = await response.json(); } catch { /* empty or non-JSON body */ }
        return { ok: response.ok, status: response.status, body: json };
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          const backoffMs = 1000 * 2 ** (attempt - 1) + Math.random() * 500;
          log(`LLM 请求连接失败（第 ${attempt} 次：${error.cause?.code || error.cause?.message || error.message}），${Math.round(backoffMs)} ms 后重试。`);
          await delay(backoffMs);
        }
      }
    }
    throw new Error(`连接 ${new URL(url).host} 连续 ${attempts} 次失败：${lastError.cause?.code || lastError.cause?.message || lastError.message}`);
  };
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
