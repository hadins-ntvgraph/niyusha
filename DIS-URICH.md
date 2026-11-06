# DIS-URICH
## Dynamic Information Structuring – Unified Representation for Intelligent Context Handling

**Project:** Niyusha AI Agent<br>
**Organization:** NTVGraph<br>
**Document Type:** Internal Technical Architecture & Implementation Specification<br>
**Target:** Niyusha v0.3.8+<br>
**Status:** Research Prototype → Integration Design

---

# 1. VISION

DIS-URICH is Niyusha's internal engine for managing, organizing, compressing, retrieving, and reconstructing the information context required by AI.

DIS-URICH is not a separate application, a new agent, or a replacement for the LLM.

DIS-URICH operates within the Niyusha architecture as a **Context Intelligence Engine**.

Its primary goals are to:

- Reduce token usage without losing important information.
- Preserve conversation and coding-task context.
- Understand relationships between pieces of information.
- Separate active memory from the historical archive.
- Retrieve information when active context is insufficient.
- Maintain task continuity after context compaction.
- Reduce the need to reread the entire conversation history.

Core principle:

**Compress the context, preserve the knowledge, retrieve what is missing.**

# 2. CORE PRINCIPLES

DIS-URICH must follow these principles.

### 2.1 Semantic Preservation

Compression must do more than shorten text. The system must preserve meaning, facts, instructions, decisions, and relationships between pieces of information.

### 2.2 Two-Tier Memory

The system has two storage tiers:

**Compressed Memory**
- Active memory.
- Contains prioritized information.
- Optimized for token usage.
- Bounded by `contextEngineMemoryChars`; repeated numbered progress updates are collapsed so they do not crowd out important facts.
- Used as the first retrieval source.

**Original Archive**
- Preserves the complete source information.
- Serves as the fallback source.
- Preserves provenance and `atom_id`.
- Does not delete information merely because it was removed from active memory.
- Provides historical facts and relationships that do not fit in active memory.

### 2.3 Controlled Semantic Loss

Irrelevant information may be removed from active memory, but that does not mean it must be permanently deleted.

### 2.4 Retrieval Before Assumption

If information is missing or incomplete, Niyusha must search the original source before drawing a conclusion.

### 2.5 Agent Autonomy Preservation

DIS-URICH must not take control away from the Agent Core.

The Agent Core remains responsible for:
- Decisions.
- Tool usage.
- Command execution.
- Coding strategy.
- User interaction.

DIS-URICH only manages and provides context.

# 3. SYSTEM ARCHITECTURE

```text
                 USER INPUT
                     |
                     v
              NIYUSHA AGENT CORE
                     |
                     v
             CONTEXT INTERFACE
                     |
                     v
          +-----------------------+
          |   DIS-URICH ENGINE    |
          +-----------------------+
                     |
          +----------+-----------+
          |                      |
          v                      v
    CONTEXT ANALYZER        MEMORY MANAGER
          |                      |
          v                      v
    SEMANTIC ATOMIZER      TWO-TIER STORAGE
          |                      |
          v              +-------+-------+
    NORMALIZATION         |               |
          |               v               v
          v          COMPRESSED       ORIGINAL
    RELATION GRAPH    MEMORY           ARCHIVE
          |               |               |
          +---------------+---------------+
                          |
                          v
                   QUERY RETRIEVAL
                          |
                 +--------+--------+
                 |                 |
                 v                 v
            MEMORY SEARCH     ARCHIVE FALLBACK
                 |                 |
                 +--------+--------+
                          |
                          v
                COMPLETENESS VALIDATOR
                          |
                          v
                CONTEXT RECONSTRUCTOR
                          |
                          v
                  NIYUSHA AGENT CORE
                          |
                          v
                      LLM INPUT
```

# 4. INTERNAL MODULES

DIS-URICH should be modular so it does not burden the Agent Core and can be tested easily.

| Module | Responsibility |
|---|---|
| Context Analyzer | Analyzes incoming information |
| Semantic Atomizer | Splits information into atoms |
| Normalizer | Normalizes language and terminology |
| Relation Graph | Preserves relationships between atoms |
| Compressor | Optimizes active memory |
| Loss Budget Engine | Controls the degree of information loss |
| Invariant Validator | Protects critical information |
| Memory Manager | Manages storage |
| Retrieval Engine | Finds relevant information |
| Temporal Resolver | Understands how information changes over time |
| Conflict Resolver | Detects conflicting information |
| Completeness Validator | Ensures context is sufficient |
| Context Reconstructor | Assembles context for the LLM |

