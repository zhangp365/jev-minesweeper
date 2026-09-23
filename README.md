# jev-minesweeper

English | [简体中文](./README.zh-CN.md)

An LLM-driven Minesweeper experiment: **Jev** or any **OpenAI-compatible model** plays through real Chrome DOM clicks, while the side panel shows every sanitized request and response in real time. Both providers receive the same decision instructions, board state, and candidate information; only the API request/output wrappers differ.

| Game start: safe center opening, decision panel on the right | Cleared: sunglasses face, mines auto-flagged, full request log |
| --- | --- |
| ![Game start](./artifacts/start.png) | ![Cleared](./artifacts/finish.png) |

## Quick start

```bash
npm install
npm install -g @playwright/cli
cp config/providers.example.yaml config/providers.yaml   # fill in openai base_url / model / api_key
node scripts/play-all.mjs --provider openai --level beginner
```

Requires Node.js 22.19+ (the `undici` dependency requirement), Google Chrome, and the global `@playwright/cli` package. The automation drives a real Chrome page through Playwright CLI `click`/`eval` commands.


## Commands

```bash
node scripts/play-all.mjs --provider jev --level beginner      # Jev
node scripts/play-all.mjs --provider openai --level beginner   # OpenAI-compatible model
node scripts/play-all.mjs --level beginner                     # use default_provider from the yaml
npm test                                                        # keyless smoke test for all three levels
node scripts/play-all.mjs --verify --level beginner            # keyless smoke test for one level
```

`--level` accepts `beginner` / `intermediate` / `expert`; omit it to play all three. `--verify` performs one known-safe real DOM click per level and does not call an LLM. A provider run is autonomous: safe center opening, auto-flagging of deduced mines, local click when a single candidate remains, until the game is cleared, a mine explodes, or the step limit is hit. A provider run is probabilistic and is not guaranteed to win every game.

On the page, selecting a level only highlights it and prepares an idle board; it does not start the timer. Click **Replay** to start the selected level. During the review wait, **Replay** starts another game at the currently selected level.

If a previous run was interrupted, the fixed Playwright session may still be open. The normal command now closes that stale session automatically; use `--reuse-session` only when intentionally continuing an existing browser session.

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
JEV_REVIEW_MS=0             # wait for Replay until the browser is closed; a positive value limits this wait
```

## Outputs
- `artifacts/run-report.json`: per-level provider, result (cleared / mine / stopped) and timings.
- `result/jev-<timestamp>.json`: the full sanitized request and response of every turn (never contains keys).

The `--verify` console result is reported as `verified (1 safe click)`; it is not a completed game result.

## Acknowledgments

The game code in this project was imported from [ziebelje/minesweeper](https://github.com/ziebelje/minesweeper) (by Jon Ziebell), with the LLM automation layer built on top. Thank you!
