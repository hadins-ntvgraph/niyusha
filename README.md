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
- **Time-aware** — each request includes the machine's current local date, time, and timezone; time-sensitive facts should still be verified with web search.
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

Niyusha comes with **32 tools** out of the box:

- **Files** — `read_file` · `read_document` · `write_file` · `edit_file` · `rename_file` · `delete_file` · `list_directory` · `create_directory`
- **Search & explore** — `glob_files` · `grep_search` · `workspace_tree`
- **Execute** — `run_command` (real shell, permissioned) · `run_code`
- **Research** — `web_search` (works with no extra key), `browser_open` · `browser_content` (fetch a URL, no extra key) — browser first, then `web_search` fallback
- **Visual context** — `read_visual_evidence` exposes browser DOM/accessibility labels, text, normalized geometry, and measured candidates as text any model can assess; `inspect_image` optionally sends the screenshot to multimodal providers.
- **Plan & remember** — `set_todos` · `resolve_issue` · `read_note` / `write_note` / `clear_note`
- **Extend** — `use_skill` · `save_skill` (distill a session into a reusable skill behind a diff review) · `task` (delegate to a **subagent**: `explore` read-only / `build` that stages edits for review) · `mcp_list` / `mcp_call` (connect any **MCP server**)

`read_document` extracts DOCX/XLSX with Node.js built-ins, without adding packages.
It reads text-based PDFs through the optional system utility `pdftotext`
(Poppler); if unavailable, Niyusha reports that clearly and asks before suggesting
installation. Scanned PDFs and legacy `.doc`/`.xls` files are not supported by
this reader. The `document-reading` skill supplies format guidance only when
relevant, keeping its detailed instructions out of the base prompt.

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

Niyusha ships **28 built-in specialist skills** — web, frontend, backend,
database, debugging, refactor, test, security, deploy, code-review, mobile,
packaging, ml-data, automation, performance, algorithm, ai-agent, ui-ux, devops,
data-eng, documentation, game, embedded, research, simulation, image-ocr,
image-embed, and document-reading.

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
Web assertions can save failure evidence with `--shot-on-failure`; the AI can then
save a machine-readable DOM Visual Context report with `--evidence`. The
`read_visual_evidence` tool makes measured structure available to text-only models.
This first version is browser-DOM/geometric evidence—not pixel segmentation, vector
recognition, or proof that all visual defects have been detected. `inspect_image`
remains an optional extra for providers that accept image input.
See [`VISUAL_CONTEXT.md`](VISUAL_CONTEXT.md) for the v1 evidence schema and limits.

