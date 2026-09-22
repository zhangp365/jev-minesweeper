# 扫雷 + Playwright CLI + Jev

这是 Windows XP 风格扫雷的 DOM 自动化示例。页面左侧是游戏，右侧会显示每一步发往 Jev 的脱敏请求、API 返回和主要耗时。API 密钥只存在于运行脚本的本机进程中，绝不会被写入页面或报告。

## 浏览器桥接

- `window.getBoardState()`：完整的玩家可见棋盘。未翻开的格子不包含地雷信息。
- `window.getVisibleBoardText()`：带坐标的可读文本棋盘。
- `window.getJevBoardState()`：供自动化循环使用的紧凑棋盘；`#` 表示未翻开、`F` 表示旗帜、`.` 表示已翻开的 0、`1`–`8` 为相邻地雷数。

仅供本地验证的 `window.getBoardState({ includeMines: true })` 才会返回 `isMine`，Jev 决策绝不会调用这个形式。

每个格子都有稳定选择器，例如 `td#cell-3-7`。自动化通过 `playwright-cli click` 操作真实页面，而不是截图或模板匹配。

游戏现在有完整的中盘认定：翻开全部安全格即胜利（自动插旗剩余的雷、计数器归零、显示墨镜脸并停表）；踩雷则显示失败脸并停表。只剩一个合法候选时，自动化直接本地点击，不再为此发送 Jev 请求（transcript 中该步 `source` 为 `single-candidate`）。

## 运行 Beginner

`JEV_API_KEY` 或 `TYPESAFE_API_KEY` 需要已设置在当前进程环境变量中。Windows 机器级变量也会在运行时读取，但不会输出。

```powershell
node scripts/play-all.mjs --jev --level beginner
```

默认每局最多执行 5 步：第 1 步是不用 Jev 的中心安全开局，后续最多 4 步由 Jev 选择，便于先核验调用链与成本。确认后再提高上限：

```powershell
$env:JEV_MAX_STEPS = "80"
node scripts/play-all.mjs --jev --level beginner
```

可用 `JEV_CANDIDATE_LIMIT` 控制每次交给 Jev 的候选数，默认是 12。候选仅由玩家可见数字做风险排序：确定安全格优先，其余按局部约束和全局地雷比例排序；Jev 只在这些合法候选中选择。`criteria` 中每个候选（以 `x,y` 为键）的值会列出其周围 8 格的数字（`(x,y)=数字` 形式），以及已确认是雷的邻格（已插旗 `F`，或由数字约束必然推出的雷）。

## 网络与重试

直连 `api.typesafe.ai` 在部分网络下会被随机重置（表现为 `fetch failed`、`UND_ERR_SOCKET` 或连接超时）。脚本对此有两层处理：

- **重试**：每次 Jev 请求默认最多尝试 3 次，退避间隔 1s/2s/4s 加随机抖动；HTTP 4xx/5xx 属于真实响应，不会重试。次数可用 `JEV_REQUEST_ATTEMPTS` 调整。
- **代理**：设置了 `JEV_PROXY` 或标准 `HTTPS_PROXY`/`HTTP_PROXY` 环境变量时，Jev 请求会走该代理（Node 内置 fetch 不会自动使用这些变量，脚本通过 `undici` 的 `ProxyAgent` 实现，项目 `package.json` 已声明该依赖，需先 `npm install`）。未安装 undici 或代理不可用时自动退回直连加重试。

无凭据的点击通路验证：

```powershell
node scripts/play-all.mjs --verify --level beginner
```

## 结果与录屏

运行后会写入 `artifacts/run-report.json`，其中包含每次落子的坐标、Jev 用量、模型名与分段耗时；同时在 `result/jev-时间戳.json` 保存每一步完整的脱敏请求、API 响应和耗时。API key 不会写入结果文件。脚本在 Windows 中会启动独立静态服务和可见的持久 Chrome，会话创建完成后才继续操作，因此不会再因 Node 等待浏览器输出句柄而卡在 `127.0.0.1:4173`。

全部等级完成后，浏览器会保留最多 60 秒，便于查看右侧每一步的请求和返回；直接手动关闭浏览器会立即结束脚本。可用 `JEV_REVIEW_MS` 修改等待时间（设为 `0` 则立即关闭）：

```powershell
$env:JEV_REVIEW_MS = "120000"
node scripts/play-all.mjs --jev --level beginner
```

如需系统录屏，请在 Chrome 窗口出现后用 Windows 游戏栏开始录制，结束后将 MP4 保存到 `artifacts/`。脚本不会抓取整个桌面，避免录入无关窗口内容。
