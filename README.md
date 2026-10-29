# Niyusha

**A featherweight AI coding agent that lives in your terminal.**
Staged edits with diff review · a permissioned real shell · web search · autonomous mode · sessions · subagents · MCP — in **~670 KB unpacked (~200 KB download) with zero runtime dependencies**.

[![npm version](https://img.shields.io/npm/v/niyusha.svg)](https://www.npmjs.com/package/niyusha)
[![license](https://img.shields.io/npm/l/niyusha.svg)](https://www.npmjs.com/package/niyusha)

## Install & update

```bash
npm i -g niyusha          # install
niyusha                   # run it inside any project

npm i -g niyusha@latest   # update (or: npm update -g niyusha)
niyusha -v                # confirm the version
```

No build step, no daemon, no config files to write — it starts in milliseconds.

---

## Why Niyusha

Most tooling today wants a framework, a compiler, and a hundred packages. Niyusha doesn't.

- **Ridiculously light** — pure Node.js, **zero runtime dependencies**, tiny install footprint.
- **Instant** — no bundling, no service to boot; run it and you're working.
- **Lean by design** — a compact, hand-tuned system prompt + tools, protected by a **token-budget guard** so the per-request overhead can't quietly creep up. The in-app context meter shows **real provider token usage** (hybrid estimate when the provider doesn't report it).
- **Safe by default** — every file change is **staged first**; you approve a colored diff before anything touches disk.
- **Truly reversible** — `/undo` reverts applied files *and* real shell side effects, across restarts.
- **Delegates** — read-only **subagents** for broad exploration, or `build` subagents whose edits land in the same review queue.
- **Real, not sandboxed theatre** — it actually reads, edits, and runs commands in your workspace.
- **Local & private** — your code, sessions, and history stay on your machine (`~/.niyusha/`).

## Requirements

- **Node.js 18+** — that's the only prerequisite.

## Bring your own model 🔑

Niyusha is **model-agnostic**. You supply an **LLM API key** — **free or paid** — and pick a provider once:

```bash
/provider     # choose a provider
/key          # paste your API key
/model        # it auto-loads the available models from that provider
```

Prefer free? Several providers ship generous **free tiers**, and a **local Ollama** needs **no key at all**. Bring whatever you already have — cloud or local — and Niyusha adapts.

## Quick start

```bash
cd /path/to/your/project
niyusha
```

Then just talk:

```
explain how auth works in @/src/api/index.ts
add a dark mode toggle to the settings page and run the tests
run /init          # generates an AGENTS.md for this repo
search for the latest React release
```

Type `@` + `Tab` to reference files, attach images with `/img`, and run `/help` anytime.

## Built-in tools (and yes, there are a lot)

Niyusha comes with **28 tools** out of the box — no plugins to install:

- **Files** — `read_file` · `write_file` · `edit_file` · `rename_file` · `delete_file` · `list_directory` · `create_directory`
- **Search & explore** — `glob_files` · `grep_search` · `workspace_tree`
- **Execute** — `run_command` (real shell, permissioned) · `run_code`
- **Research** — `web_search` (works with no extra key), `browser_open` · `browser_content` (fetch a URL, no extra key) — browser first, then `web_search` fallback
- **Plan & remember** — `set_todos` · `resolve_issue` · `read_note` / `write_note` / `clear_note`
- **Extend** — `use_skill` · `save_skill` (distill a session into a reusable skill behind a diff review) · `task` (delegate to a **subagent**: `explore` read-only / `build` that stages edits for review) · `mcp_list` / `mcp_call` (connect any **MCP server**)

## Signature kits (khas Niyusha)

Start a brand-new site in Niyusha's own look — one command:

```bash
/kit web my-site     # scaffold a new site from the Niyusha web kit (staged for review)
```

- **Zero-dep, original** design tokens (color, type, motion) applied consistently.
- The AI **composes** fresh pages from the kit — not copied templates.
- Loaded **on demand** (no cost when you're not building a site); everything is **staged**.
- Prefer a bare start? Just say it — the kit is a default, never a lock-in.
- Optional, off by default: `/credit on` adds a small "Made with NTVGraph × Niyusha" footer.

## Conditional skills (khas Niyusha)

Niyusha ships **27 built-in specialist skills** — web, frontend, backend,
database, debugging, refactor, test, security, deploy, code-review, mobile,
packaging, ml-data, automation, performance, algorithm, ai-agent, ui-ux, devops,
data-eng, documentation, game, embedded, research, simulation, image-ocr, and
image-embed.

A compact index (`id — deskripsi`) is shown to the AI, which then picks and loads
only the relevant skill(s) via `use_skill` — **model-driven**, tanpa pencocokan
kata kunci yang rapuh.

- **Model decides** — AI membaca index lalu memuat skill yang cocok sebelum bekerja (semantik, bahasa apa pun). `/skill auto off` menyembunyikan index.
- **Explicit** — `use_skill '<id>'` (AI) atau `/skill use <id>` (kamu); `use_skill` tanpa nama menampilkan katalog.
- **Control & transparency** — `/skill ls` (daftar + status index) · `/skill auto on|off` · `/skill off <id>` / `/skill on <id>` · `/skill log` (apa yang dimuat, ~token).
- **Extensible** — cukup buat folder `bin/skills/<id>/` berisi `skill.json` (metadata: description, priority, token_budget) + `rules.md`; tanpa ubah kode.

### Simulation: app, software & browser behavior
`bin/sim.js` is a small **zero-dependency** behavioral harness — **not just for
games**. It drives headless Chrome via CDP for web apps, SaaS/browser flows, UI
regressions, and canvas games, plus ADB for Android apps.

The `simulation` skill teaches a general, evidence-first loop: define a scenario
→ launch/serve → send real input (`click`, `tap`, `key`, ADB) → observe (DOM,
console, metrics, screenshot, logcat) → assert → cleanup. Use it to simulate the
behavior of any target reachable from these surfaces, not only a game.

```bash
node bin/sim.js serve ./www --port 8765
node bin/sim.js web http://127.0.0.1:8765 --viewport 430x880 \
  --click "#start" --tap 215,700 --key Space \
  --metrics ".overlay,canvas" --shot tmp/shot.png
node bin/sim.js adb devices
node bin/sim.js adb shot tmp/android.png
```

## Common commands

| Command | Purpose |
| --- | --- |
| `/provider` `/key` `/model` | Configure the AI provider (auto-loads models) |
| `/diff` `/apply [n\|path]` `/reject` | Review and decide on the staging |
| `/undo` `/redo` | Roll back — or re-apply — the last change |
| `/auto [on\|off]` | Autonomous mode (auto-apply; dangerous actions still ask) |
| `/plan <task>` | Plan first, no file changes |
| `/init` | Generate an `AGENTS.md` for the project |
| `/mcp` | Manage MCP servers |
| `/rule` | Set project/session rules |
| `/skill [save\|use\|ls\|rm\|auto\|on\|off\|log]` | Conditional skills — registry, model-driven load, toggle, log |
| `/sessions` `/save` `/load` `/new` `/resume` | Sessions — autosave, restore, fresh start, portable JSON export/import |
| `/todo` | Task checklist, shown live in the sidebar |
| `/compact` | Compress context to keep going on long chats |
| `/usage` `/tokens` | Session token totals (input/output/total/requests) + live context meter |
| `/copy` `/find` `/theme` | Clipboard · chat search · themes |
| `/set icon <name>` | Chat/splash glyph: `spark` `star` `diamond` `hex` `orbit` `bolt` `dot` `none` |
| `/img` `/paste` | Attach an image · insert multi-line clipboard text |
| `/kit [web] <name>` | Scaffold a **new** site in Niyusha's signature style (staged for review) |
| `/credit [on\|off]` | Toggle a small "Made with NTVGraph × Niyusha" footer on kit sites (default off) |

See `/help` for the full list.

## Safety you can see

1. **Stage first** — writes/edits/deletes land in a virtual overlay; nothing is real until you `/apply`.
2. **Layered permissions** — shell commands and outside-workspace paths ask first (once / session / always); dangerous commands always confirm.
3. **Reversible** — `/undo` rolls back applied files *and* shell side effects, across restarts. `/redo` re-applies.
4. **Autonomous mode** (`/auto on`) only skips what can be recovered — destructive actions still stop for you.

## Sessions, memory & freedom

- Save and resume full conversations **with working state** — todos, staging, notes, background jobs.
- Track **cumulative session token usage** (`/usage` / `/tokens`, sidebar `Session`, footer `ses`); estimates are marked `≈`.
- Export/import sessions as portable JSON, even **across different projects**.
- Talks like you do: it replies in **your language**, whatever that is.

## Configuration & storage

All state is local, in `~/.niyusha/`:

- `config.json` — provider, API key, permissions, web search
- `state.json` — global history, skills, rules
- `ws_<key>.json` — per-workspace history, todos, sessions
- `undo/` — snapshots used by `/undo` across restarts
- `scratch/` — per-workspace notepad (secret-safe)

## Development

```bash
node bin/niyusha.js      # run the TUI from source
```

This package is the **TUI** product (the `bin/` folder). Zero runtime dependencies.

### Publishing a new version

```bash
# 1) bump "version" in package.json
npm publish --dry-run    # inspect the tarball (only bin/ + README + LICENSE)
npm publish              # requires `npm login`
npm view niyusha version # confirm it's live
```

## Links

- **npm:** https://www.npmjs.com/package/niyusha
- **License:** MIT

---

*Small on disk. Serious about getting work done.*

---

## What's new in v0.2.9

This one is about **seeing more and spending less**.

**A sharper interface**
- Redesigned reasoning panel that reads like a live thought stream instead of a box.
- Tables that wrap cleanly instead of slicing words, with quieter borders and headers.
- Cleaner user bubbles, a tighter input area, and a live context meter in the footer.
- **Zen mode** — `/zen` (or `Ctrl+Z`) strips the chrome so only you and the work remain.

**Token numbers you can trust**
- `/usage` now separates **billed** tokens from **raw** provider counts, so the number you see matches the number you pay for.
- Cache read/write tokens are tracked on every request.
- Cost shows `n/a` when a provider has no published rate — no invented estimates.

**Lean by default**
- A context guard prunes stale tool output and compacts memory *before* the window overflows.
- Compaction never splits a tool call from its result, so the history stays valid.
- Long sessions keep going instead of stalling at the limit.

**Undo that won't eat your disk**
- Shell snapshots are **content-addressed**: each file version is stored once and reused, so a command only costs the bytes it actually changes.
- Large files are skipped with an explicit **partial undo** notice, and restoring never deletes files Niyusha didn't create.
- Undo history is isolated per workspace — switching projects can no longer erase another project's snapshots.
- `/undo` and `/redo` also update the agent's context, so it never assumes a rolled-back edit is still live.

## What's new in v0.3.4

This one is about **deciding less, verifying more**, and keeping context cheap.

- Package size: `202.8 kB` (unpacked `683.3 kB`, 81 file) — `niyusha-0.3.4.tgz`.

**Cognitive runtime**
- The agent now runs on an explicit UNDERSTAND -> PLAN -> ACT -> VERIFY -> DECIDE loop instead of jumping straight to action.
- **Verify gate**: after any mutating tool, the agent must verify (read-back / diff / test) before claiming done.

**Context that stays cheap**
- Compaction is now aggressive and operational: keeps the *decision* memory (goal, key choices, failures, next steps) rather than raw history.
- Safe-point queue injection lets a queued user turn be added mid-run without waiting for the full run to finish.

**AI browser**
- Added `browser_open` + `browser_content` tools (fetch + HTML strip, purpose-built for the agent).
- Web fallback: if `web_search` is unavailable/fails/limited, the agent uses `browser_open` + `browser_content` or its own knowledge.

## What's new in v0.3.5

This one is about **a cleaner zen mode and stronger media support**.

- Package size: `212.1 kB` (unpacked `712.4 kB`, 87 files) — `niyusha-0.3.5.tgz`.

**Zen mode polish**
- Cleaner, distraction-free zen mode (`/zen` or `Ctrl+Z`): stripped chrome so only you and the work remain.

**Image support**
- Added `image_ocr` (Tesseract-backed OCR) and `image_embed` (hash-to-vector embedding) tools plus `image-ocr` / `image-embed` skills, so the agent can read and vectorize attached images.

**Browser content**
- Improved `browser_content`: link extraction now runs reliably from the fetched HTML (file-based parser, no SSL/Python fetch dependency), surfacing page links even when the network blocks Python's fetch.
