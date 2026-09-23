# jev-minesweeper

English | [简体中文](./README.zh-CN.md)

Minesweeper played by **Jev** or any **OpenAI-compatible model** through real DOM clicks, with a side panel showing every request and response in real time. Both providers receive the exact same prompt and candidate info — only the output format requirement differs — for a fair comparison.

| Game start: safe center opening, decision panel on the right | Cleared: sunglasses face, mines auto-flagged, full request log |
| --- | --- |
| ![Game start](./artifacts/start.png) | ![Cleared](./artifacts/finish.png) |

## Quick start

```bash
npm install
cp config/providers.example.yaml config/providers.yaml   # fill in openai base_url / model / api_key
node scripts/play-all.mjs --provider openai --level beginner
```

Requires Node 18+ and a global `@playwright/cli` install (the automation drives a real Chrome page through its `click`/`eval`).

## Commands

```bash
node scripts/play-all.mjs --provider jev --level beginner      # Jev
node scripts/play-all.mjs --provider openai --level beginner   # OpenAI-compatible model
node scripts/play-all.mjs --level beginner                     # use default_provider from the yaml
node scripts/play-all.mjs --verify --level beginner            # keyless smoke test of the click path
```

`--level` accepts `beginner` / `intermediate` / `expert`; omit it to play all three. A game runs fully autonomously: safe center opening, auto-flagging of deduced mines, local click when a single candidate remains, until the game is cleared, a mine explodes, or the step limit is hit.

## Configuration — config/providers.yaml

| Key | Meaning |
| --- | --- |
| `default_provider` | `jev` or `openai`; the `--provider` flag wins |
| `jev.endpoint` / `model` / `api_key` | With an empty key, the env vars `TYPESAFE_API_KEY` and `JEV_API_KEY` are used |
| `openai.base_url` / `model` / `api_key` | Any OpenAI-compatible endpoint; `api_key` may alternatively point at an env var via `api_key_env` |
| `openai.temperature` / `json_mode` | Default 0 / true (`json_mode: false` for endpoints without `response_format` support) |
| `request.attempts` / `proxy` | Network retries and proxy; `JEV_REQUEST_ATTEMPTS`, `JEV_PROXY`, `HTTPS_PROXY` env vars take precedence |

## Environment variables

```bash
JEV_MAX_STEPS=800            # model turn cap; by default a game is played to completion
JEV_MIN_CONFIDENCE=0.2      # abort below this confidence
JEV_CANDIDATE_LIMIT=12      # candidates offered per turn
JEV_REVIEW_MS=60000         # how long the browser stays open after a run; 0 closes immediately
```

## Outputs
- `artifacts/run-report.json`: per-level provider, result (cleared / mine / stopped) and timings.
- `result/jev-<timestamp>.json`: the full sanitized request and response of every turn (never contains keys).

## Acknowledgments

The game code in this project was imported from [ziebelje/minesweeper](https://github.com/ziebelje/minesweeper) (by Jon Ziebell), with the LLM automation layer built on top. Thank you!