```bash
node bin/sim.js serve ./www --port 8765
node bin/sim.js web http://127.0.0.1:8765 --viewport 430x880 \
  --click "#start" --tap 215,700 --key Space \
  --metrics ".overlay,canvas" --assert "Boolean(document.querySelector('canvas'))" \
  --shot tmp/shot.png --shot-on-failure tmp/failure.png --evidence tmp/visual-context.json
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
| `/relax` · `Ctrl+R` | Toggle Relax Mode: a minimal, monochrome chat view (sidebar included) |
| `/set icon <name>` | Chat/splash glyph: `spark` `star` `diamond` `hex` `orbit` `bolt` `dot` `none` |
| `/img` `/paste` | Attach an image · insert multi-line clipboard text |
| `/kit [web] <name>` | Scaffold a **new** site in Niyusha's signature style (staged for review) |
| `/credit [on\|off]` | Toggle a small "Made with NTVGraph × Niyusha" footer on kit sites (default off) |

See `/help` for the full list.

## Safety you can see

1. **Stage first** — writes/edits/deletes land in a virtual overlay; nothing is real until you `/apply`.
2. **Layered permissions** — commands allowed by the permission policy can run without prompts; unknown commands and outside-workspace paths ask first. Prompts show the exact command, shell, working directory, execution mode, and timeout. Risky commands always ask again and cannot be allowlisted; MCP prompts show the arguments being sent and whether trust covers all tools on that server for this session or future sessions.
3. **Reversible** — `/undo` restores workspace files changed by shell commands and removes files created during the command, across restarts. If the required undo snapshot cannot be created, a mutating shell command is blocked. Snapshots can be partial at the configured size limits; Niyusha reports skipped files after the command and when undoing. External effects (for example database writes, network changes, or background-process writes after launch) are not reversible by workspace snapshots. `/redo` re-applies staged file changes.
4. **Autonomous mode** (`/auto on`) only skips what can be recovered — destructive actions still stop for you.

## Sessions, memory & freedom

- Save and resume full conversations **with working state** — todos, staging, notes, background jobs.
- Track **cumulative session token usage** (`/usage` / `/tokens`, sidebar `Session`, footer `ses`); estimates are marked `≈`.
- Export/import sessions as portable JSON, even **across different projects**.
- Talks like you do: it replies in **your language**, whatever that is.

## Context Intelligence (DIS-URICH) 🧠

**DIS-URICH** (Dynamic Information Structuring – Unified Representation for Intelligent 
Context Handling) is Niyusha's context-management engine. It combines deterministic local 
memory handling with the configured model; it does not replace the model's reasoning.

Unlike traditional compaction that simply summarizes and truncates history, DIS-URICH:

- **Semantic Atomization** — Breaks conversations into structured information units (atoms) with metadata, relationships, and provenance
- **Two-Tier Memory** — Maintains both compressed active memory and full original archive for fallback retrieval
- **State Ledger** — Tracks goal changes and explicitly scoped decisions (for example, `Keputusan [api]: Pertahankan endpoint lama`); newer decisions supersede older ones only within the same scope
- **Temporal & Conflict Resolution** — Marks supported decision history as active or superseded; unscoped prose is not silently treated as a replacement
- **Retrieval Before Assumption** — Ranks active memory alongside archived facts, including when active memory already has partial matches
- **Coding Context Integration** — Extracts file/function/class references, task state, and design decisions; relationship analysis remains heuristic

URich manages context deterministically where possible and retains the original archive for retrieval. Quality and token use depend on the task, model, and provider; benchmark results are still being evaluated, so no general savings or quality guarantee is implied.

Default compaction mode is now `urich`. Use `/compact mode legacy` to revert to traditional compaction.

## Configuration & storage

All state is local, in `~/.niyusha/`:

- `config.json` — provider, API key, permissions, web search
- `state.json` — global history, skills, rules
- `ws_<key>.json` — per-workspace history, todos, sessions
- `undo/` — snapshots used by `/undo` across restarts
- `scratch/` — per-workspace notepad (secret-safe)

### Compaction (DIS-URICH default)

Context compaction uses DIS-URICH by default for token optimization and better
context preservation. The `legacy` mode remains available via
`/compact mode legacy` for backward compatibility. Set `compactionMode`
in `~/.niyusha/config.json` to `legacy`, `shadow`, `safe`, `experimental`,
or `urich` to select a mode. Use `off` as a kill switch. Archive is isolated
per workspace and session, written atomically, and compaction is aborted if
the archive fails. Run `node scripts/test-compaction.js` to verify this mode.
When running in TUI, use `/compact mode <mode>`, `/compact auto on|off`,
`/compact stats`, and `/compact rollback` to change mode, test automatic
triggers, view before/after telemetry, or restore the last context checkpoint.
Auto-compaction is enabled by default.

## Setup & Installation

### Prerequisites
- Node.js >= 18
- npm or yarn
- (Optional) Chrome/Edge for web simulation
- (Optional) Android SDK for ADB testing

### Installation
```bash
# Clone repository
git clone https://github.com/hadins-ntvgraph/niyusha.git
cd niyusha/tui

# Install dependencies (zero runtime deps, only dev deps)
npm install

