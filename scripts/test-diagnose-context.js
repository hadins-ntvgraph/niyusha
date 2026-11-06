'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-context-diagnostic-test-'));
const input = path.join(root, 'conversation.json');
const secret = 'PRIVATE-TRANSCRIPT-SENTINEL-DO-NOT-PRINT';
try {
  fs.writeFileSync(input, JSON.stringify({
    history: [
      { role: 'user', content: `Tujuan: parser. ${secret}` },
      { role: 'assistant', content: 'Status: tetap berjalan.' },
    ],
    budget: 600,
  }));
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'diagnose-context-bloat.js'),
    '--input',
    input,
    '--budget',
    '900',
  ], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(secret), 'diagnostic report must not print raw conversation text');
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.network, false);
  assert.strictEqual(report.rawConversationContentIncluded, false);
  assert.strictEqual(report.case.budgetChars, 600, 'input budget should be honored');
  assert.strictEqual(report.case.withinBudget, true);
  assert.ok(report.case.selectedByType.GOAL, 'diagnostic should report selected atom types');

  const invalid = spawnSync(process.execPath, [
    path.join(__dirname, 'diagnose-context-bloat.js'),
    '--input',
    path.join(root, 'missing.json'),
  ], { encoding: 'utf8' });
  assert.notStrictEqual(invalid.status, 0, 'missing input must fail explicitly');
  assert.match(invalid.stderr, /Context diagnostic failed/);
  process.stdout.write('PASS context diagnostic: local replay, custom budget, no raw text output, explicit errors\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
