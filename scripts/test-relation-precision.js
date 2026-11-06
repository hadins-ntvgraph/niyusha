'use strict';

const assert = require('assert');
const { atomizeHistory } = require('../bin/context-engine');

const cases = [
  { text: 'src/auth.js uses src/crypto.js.', expected: [['USES', 'src/auth.js', 'src/crypto.js']] },
  { text: 'parser calls tokenizer.', expected: [['CALLS', 'parser', 'tokenizer']] },
  { text: 'Compressor bergantung pada tokenizer.', expected: [['DEPENDS_ON', 'compressor', 'tokenizer']] },
  { text: 'React was replaced by Vue.', expected: [['REPLACED_BY', 'react', 'vue']] },
  { text: 'client uses service.', expected: [['USES', 'client', 'service']] },
  { text: 'runner calls module.', expected: [['CALLS', 'runner', 'module']] },
  { text: 'module is called by runner.', expected: [['CALLS', 'runner', 'module']] },
  { text: 'service is used by client.', expected: [['USES', 'client', 'service']] },
  { text: 'module terhubung dengan database.', expected: [['CONNECTED_TO', 'module', 'database']] },
  { text: 'test-suite covers parser.', expected: [['TESTS', 'test-suite', 'parser']] },
  { text: 'React digantikan oleh Vue.', expected: [['REPLACED_BY', 'react', 'vue']] },
  { text: 'Dulu frontend memakai React. Sekarang frontend beralih ke Vue.', expected: [
    ['USES', 'frontend', 'react'],
    ['REPLACED_BY', 'react', 'vue'],
  ] },
  { text: 'Please use the browser for search.', expected: [] },
  { text: 'saat proses berjalan, system calls only when ready.', expected: [] },
  { text: 'The result is useful for the user.', expected: [] },
  { text: 'Maybe parser uses cache.', expected: [] },
  { text: 'Jalankan test parser sekarang.', expected: [] },
  { text: 'The service is healthy and stable.', expected: [] },
  { text: 'A new release replaces the old release.', expected: [] },
  { text: 'The error was caused by timeout.', expected: [] },
];

function actualRelations(text) {
  const atoms = atomizeHistory([{ role: 'assistant', content: text }], {});
  const keys = new Set();
  for (const atom of atoms) {
    for (const relation of atom.relations || []) {
      const source = relation.source || atom.entity || '';
      const target = relation.target || '';
      if (source && target) keys.add(`${relation.type}|${source}|${target}`);
    }
  }
  return [...keys].sort();
}

function expectedRelations(list) {
  return [...new Set(list.map(([type, source, target]) => `${type}|${source}|${target}`))].sort();
}

let tp = 0;
let fp = 0;
let fn = 0;
let exact = 0;
const failures = [];

for (const item of cases) {
  const expected = expectedRelations(item.expected);
  const actual = actualRelations(item.text);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const caseTp = actual.filter((key) => expectedSet.has(key)).length;
  const caseFp = actual.filter((key) => !expectedSet.has(key)).length;
  const caseFn = expected.filter((key) => !actualSet.has(key)).length;
  tp += caseTp;
  fp += caseFp;
  fn += caseFn;
  if (caseTp === expected.length && caseFp === 0 && caseFn === 0) exact++;
  if (caseFp || caseFn) failures.push({ text: item.text, expected, actual });
}

const precision = tp + fp ? tp / (tp + fp) : 1;
const recall = tp + fn ? tp / (tp + fn) : 1;
const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
const report = {
  cases: cases.length,
  exactCases: exact,
  truePositive: tp,
  falsePositive: fp,
  falseNegative: fn,
  precision: Number(precision.toFixed(4)),
  recall: Number(recall.toFixed(4)),
  f1: Number(f1.toFixed(4)),
  failures,
};

console.log(JSON.stringify(report, null, 2));
assert.strictEqual(fp, 0, 'held-out corpus: false positive harus 0');
assert.strictEqual(fn, 0, 'held-out corpus: false negative harus 0');
console.log(`PASS relation precision: ${exact}/${cases.length} exact cases, precision=${report.precision}, recall=${report.recall}`);