# Run from source
node bin/niyusha.js

# Or install globally
npm link
niyusha
```

### First Run
1. Run `niyusha` to start the TUI
2. Configure your LLM provider: `/set provider openrouter`
3. Set your API key: `/set key <your-api-key>`
4. Choose a model: `/set model openai/gpt-4o-mini`
5. Start coding!

## Configuration Reference

### Config File Location
`~/.niyusha/config.json`

### Key Settings
```json
{
  "provider": "openrouter",
  "model": "openai/gpt-4o-mini",
  "compactionMode": "urich",
  "compactionAuto": true,
  "compactionArchiveBeforeCompact": true,
  "contextEngineMemoryChars": 1400,
  "permissions": {
    "shell": "ask",
    "fileWrite": "ask",
    "fileRead": "allow"
  },
  "theme": "dark-blue",
  "sound": false,
  "sidebarWidth": 0
}
```

### Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key | - |
| `MISTRAL_API_KEY` | Mistral API key | - |
| `NIYUSHA_ASCII` | Force ASCII UI | auto |
| `NIYUSHA_TRUECOLOR` | Enable truecolor | auto |
| `CHROME_PATH` | Path to Chrome/Edge | auto-detect |

## Troubleshooting

### Common Issues

**"Module not found" error**
```bash
# Ensure you're in the correct directory
cd tui
node bin/niyusha.js
```

**"Permission denied" on shell commands**
- Check your permissions in `~/.niyusha/config.json`
- Use `/permissions` to view current settings
- Risky commands always require confirmation

**"Context too large" errors**
- Reduce `contextEngineMemoryChars` in config
- Use `/compact` to manually compact history
- Switch to `legacy` mode: `/compact mode legacy`

**"Chrome not found" for web simulation**
- Set `CHROME_PATH` environment variable
- Or install Chrome/Edge
- Web simulation is optional for core functionality

### Debug Mode
```bash
# Enable verbose logging
NIYUSHA_DEBUG=1 node bin/niyusha.js

