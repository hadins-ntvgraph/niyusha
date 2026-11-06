/**
 * @fileoverview Diff generation and unified diff utilities
 *
 * @module diff
 */
'use strict';

function splitLines(s) {
  if (s == null) return [];
  return String(s).replace(/\r\n/g, '\n').split('\n');
}

function diffLines(a, b) {
  const A = splitLines(a);
  const B = splitLines(b);
  const n = A.length;
  const m = B.length;
  const out = [];

  if (n * m > 4000000) {
    for (const line of A) out.push({ type: '-', text: line });
    for (const line of B) out.push({ type: '+', text: line });
    return out;
  }

  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: ' ', text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: '-', text: A[i] });
      i++;
    } else {
      out.push({ type: '+', text: B[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: '-', text: A[i++] });
  while (j < m) out.push({ type: '+', text: B[j++] });
  return out;
}

function summarize(ops) {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === '+') added++;
    else if (op.type === '-') removed++;
  }
  return { added, removed };
}

function unifiedDiff(before, after, { context = 2 } = {}) {
  const ops = diffLines(before, after);
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type !== ' ') {
      for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
    }
  });
  const lines = [];
  let lastKept = -1;
  ops.forEach((op, idx) => {
    if (!keep[idx]) return;
    if (lastKept !== -1 && idx > lastKept + 1) lines.push({ type: '@', text: '···' });
    lines.push(op);
    lastKept = idx;
  });
  return lines;
}

module.exports = { diffLines, unifiedDiff, summarize, splitLines };