Each module must be independently testable.

# 5. SEMANTIC ATOMIZATION

Conversation and coding-activity information is split into information units called Semantic Atoms.

Atom types:

| Type | Description |
|---|---|
| IDENTITY | Identity of an entity or project |
| FACT | A known fact |
| RELATION | A relationship between entities |
| DECISION | A decision that was made |
| INSTRUCTION | A user instruction |
| STATE | Current state |
| HISTORY | Historical information |
| UNCERTAINTY | Information that is uncertain |
| NEGATIVE_FACT | A prohibition or negative condition |
| CODE_CONTEXT | Information about code and files |

Example:

Conversation:
"Do not change browser_content because browser_open only opens pages, while browser_content reads their content."

Atomization result:

```json
[
  {
    "atom_id": "atom_001",
    "type": "INSTRUCTION",
    "content": "Do not change browser_content without a clear reason.",
    "importance": 1.0
  },
  {
    "atom_id": "atom_002",
    "type": "RELATION",
    "content": "browser_open opens pages.",
    "importance": 0.9
  },
  {
    "atom_id": "atom_003",
    "type": "RELATION",
    "content": "browser_content reads page content.",
    "importance": 0.9
  }
]
```

# 6. ATOM METADATA

Each atom must have enough metadata to support retrieval and validation.

Example structure:

```json
{
  "atom_id": "atom_001",
  "type": "DECISION",
  "entity": "Niyusha Browser",
  "content": "The browser uses URL extraction.",
  "normalized_text": "the browser uses url extraction",
  "relations": [],
  "importance": 0.9,
  "effective_importance": 0.9,
  "confidence": 1.0,
  "relevance": 0.8,
  "created_at": "2026-10-31T10:00:00Z",
  "valid_from": null,
  "valid_until": null,
  "superseded_by": null,
  "temporal_status": "ACTIVE",
  "source": "conversation",
  "storage_tier": "COMPRESSED",
  "invariant": false,
  "loss_tolerance": 0.2
}
```

Notes:

- `importance` is the permanent importance value.
- `effective_importance` is a temporary value based on query needs.
- `normalized_text` must not replace the original content.
- `confidence` must not be conflated with relevance.
- `loss_tolerance` controls the risk of removing an atom from active memory.

# 7. NORMALIZATION LAYER

The Normalization Layer must handle language variations before matching.

Components:

1. Case folding.
2. Unicode normalization.
3. Indonesian stemming.
4. Synonym mapping.
5. Entity normalization.
6. Temporal phrase normalization.
7. Relation-aware matching.

Example:

```text
Query:
"Which framework did we use before switching to Vue?"

Concepts:
- framework
- before
- switch
- Vue
- historical decision

Search targets:
- previous framework
- historical decision
- superseded framework
```

Important:

Normalization must not change the original meaning.

Similar words do not necessarily have the same semantic relationship.

# 8. RELATION GRAPH

DIS-URICH must preserve relationships between pieces of information.

Example:

```text
Niyusha
   |
   +---- uses ----> browser_open
   |
   +---- uses ----> browser_content
   |
   +---- has -----> Browser Module
                         |
                         +---- extracts ----> URLs
                         |
                         +---- reads -------> Page Content
```

Temporal relationship:

```text
React
  |
  +---- USED_BEFORE ----> Project Frontend
                              |
                              +---- REPLACED_BY ----> Vue
```

Decision relationships must include status and time so the system does not treat an old decision as current.

# 9. TWO-TIER RETRIEVAL

This is one of the most important components.

Flow:

1. Receive a query from the Agent Core.
2. The Semantic Mapper identifies intent and entities.
3. Search Compressed Memory for relevant atoms.
4. Run Semantic Completeness Validation.
5. If context is incomplete, fall back to the Original Archive.
6. Validate relationships, time, and conflicts.
7. Send the reconstructed result to the Agent Core.

Pseudo-code:

```python
def retrieve_context(query):
    intent = semantic_mapper(query)

    active_atoms = compressed_memory.search(intent)

    validation = completeness_validator(
        query,
        active_atoms
    )

    if validation.complete:
        return reconstruct(active_atoms)

    missing = validation.missing_information

    archived_atoms = original_archive.search(
        intent,
        missing
    )

    verified_atoms = validate_provenance(
        archived_atoms
    )

    combined = merge_context(
        active_atoms,
        verified_atoms
    )

    return reconstruct(combined)
```

Fallback must not be triggered solely because keywords do not match. The system must evaluate whether the required information is actually unavailable.

