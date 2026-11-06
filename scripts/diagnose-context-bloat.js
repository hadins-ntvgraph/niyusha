'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ContextEngine } = require('../bin/context-engine');

const budget = 1400;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-context-bloat-'));
const baseHistory = [
  { role: 'user', content: 'Tujuan: perbaiki parser tanpa mengubah kontrak API.' },
  { role: 'assistant', content: 'Keputusan: gunakan parser JSON bawaan.' },
  { role: 'user', content: 'File: src/parser.js. Test gagal pada input null; error code E_PARSE wajib dipertahankan.' },
  { role: 'assistant', content: 'Langkah berikutnya: perbaiki parser lalu jalankan regression test.' },
];

function parseArgs(argv) {
  const options = { input: null, budget, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') {
      options.input = argv[++i];
      if (!options.input) throw new Error('--input requires a JSON file path');
    } else if (argv[i] === '--budget') {
      options.budget = Number(argv[++i]);
      if (!Number.isSafeInteger(options.budget) || options.budget < 200) {
        throw new Error('--budget must be an integer >= 200');
      }
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argv[i]}`);
    }
  }
  return options;
}

function measureInput(history, summary) {
  return (Array.isArray(history) ? history : [])
    .reduce((sum, message) => sum + String(message && message.content || '').length, 0) +
    String(summary || '').length;
}

function progressHistory(kind) {
  const history = baseHistory.map((message) => ({ ...message }));
  for (let i = 0; i < 70; i++) {
    let user;
    let assistant;
    if (kind === 'same-template') {
      user = `Progress ${i}: lanjutkan implementasi parser dan pertahankan kontrak API.`;
      assistant = `Pemeriksaan rutin tahap ${i}: parser belum mengubah kontrak API.`;
    } else {
      user = i % 3 === 0
        ? `Progress ${i}: lanjutkan implementasi parser.`
        : i % 3 === 1
          ? `Update ${i}: parser cleanup masih berjalan, keep public API stable.`
          : `Pemeriksaan rutin tahap ${i}: lanjutkan pekerjaan.`;
      assistant = `Status tahap ${i}: pemeriksaan rutin tanpa perubahan kontrak.`;
    }
    history.push({ role: 'user', content: user }, { role: 'assistant', content: assistant });
  }
  return history;
}

function runCase(name, history, summary = null, state = null, requestedBudget = budget) {
  const engine = new ContextEngine({
    config: {
      contextEngineDir: path.join(root, name, 'memory'),
      contextEngineMemoryChars: requestedBudget,
    },
    workspace: root,
    sessionId: name,
  });
  const result = engine.compress({ history, summary, state, maxChars: requestedBudget });
  return {
    name,
    inputMessages: history.length,
    inputChars: measureInput(history, summary),
    summaryChars: result.stats.chars,
    budgetChars: result.stats.requestedBudgetChars,
    withinBudget: result.stats.summaryWithinBudget,
    atoms: result.stats.atoms,
    totalAtoms: result.stats.totalAtoms,
    omittedAtoms: result.stats.omittedAtoms,
    invariantCandidates: result.stats.invariantCandidates,
    invariantSelected: result.stats.invariantSelected,
    selectedContentChars: result.stats.selectedContentChars,
    formattingChars: result.stats.formattingChars,
    selectedByType: result.stats.selectedByType,
    selectedByTemporalStatus: result.stats.selectedByTemporalStatus,
  };
}

function runInputFile(inputPath, requestedBudget) {
  const resolvedPath = path.resolve(inputPath);
  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('input JSON must be an object');
  }
  const history = raw.history || raw.messages;
  if (!Array.isArray(history) || history.some((message) =>
    !message || typeof message !== 'object' || typeof message.content !== 'string'
  )) {
    throw new Error('input JSON must contain history or messages: an array of {role, content} objects');
  }
  const effectiveBudget = raw.budget == null ? requestedBudget : Number(raw.budget);
  if (!Number.isSafeInteger(effectiveBudget) || effectiveBudget < 200) {
    throw new Error('input budget must be an integer >= 200');
  }
  const result = runCase('local-replay', history, raw.summary || null, raw.state || null, effectiveBudget);
  return {
    network: false,
    mode: 'local-input-replay',
    rawConversationContentIncluded: false,
    estimator: 'summary character counts; not provider-token usage',
    case: result,
  };
}

function runSyntheticCases(requestedBudget) {
  return {
    network: false,
    estimator: 'summary character counts; not provider-token usage',
    cases: [
      runCase('baseline', baseHistory, null, null, requestedBudget),
      runCase('same-template-progress', progressHistory('same-template'), null, null, requestedBudget),
      runCase('varied-template-progress', progressHistory('varied-template'), null, {
        failures: ['Critical: tests/parser-empty.test.js fails on null; preserve E_PARSE.'],
      }, requestedBudget),
      runCase('varied-progress-with-old-summary', progressHistory('varied-template'),
        'Previous active summary: parser accepts strings. Error handling details pending.', {
          goalLedger: [
            { text: 'Old goal: replace parser API', status: 'superseded' },
            { text: 'Current goal: preserve API and fix null parsing', status: 'active' },
          ],
          decisions: [
            { scope: 'parser', text: 'Use JSON parser', status: 'active' },
          ],
        }, requestedBudget),
    ],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Usage: npm run diagnose:context [-- --input <conversation.json>] [--budget <chars>]\n' +
      'Input JSON: { "history": [{"role":"user","content":"..."}], "summary": "...", "state": {}, "budget": 1400 }\n' +
      'The report contains counts and diagnostics only; conversation text is not printed.\n'
    );
    return;
  }
  const report = options.input
    ? runInputFile(options.input, options.budget)
    : runSyntheticCases(options.budget);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Context diagnostic failed: ${error.message || String(error)}\n`);
  process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