# Check logs
cat ~/.niyusha/logs/*.log
```

## API Reference

### Core Modules

#### `bin/ai.js` - AI Agent
```javascript
const { Agent } = require('./ai');

const agent = new Agent(config);
await agent.run({ message: 'Hello', context: {} });
```

#### `bin/context-engine.js` - DIS-URICH
```javascript
const { ContextEngine } = require('./context-engine');

const engine = new ContextEngine({ config, workspace, sessionId });
const compressed = engine.compress({ history, summary, state });
const result = engine.retrieve(query, { limit: 8 });
```

#### `bin/config.js` - Configuration
```javascript
const { loadConfig, saveConfig, setProvider } = require('./config');

const config = loadConfig();
saveConfig({ compactionMode: 'urich' });
```

#### `bin/sim.js` - Simulation
```javascript
const { openWeb, startStaticServer } = require('./sim');

const result = await openWeb({ url, width: 430, height: 880 });
const server = await startStaticServer('./dist');
```

### Commands Reference

#### Slash Commands
| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/compact` | Compact conversation history |
| `/compact mode <mode>` | Change compaction mode |
| `/compact auto` | Test auto-compaction |
| `/compact stats` | Show compaction statistics |
| `/compact rollback` | Restore last checkpoint |
| `/set provider <name>` | Set LLM provider |
| `/set key <key>` | Set API key |
| `/set model <model>` | Set model |
| `/permissions` | View permissions |
| `/usage` | Show token usage |
| `/tokens` | Alias for /usage |
| `/relax` | Toggle Relax Mode |
| `/undo` | Undo last file changes |
| `/sessions` | List saved sessions |
| `/load <id>` | Load a session |

#### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+R` | Toggle Relax Mode |
| `Ctrl+K` | Open command palette |
| `Ctrl+C` | Cancel current operation |
| `Ctrl+L` | Clear screen |
| `Tab` | Autocomplete |
| `Enter` | Submit input |
| `Shift+Enter` | New line in input |

## Development

```bash
node bin/niyusha.js      # run the TUI from source
npm test                 # run all tests
npm run test:sim         # run simulation tests
npm run test:context     # run context engine tests
npm run lint             # run code quality checks
npm run docs             # generate API documentation
```

This package is the **TUI** product (the `bin/` folder). Zero runtime dependencies.

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

## What's new in v0.3.6

This update makes approvals clearer and keeps the focused chat mode easy to find.

**Relax Mode**
- Renamed the former Zen Mode to **Relax Mode**. Toggle it with `Ctrl+R` or `/relax`; the old Zen name and shortcuts are no longer used.
- The Relax footer keeps the AI's current activity visible, so you can tell when it is thinking, running a tool, or waiting for a decision.
- Diff approval choices stay easy to distinguish in the monochrome view: `y` is yellow, `a` is orange, and `n` is red.
- **Sidebar is now also monochrome** in Relax Mode — all colored elements (context bars, todo checkboxes, staging tags, tool logs) are rendered in gray for a consistent distraction-free experience.
- **Sidebar default is hidden** in all modes — toggle with `Ctrl+B` when needed. Relax Mode no longer auto-shows the sidebar when exiting.

**Clearer permissions**
- Shell permission prompts show the exact command, shell, working directory, foreground/background mode, timeout, and reason before you decide.
- MCP prompts show the tool arguments that will be sent and explain whether trust applies for this session or future sessions.
- Risky shell commands always require a fresh, one-time confirmation; session and saved allow rules cannot bypass that confirmation.
- Removed the broad default `npm run` allow rule, so scripts such as `npm run deploy` require explicit approval.

**Image processing improvements**
- When Tesseract is missing, `image_ocr` reports the dependency issue and gives an OS-appropriate installation command. Missing English language data is identified separately with remediation guidance.
- Niyusha must ask for permission before running an install command, verify the installation, and then retry OCR. It does not install dependencies silently.
- `image_embed` stores a timestamped vector node locally under `~/.niyusha/image-vectors/` and returns a compact node ID instead of the full vector.
- The current `sha256-bytehash-v1` representation is a deterministic byte fingerprintâ€”not a semantic or visual-similarity embedding.
- Use `image_vector_read` to retrieve numeric values only when needed, in chunks of up to 256 dimensions. This keeps routine tool output and conversation context small.

**Document reading**
- Added the on-demand `document-reading` skill and `read_document` tool for extracting text from DOCX and XLSX with Node.js built-ins, without adding runtime dependencies.
- Text-based PDFs use the optional system utility `pdftotext` (Poppler); Niyusha explains how to enable it and asks permission before installation. Scanned PDFs and legacy `.doc`/`.xls` formats are not supported by this reader.

**Web visual QA**
- Web simulation supports boolean `--assert` checks and writes a DOM-derived `ntvgraph.visual-context.v1` report with `--evidence <path>`. On action/assertion failure it also saves a screenshot and report with page, viewport, steps, metrics, console, and error evidence.
- `read_visual_evidence` turns that report into bounded text evidence for any model, including text-only models. It describes measured DOM/layout facts and possible issues, not pixel-level vision; image input remains optional via `inspect_image`.

**Context Intelligence (DIS-URICH)**
- **DIS-URICH** (Dynamic Information Structuring – Unified Representation for Intelligent Context Handling) is now the **default compaction mode**, replacing legacy compaction.
- Provides 65-76% token savings through semantic atomization and two-tier retrieval
- Maintains structured context with temporal resolution, conflict resolution, and relationship tracking
- Enables per-turn retrieval injection for better context awareness
- Full documentation: `DIS-URICH.md` and `biaya_urich.md` (cost-benefit analysis)
- Legacy mode remains available via `/compact mode legacy`