# 10. TEMPORAL & CONFLICT INTELLIGENCE

### Temporal Resolver

Distinguish between:
- ACTIVE
- HISTORICAL
- SUPERSEDED
- UNKNOWN

Example:

```text
Decision A:
Framework = React
Status = SUPERSEDED

Decision B:
Framework = Vue
Status = ACTIVE

Relation:
React --REPLACED_BY--> Vue
```

### Conflict Resolver

The system must distinguish between:

1. Information that has been superseded.
2. The latest confirmed information.
3. Conflicting information from different sources.
4. Conflicts that remain unresolved.

Do not always choose the newest information without considering its source, authority, and confirmation status.

If a conflict cannot be resolved, Niyusha must preserve the uncertainty and ask for clarification when needed.

# 11. MEMORY IMPORTANCE & LOSS BUDGET

Active memory must not be determined solely by text length.

Prioritization must consider:

- Importance.
- Query relevance.
- Confidence.
- Recency.
- Relation centrality.
- Loss tolerance.
- Invariant status.

Memory categories:

| Tier | Function |
|---|---|
| CORE | Important instructions and identity |
| WORKING | Active tasks and decisions |
| HISTORICAL | Past information |
| DISCARDABLE | Repeated or temporary information |

DISCARDABLE means it is not loaded into active memory; it is not automatically deleted from the Original Archive.

Global importance and query relevance must be separate values.

# 12. NIYUSHA INTEGRATION

DIS-URICH must be integrated through the Context Interface.

Do not make major changes to the Agent Core before understanding Niyusha's actual code structure.

Conceptual interface:

```javascript
class ContextEngine {
  async ingest(input) {}

  async retrieve(query) {}

  async compress(sessionId) {}

  async reconstruct(query) {}

  async checkpoint(sessionId) {}

  async getStats(sessionId) {}
}
```

Usage example:

```javascript
const context = await contextEngine.retrieve(userMessage);

const response = await agent.run({
  message: userMessage,
  context
});
```

The interface above is conceptual. The final implementation must follow Niyusha's actual asynchronous patterns, error handling, session management, and provider interface.

### Integration with Context Compaction

Before the context window reaches its limit:

1. Snapshot the conversation.
2. Identify important atoms.
3. Update Compressed Memory.
4. Save the Original Archive.
5. Validate invariants.
6. Create a checkpoint.
7. Reconstruct concise context.
8. Continue the conversation.

Do not remove history until storage and validation succeed.

# 13. CODING CONTEXT INTEGRATION

DIS-URICH manages coding-task context as well as conversations.

Additional atoms:

- FILE
- FUNCTION
- CLASS
- DEPENDENCY
- CODE_DECISION
- EDIT_STATE
- TEST_RESULT
- ERROR
- CHECKPOINT

Example:

```text
Task: Add browser extraction feature

Files:
- browser.js
- browser_content.js
- agent.js

Relations:
browser.js
   |
   +---- calls ----> browser_content.js
   |
   +---- integrated_with ----> agent.js

State:
- browser.js: completed
- browser_content.js: completed
- agent.js: pending integration
```

When a session is compressed, Niyusha must retain:

- The task goal.
- Files that have changed.
- Files that have not changed.
- Dependencies.
- Previous errors.
- Design decisions.
- Next steps.

This information must be connected to Niyusha's Checkpoint System.

# 14. STORAGE DESIGN

Initial storage proposal:

```text
~/.niyusha/
│
├── context/
│   ├── archive/
│   │   └── archive.jsonl
│   │
│   ├── memory/
│   │   └── compressed.json
│   │
│   ├── graph/
│   │   └── relations.json
│   │
│   ├── sessions/
│   │   └── session-index.json
│   │
│   └── checkpoints/
│       └── checkpoints.jsonl
│
└── config/
    └── context.json
```

Notes:
- This is a proposed structure, not an assumption that these directories already exist.
- Storage must support recovery after a process interruption.
- File writes must be safe and atomic.
- Session data must be isolated.
- Do not mix context across projects without a clear relationship.

# 15. TOKEN OPTIMIZATION

Optimization goal:

Reduce the number of tokens sent to the LLM without sacrificing answer quality.

Separate three types of cost:

1. Final Tokens: the final context sent to the model.
2. Archive Tokens: retrieved archive information.
3. Internal Operations: processing and retrieval costs.

Do not count tokens twice.

If Final Tokens already include Archive Tokens, do not add them again.

Savings formula:

