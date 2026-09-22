// Load and normalize the provider configuration (config/providers.yaml).
// Environment variables keep precedence over YAML so existing JEV_* setups
// keep working unchanged.
import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const DEFAULTS = {
  default_provider: "jev",
  jev: {
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    api_key: null
  },
  openai: {
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    api_key: null,
    api_key_env: "OPENAI_API_KEY",
    temperature: 0,
    json_mode: true
  },
  request: {
    attempts: 3,
    proxy: ""
  }
};

export const PROVIDER_NAMES = ["jev", "openai"];

export function loadLlmConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`缺少配置文件 ${configPath}：复制 config/providers.example.yaml 为 config/providers.yaml 并填写。`);
  }
  const raw = parseYaml(readFileSync(configPath, "utf8")) || {};
  const merged = {
    ...DEFAULTS,
    ...raw,
    jev: { ...DEFAULTS.jev, ...raw.jev },
    openai: { ...DEFAULTS.openai, ...raw.openai },
    request: { ...DEFAULTS.request, ...raw.request }
  };

  const proxyUrl = process.env.JEV_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy || merged.request.proxy || null;
  const attempts = Number(process.env.JEV_REQUEST_ATTEMPTS || merged.request.attempts || 3);

  return {
    defaultProvider: String(merged.default_provider || "jev").trim().toLowerCase(),
    jev: {
      endpoint: String(merged.jev.endpoint),
      model: String(merged.jev.model),
      apiKey: merged.jev.api_key || null
    },
    openai: {
      baseUrl: String(merged.openai.base_url).replace(/\/+$/, ""),
      model: String(merged.openai.model),
      apiKey: merged.openai.api_key || null,
      apiKeyEnv: String(merged.openai.api_key_env || "OPENAI_API_KEY"),
      temperature: Number(merged.openai.temperature ?? 0),
      jsonMode: merged.openai.json_mode !== false
    },
    request: { attempts, proxyUrl }
  };
}
