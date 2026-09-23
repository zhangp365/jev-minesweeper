# 扫雷 + Playwright CLI + 决策模型（Jev / OpenAI 兼容）

这是 Windows XP 风格扫雷的 DOM 自动化示例。页面左侧是游戏，右侧会显示每一步发往决策模型的脱敏请求、API 返回和主要耗时。API 密钥只存在于运行脚本的本机进程中，绝不会被写入页面或报告。

决策提供方（provider）可切换，二者共享同一套候选排序与邻域摘要，返回同构的落子结果。决策提示词的核心（角色、推理规则、候选描述说明，见 `scripts/prompt.mjs` 的 `DECISION_INSTRUCTIONS`）对两个 provider 逐字一致，唯一的差异是 OpenAI 侧在其上附加输出要求（只输出 JSON 对象及字段格式）；Jev 的 choice schema 自身约束输出，无需附加：

- `jev`：Jev choice 接口（默认）。
- `openai`：任意 OpenAI 兼容的 chat/completions 接口（OpenAI、vLLM、one-api 等），提示词强制要求 JSON 返回，解析带健壮性兜底。

## 浏览器桥接

- `window.getBoardState()`：完整的玩家可见棋盘。未翻开的格子不包含地雷信息。
- `window.getVisibleBoardText()`：带坐标的可读文本棋盘。
- `window.getJevBoardState()`：供自动化循环使用的紧凑棋盘；`#` 表示未翻开、`F` 表示旗帜、`.` 表示已翻开的 0、`1`–`8` 为相邻地雷数。

仅供本地验证的 `window.getBoardState({ includeMines: true })` 才会返回 `isMine`，模型决策绝不会调用这个形式。

每个格子都有稳定选择器，例如 `td#cell-3-7`。自动化通过 `playwright-cli click` 操作真实页面，而不是截图或模板匹配。

游戏有完整的中盘认定：翻开全部安全格即胜利（自动插旗剩余的雷、计数器归零、显示墨镜脸并停表）；踩雷则显示失败脸并停表。只剩一个合法候选时，自动化直接本地点击，不再为此发送模型请求（transcript 中该步 `source` 为 `single-candidate`）。

## 配置：config/providers.yaml

```powershell
Copy-Item config\providers.example.yaml config\providers.yaml
# 编辑 config\providers.yaml，填 openai.api_key（或改用 api_key_env 指向环境变量）
npm install
```

该文件已被 `.gitignore` 忽略，避免密钥入库。可配置项：

- `default_provider`：`jev` 或 `openai`，命令行 `--provider` 优先级更高。
- `jev.endpoint` / `jev.model` / `jev.api_key`：密钥留空时依次读 `TYPESAFE_API_KEY`、`JEV_API_KEY`（含 Windows 机器级变量）。
- `openai.base_url` / `openai.model` / `openai.api_key` / `openai.temperature` / `openai.json_mode`：`json_mode` 关闭后请求不再携带 `response_format`，适配不支持该参数的兼容端点。
- `request.attempts` / `request.proxy`：网络重试与代理，`JEV_REQUEST_ATTEMPTS`、`JEV_PROXY`、`HTTPS_PROXY` 等环境变量优先。

## 运行

```powershell
node scripts/play-all.mjs --provider jev --level beginner      # 等价旧写法 --jev
node scripts/play-all.mjs --provider openai --level beginner   # OpenAI 兼容接口
node scripts/play-all.mjs --level beginner                     # 用 yaml 里的 default_provider
```

默认打完整局：第 1 步是不用模型请求的中心安全开局，其后每步都由模型选择，直到通关、踩雷或步数上限；调试新接口时可用 `JEV_MAX_STEPS` 限制模型请求数控制成本。候选数用 `JEV_CANDIDATE_LIMIT` 控制，默认 12：候选仅由玩家可见数字做风险排序，确定安全格优先；每个候选只附带客观事实描述——周围 8 格的数字（`(x,y)=数字` 形式）与已确认是雷的邻格（插旗 `F` 或由数字约束必然推出）——不带预计算的风险值或安全标记，安全性判断完全交给模型，Jev 放在 `criteria` 中，OpenAI 放在提示词的候选清单里，两边信息完全对等。

每步模型落子前，主循环会先用右键自动给由数字约束推出的确定雷插旗并重读棋盘（插旗可能满足更多数字约束，会循环到不再出现新的确定雷），因此模型总能基于最新棋盘和准确的剩余雷数推理；这些插旗记录在 transcript 的 `autoFlagged` 中。

候选合法性（只能选候选列表中的格子）与置信度下限（`JEV_MIN_CONFIDENCE`）在主流程统一校验，与 provider 无关。

## OpenAI 兼容接口的 JSON 健壮性

提示词明确要求只输出一个 JSON 对象（`{"choice":"x,y","confidence":...,"reason":...}`）。解析按以下顺序兜底：直接 `JSON.parse` → 剥离 Markdown 代码块 → 截取首个 `{...}` 片段 → 修复尾逗号与全角标点/弯引号后重试。choice 接受 `"x,y"`、`"（x, y）"`、`{"x":..,"y":..}` 等形态，非法候选会自动带着纠错提示重问一次，仍失败才终止运行。

## 网络与重试

直连 LLM 接口在部分网络下会被随机重置（表现为 `fetch failed`、`UND_ERR_SOCKET` 或连接超时）。脚本对此有两层处理，对所有 provider 生效：

- **重试**：每次请求默认最多尝试 3 次，退避间隔 1s/2s/4s 加随机抖动；HTTP 4xx/5xx 属于真实响应，不会重试。
- **代理**：设置了 `JEV_PROXY` 或标准 `HTTPS_PROXY`/`HTTP_PROXY` 环境变量时，请求走该代理（Node 内置 fetch 不会自动使用这些变量，脚本通过 `undici` 的 `ProxyAgent` 实现）。未安装 undici 或代理不可用时自动退回直连加重试。

无凭据的点击通路验证：

```powershell
node scripts/play-all.mjs --verify --level beginner
```

## 结果与录屏

运行后会写入 `artifacts/run-report.json`，其中包含每局使用的 provider、每次落子的坐标、模型用量与分段耗时；同时在 `result/jev-时间戳.json` 保存每一步完整的脱敏请求、API 响应和耗时。API key 不会写入结果文件。

全部等级完成后，浏览器会保留最多 60 秒，便于查看右侧每一步的请求和返回；直接手动关闭浏览器会立即结束脚本。可用 `JEV_REVIEW_MS` 修改等待时间（设为 `0` 则立即关闭）。

如需系统录屏，请在 Chrome 窗口出现后用 Windows 游戏栏开始录制，结束后将 MP4 保存到 `artifacts/`。脚本不会抓取整个桌面，避免录入无关窗口内容。