```text
Token Reduction =
1 - (Optimized Input Tokens / Baseline Input Tokens)
```

The benchmark should use the provider model's tokenizer when available.

# 16. BENCHMARK & QUALITY CONTROL

DIS-URICH must have a permanent benchmark.

Mode:

**Memory-Only**
- Fallback disabled.
- Measures active-memory capability.

**Archive-Only**
- Uses the archive as its source.
- Measures information completeness.

**Two-Tier**
- Uses active memory first.
- Falls back only when needed.

Metrics:

| Metric | Purpose |
|---|---|
| Retrieval Accuracy | Retrieval correctness |
| Fact Retention | Fact completeness |
| Relation Retention | Relationship completeness |
| Temporal Accuracy | Temporal-context accuracy |
| Conflict Resolution | Conflict handling |
| False Positive Rate | Matching errors |
| Memory Sufficiency | Active-memory sufficiency |
| Fallback Frequency | Fallback frequency |
| Token Reduction | Token savings |
| Task Continuity | Coding-task continuity |
| Grounding Accuracy | Source-attribution accuracy |

Use the same dataset and questions when comparing versions.

Add held-out questions so the system cannot simply memorize the benchmark dataset.

# 17. IMPLEMENTATION ROADMAP

### Phase 1 — Context Engine Foundation

- Audit Niyusha's code structure.
- Determine the integration point.
- Create the Context Interface.
- Implement atomization.
- Implement the Original Archive.
- Implement Compressed Memory.

### Phase 2 — Retrieval Intelligence

- Semantic Mapper.
- Language Normalization.
- Two-Tier Retrieval.
- Completeness Validation.
- Archive Fallback.

### Phase 3 — Advanced Context Intelligence

- Relation Graph.
- Temporal Resolver.
- Conflict Resolver.
- Dynamic Importance.
- Loss Budget Controller.

### Phase 4 — Coding Context

- File relationship atoms.
- Function and dependency mapping.
- Task state.
- Checkpoint integration.
- Error and test history.

### Phase 5 — Optimization

- Selective Reconstruction.
- Adaptive Compression.
- Token Budget Controller.
- Memory Sufficiency Benchmark.
- Performance optimization.

Do not implement every phase at once.

Each phase must have tests and a checkpoint before proceeding.

# 18. SAFETY & FAILURE HANDLING

DIS-URICH must follow these rules:

1. Do not delete the Original Archive merely because information has been compressed.
2. Do not turn mandatory instructions into optional ones.
3. Do not turn uncertainty into fact.
4. Do not mix old and current decisions.
5. Do not treat keyword similarity as proof of semantic equivalence.
6. Do not fall back without recording the reason.
7. Do not send the entire archive to the LLM when only a few atoms are needed.
8. Do not change the Agent Core without a measurable need.
9. Do not consider compression successful before validation.
10. If retrieval fails, state that the context was not found instead of making up an answer.

# 19. INITIAL IMPLEMENTATION INSTRUCTIONS FOR AI BUILDER

Before writing code:

1. Audit the actual Niyusha repository.
2. Identify the message flow, context window, compaction, session, and provider paths.
3. Identify every location that reads or constructs messages for the LLM.
4. Create a dependency map for the modules to be changed.
5. Show the current file structure.
6. Create an implementation plan.
7. Identify compatibility risks.
8. Do not assume that file names or directory structures in this document already exist.

After the audit:

- Implement modules incrementally.
- Preserve compatibility with existing Niyusha features.
- Create a checkpoint before multi-file changes.
- Test each module independently.
- Test integration with the Agent Core.
- Compare token usage before and after.
- Report changed files and test results.

**Do not perform a large-scale rewrite of Niyusha.**

DIS-URICH must be added as a new internal capability with the smallest possible changes to the existing system.

# 20. IMPLEMENTATION STATUS (CURRENT)
Status: **Implementation phases 1–5 complete; production-quality comparison is still in progress. URich is configured as the default, but current live evidence is not sufficient to establish it as a production-ready Legacy replacement.**

## 20.1 Implemented (now)
- `bin/config.js` — `compactionMode` default changed to `urich` (was `legacy`); `compactionAuto: true` remains default.
- `bin/ai.js` — `_getContextEngine`, `_runUrichCompaction`, `urich` branch in `compactIfNeeded`, `compactionStats().urich`, `refresh()` resets engine, per-turn retrieval injection via `_urichRetrievalContext`, `lastUrichRetrieval` stats, `_urichState()` helper.
- `bin/context-engine.js` — Semantic Atomizer, Compressed Memory, Retrieval, Archive Fallback, Checkpoint, Two-Tier Retrieval, temporal/conflict resolver, relation graph, task state, coding context atoms (FILE/FUNCTION/CLASS/DEPENDENCY/CODE_DECISION/EDIT_STATE/CHECKPOINT), query-aware selective reconstruction, sufficiency flag, state atomization (GOAL/FAILURE/RESOLVED/EVIDENCE/TOUCHED_FILE). Token optimization: metadata 300→150, paths 12→6, header `DCM`.
- Correctness hardening: reset rotates the compaction session ID and clears retrieval cache; long messages/state/summaries are fully chunked instead of silently truncated; retrieval ranks current memory and archive candidates together so matching current atoms do not suppress relevant archived facts.
- State ledger: goal transitions are timestamped and preserve superseded goals; automatic goal switching now requires explicit change wording rather than a generic temporal word. Scoped decisions use `Decision [scope]: ...`; a newer decision in the same scope supersedes the earlier one, while decisions in different scopes remain active. Ledger records are included in prompts, URich state/archive, and TUI/CLI save/load; unscoped decision prose is deliberately not auto-superseded.
- Example: `Decision [api]: Keep endpoint v1 with an adapter.` followed by `Decision [api]: Remove endpoint v1 after client migration.` marks the first record superseded and the second active. `Decision [frontend]: ...` remains a separate active decision.
- `bin/compaction.js` — `MODES` includes `urich`; archiveHistory stores `state`.
- `bin/tui.js` / `bin/niyusha.js` — allowed modes + `/compact auto` test in urich; Ctrl+K entries; session save/load preserves `summary`, compaction session ID, goal history/ledger, scoped decision ledger, failures, resolved items, evidence, touched files, and context notes.
- `bin/config.js` — `contextEngineDir`, `contextEngineMemoryChars: 1400`, `compactionThreshold: 0.45` (adaptive 0.35-0.65), `compactionThresholdLocked: false`, `compactionKeepTokens: 0` (adaptive), `compactionBufferRatio: 0` (adaptive 30%), `compactionCooldownMs: 60000`, `contextRecencyPruneRatio: 0.5`, `compactionAiTimeoutMs: 30000`, `compactionAiChunkChars: 24000`.
- `bin/ai.js` — adaptive compaction based on per-turn context growth (EMA), 1.3x token estimate multiplier, recency prune of tool output outside the 50% budget, 60s cooldown + hysteresis + post-prune, 90% prompt overflow guard, overflow recovery (compact + single retry), local compression fallback, live progress.
- `bin/tui.js` — `/compact threshold <0.3-0.75 | auto>` command to lock or reset the adaptive threshold.
- `scripts/bench-context.js` — benchmark harness (off/legacy/safe/shadow/urich), sufficiency column.
- `scripts/test-context-engine.js` — atomizer, retrieval, archive fallback, urich auto, continuity (prompt delivery), Phase 3–4 (code_kind, relation, temporal, conflict, task state), Phase 5 (sufficiency), state atomization + archive state persistence.

## 20.2 Evaluation snapshot

Deterministic `scripts/bench-context.js` (synthetic histories, `chars/4`
estimate) shows URich and Legacy producing comparable summary sizes on the
coding/bigfile/decision fixtures. This is a size/cost benchmark, not a recall or
quality result.

Offline `scripts/quality-context-offline.js` exercises full history, URich, and
a fixture-authored Legacy summary on identical synthetic auth/API transcripts.
In the current run all fixture facts pass, URich validates, and URich uses
2,105/2,137 estimated input tokens versus 2,777/2,807 for the authored Legacy
reference. The Legacy summary is an oracle-like fixture, not output from the
Legacy model path, so this is a deterministic retention/regression
benchmark—not a live quality comparison or evidence of production superiority.

Live quality comparison against Legacy is **not established**. Earlier one-off
runs across several provider models produced mixed results, were not repeatable,
and were limited by provider quota; those model-specific numbers are removed
because they are expired and cannot support a general claim. The lexical grader
also produced false negatives on equivalent wording, and some API answers were
tool-command-shaped non-answers. Production replacement still requires repeated
paired runs with no loss or contradiction of critical invariants, human-reviewed
raw answers, and provider-reported usage.

## 20.2.1 Fresh offline verification (2026-11-03)

The following checks were rerun without provider/network calls:

| Check | Result | Exact coverage |
|---|---|---|
| `npm run test:context` | **PASS** | Existing 70-step repetitive-progress regression: 144-message synthetic history compressed to 497/1,400 summary characters; one progress marker remains; active goal/fact and React-to-Vue historical retrieval are retained. |
| `npm run test:context` (varied-progress stress) | **PASS after a targeted fix** | 143-message fixture with three paraphrased progress templates and a critical `E_PARSE` fact. Before the fix, routine status lines consumed 1,386/1,400 summary characters; after collapsing only repeated numbered templates, summary is 490/1,400, one repeated status marker remains, and `E_PARSE` is retained. |
| `npm run test:compaction` | **PASS** | Compaction mode, archive, shadow/safe validation, rollback, and automatic continuity regressions. |
| `node scripts/test-urich-parity.js` | **PASS** | TUI/IDE context-engine and Agent compaction parity, including the varied-progress stress fixture and critical-fact retention. |
| `npm run quality:offline -- --json` | **PASS** | Auth 6/6 facts (4/4 critical) and API 8/8 facts (5/5 critical) pass for full history, URich, and the fixture-authored Legacy reference; URich compaction validation passes in both scenarios. |

The progress fix is deliberately narrow: it fingerprints the text after a
numbered `Progress`, `Update`, `Status`, routine-check, or `Check-in`
prefixes and collapses only repeated matching templates. Distinct progress
content remains a separate atom; the stress fixture verifies that a critical
failure first mentioned amid progress survives compression. The archive was
then retrieved after each of three successive memory compressions, and the
critical error code remained available on all three cycles.

For future root-cause checks, `ContextEngine.compress()` now reports measured
diagnostics: requested budget and final summary size, selected/omitted atom
counts, query-filtered count, invariant candidates versus selected, content
versus formatting characters, and selected atom counts/characters by type and
temporal status. Agent compaction telemetry exposes these as
`compactionStats().urich.diagnostics`. Run `npm run diagnose:context` for a
network-free JSON report over baseline, repeated-template progress,
varied-template progress, and progress combined with prior summary/state.
These cases isolate contributors; they do not simulate a provider-generated
summary or prove exact reproduction of the earlier live 6,780-character
result. If that live report is available, capture its same diagnostics plus
the effective config budget and model/provider to compare causes rather than
only final size.

To replay a real historical case locally, save only the relevant transcript
and optional prior summary/state as JSON, then run:

```bash
npm run diagnose:context -- --input C:\path\to\context-case.json --budget 1400
```

Accepted input shape:

```json
{
  "history": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}],
  "summary": "optional previous active summary",
  "state": {},
  "budget": 1400
}
```

`messages` may be used instead of `history`; a `budget` in the input JSON
overrides the CLI budget. Replay is local and provider-free. The report emits
counts/diagnostics only and explicitly omits raw conversation content. Use a
redacted fixture if the transcript contains secrets; do not paste raw
conversation or the full `/compact stats` output into an issue. For telemetry
sharing, copy only `urich.diagnostics` and manually remove local paths or
identifying metadata. This replay diagnoses atomization/selection/reconstruction
for the supplied history; it does not replay the provider's Legacy summary
generation or downstream model answers.

Latest diagnostic run: the four cases measured 326 chars (baseline), 474
(same-template progress), 652 (varied-template progress), and 805 (varied
progress plus prior summary/state), each under the configured 1,400-char
memory budget. The varied progress case selected 10 atoms, including 3
`INSTRUCTION` and 2 `STATE`; the prior-summary/state case selected 13 atoms,
including 3 `GOAL`, 2 `DECISION`, and 3 `INSTRUCTION`. This distribution
helps distinguish progress-template pressure from persisted summary/state
growth. These synthetic sizes are not comparable to the prior live 6,780-char
measurement unless its exact input history and effective settings are
replayed.

### Redacted replay of the newest local URich archive (2026-11-03)

The newest available archive for the active Niyusha workspace was replayed
locally through `ContextEngine.compress()` with its recorded history/state and
the effective `contextEngineMemoryChars` setting. No message text, API key, or
local path is included.

| Metric | Measurement |
|---|---:|
| Archive timestamp | 2026-11-03 10:54 UTC+7 |
| Records / messages | 1 / 101 |
| User / assistant / tool messages | 26 / 42 / 33 |
| Source content size | 33,228 chars |
| Maximum single message | 4,617 chars |
| Prior summary in archive | 0 chars |
| Effective memory budget | 1,400 chars |
| Replay summary | 1,399 chars (within budget) |

This replay does **not** reproduce the earlier 6,780-character summary. The
source archive had no previous summary, so summary carry-forward was not a
contributor. The 6,780-character case may be a different workspace/session, an
older build/configuration, or a different measurement (e.g. total request
context rather than active summary); its provenance remains unknown. Atom and
selection distributions from this replay were measured before the 20.9 changes
and were removed as expired; current invariant counts are in 20.9.

### Local archive retrieval audit (2026-11-03)

A second, local-only audit compared atoms from the same 101-message archive
with active memory and archive-backed retrieval. It printed no source text.
The source produced 175 target atoms with at least three normalized tokens
across identity, instruction, goal, decision, code-context, and relation
types. Exact active-memory atom coverage was 10.3%; mean lexical token
coverage in active memory was 35.5%. The low active coverage is not
automatically a defect: the design intentionally leaves historical detail in
the archive and retrieves it on demand.

An initial audit reported 100% retrieval token overlap, but its queries were
constructed directly from the source atom's own first four tokens. That is a
tautological, optimistically biased query and must **not** be presented as
semantic recall or retrieval quality. It is recorded only as a measurement
pitfall. A meaningful follow-up must use independently authored natural
language questions, blind to the source wording, include unanswerable
questions, and score required facts plus contradictions/unsupported claims.
Until that evaluation exists, archive retrieval quality for this real session
is **not established**.

The exact 70-step boilerplate stress case does **not** reproduce a
multi-thousand-character active summary: the measured summary was 497
characters. This does not invalidate the earlier 6,780-character live
observation; it shows that this deterministic fixture is not equivalent to
that run's exact input/model path. The earlier API `sufficient: false`
telemetry was a sufficiency-classification gap, not a fact-recall failure, and
was fixed in 20.9.

These successful checks are now the regression baseline; do not spend the
next test cycle rerunning only the same exact boilerplate fixture. New tests
should add distinct risk dimensions: paraphrased/code-switched progress,
progress that introduces one new critical fact, repeated compaction with
archive retrieval after each cycle, explicit unknown-answer questions, and
paired live Legacy/URich runs with human-reviewed answer quality and
provider-reported input usage. Live comparison is still pending; provider
limits and cost must be checked before running it.

## 20.3 Known gaps (not yet)
- Quality fixtures are synthetic and live quality results remain inconclusive; repeatability and more realistic task histories are needed.
- The lexical grader can produce false negatives for equivalent wording; review raw answers and update the rubric before using a score.
- Relation/temporal/conflict modules are heuristic; no full semantic mapper, relation graph persistence, temporal resolver persistence, conflict resolver persistence.
- Coding context integration is partial (atom extraction + task state; no file/function/dependency graph persistence).
- Performance tuning not yet finalized.

## 20.4 Key files
- `bin/context-engine.js` — DIS-URICH engine.
- `bin/ai.js` — agent integration.
- `bin/compaction.js` — modes + archive.
- `bin/tui.js`, `bin/niyusha.js` — UI/CLI integration.
- `bin/config.js` — defaults.
- `scripts/bench-context.js`, `scripts/test-context-engine.js` — benchmark/tests.
- `scripts/test-urich-evidence.js` — independent-query, abstention, ablation, and scale evidence.

## 20.5 Notes from this iteration
- `urich` is configured as the DEFAULT compaction mode (was opt-in). This configuration is not proof of production readiness; the quality comparison against Legacy remains open.
- `compactionAuto: true` remains default for automatic compaction.
- Local synthetic size measurements show URich retaining slightly more context than Legacy in the tested scenarios; this is a cost/size trade-off, not a quality verdict. Production suitability depends on preserving task-critical facts and producing correct downstream answers.
- `legacy` uses LLM summary + recent tail; `urich` uses deterministic atomization + retrieval + archive fallback.
- Tuning knobs for `urich`: `contextEngineMemoryChars`, `contextBudget`/`maxTokens`/model window, `keepTokens` derived from budget, query-aware selective reconstruction.
- `sufficient` flag now reported in retrieval and bench.
- Phase 5 (sufficiency + adaptive compression + memory-sufficiency benchmark output + state integration) considered done for current slice; performance tuning remains.
- State integration: goal/failures/resolved/evidence/touchedFiles/contextNotes now atomized, archived, and persisted via save/load.
- Legacy mode remains available via `/compact mode legacy` for backward compatibility.

## 20.6 Token Optimization (Implemented)
- Retrieval limit: 6 → 4 atoms per turn
- Duplicate query deduplication (skip if same query as last turn)
- Metadata truncation: 300 → 150 chars per sentence
- Path list: 12 → 6 paths
- Header optimization: `DIS-URICH compressed memory` → `DCM`

## 20.7 Lab Recall Run (2026-11-03)
- One exploratory run used the existing `urich-compaction-lab` workspace, launched from `tui` and then directed to the lab. Parser changes and tests already existed before this run, so it tests continuity/recall, not implementation from a clean baseline.
- Recall questions 6–9 scored 4/4 against the script key: null → `E_PARSE`; JSON strings → built-in parser rather than regex; preserve unknown object properties; retain the exported `parseInput(input)` API.
- The matching local context record reports `urich`, 2 compressions, 10 retrievals, 5 archive fallbacks, and 16 active atoms. Final API recall retrieval returned 4 atoms, no missing intent, and `sufficient: true`.
- Configured memory budget was 1,400 characters. Persisted atom content totaled 1,297 characters across 16 atoms (10 INSTRUCTION, 2 CODE_CONTEXT, 3 GOAL, 1 NEGATIVE_FACT); this is not the engine's exact rendered-summary character count, which was not persisted for this run.
- Local lab `npm test` was rerun after the session and passed: null error code, built-in JSON parsing, and unknown-property preservation.
- This is a single exploratory observation, not a comparative benchmark. The saved metrics establish successful compression and retrieval bookkeeping, not an independent semantic-quality score or the exact automatic-trigger percentage.

## 20.8 Implementation results (consolidated)

- Memory-budget accounting fixed: compaction respects contextEngineMemoryChars (default 1400) and reports summaryWithinBudget.
- Atomization: progress updates are collapsed; invariant classification narrowed to metadata and touched files; type-priority tie-break added; state atoms get distinct sequence numbers.
- Retrieval: current memory and archive candidates scored together; content-aware sufficiency (missingIntents) added; relation graph activated.
- Relation parser tightened (entity-aware, confidence threshold, relation validation) and held-out precision verified.
- Token optimization: metadata 300->150, paths 12->6, header DCM, seq prefix [#n] for chronological surfacing, original timestamps [t:HH:MM] on temporal atoms, derived tone markers (! ? - +) at ~1 char each.
- Context transparency: auto-compaction and manual `/compact` now print the full compaction result in chat as a special system message (`compaction: true`) in the user's language; trigger/count in sidebar and /usage, session vs context token meters separated. The message is never classified as ordinary conversation or added to the provider payload.
- Verification: context-engine, compaction, urich-parity, usage, state, hardening tests pass; offline quality gate PASS; live quality test auth 6/6, api 3/4 (token ~94% savings).


## 20.9 Adaptive bounded memory (TUI, 2026-11-05)

- `contextEngineMemoryChars` remains the 1,400-character baseline.
- TUI URICH now scales the effective memory with `contextBudget` using
  `base * max(1, budget / 4000)`, bounded by `contextEngineMemoryMaxChars`.
- The default maximum is 3,600 characters. Effective values are 1,400 at 2k/4k
  context budgets, 2,800 at 8k, and 3,600 at 16k or above.
- `lastUrich` telemetry records `memoryChars`, `memoryBaseChars`,
  `memoryMaxChars`, and `contextBudget` for auditability.
- Regression coverage verifies the baseline, proportional scaling, cap, summary
  validation, and syntax. The IDE copy is intentionally not synchronized yet;
  parity testing should resume after the IDE implementation is requested.

## 20.10 v0.3.9 contract audit (TUI, 2026-11-05)
- Added `scripts/test-v039-contract.js` to the TUI regression suite and `npm test`.
- The contract test covers AI-primary atomization, structural fallback, low
  confidence review queue, unresolved conflict preservation, exact semantic
  deduplication, different-intent retention, chronology, multilingual content
  preservation, and invariant overflow under `maxChars`.
- Result: **PASS**. The test confirms AI output enters `ContextEngine` through
  `ingestAtoms()`, while invalid AI output falls back to deterministic structural
  atomization. It does not claim that provider-generated semantic labels are
  always correct.
# 21. FINAL VISION

DIS-URICH makes Niyusha not only an AI agent that can run tools, but also an agent that can manage its own knowledge and work context.

Niyusha must be able to:

- Remember without carrying the entire history.
- Understand relationships between pieces of information.
- Recognize changes in decisions.
- Preserve coding context.
- Retrieve older information.
- Know when its memory is insufficient.
- Continue work after context compaction.

**DIS-URICH is the internal context intelligence engine of Niyusha.**

Developed within the NTVGraph ecosystem.
