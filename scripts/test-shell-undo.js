'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent } = require('../bin/ai');
const { VirtualFS } = require('../bin/vfs');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-shell-undo-'));
  try {
    const vfs = new VirtualFS('shell-undo-test', root, {
      undoFile: path.join(root, '.niyusha', 'undo.json'),
    });
    const agent = new Agent({
      vfs,
      cwd: root,
      config: { runUndo: true, runJail: false },
    });
    agent.classifyShell = () => ({ decision: 'allow', reason: 'test allow' });

    const marker = path.join(root, 'must-not-exist.txt');
    vfs.snapshotWorkspace = () => { throw new Error('injected snapshot disk error'); };
    const command = `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '\\\\')}', 'ran')"`;
    let result;
    try {
      result = await agent.executeTool('run_command', { command });
    } catch (error) {
      result = `ERROR: ${error.message}`;
    }

    assert.match(result, /Undo snapshot failed; shell command was not run/);
    assert.strictEqual(fs.existsSync(marker), false, 'mutating command must not execute without a snapshot');
    assert.strictEqual(agent.beforeShell('git status'), null, 'read-only commands do not need a workspace snapshot');
    process.stdout.write('PASS shell undo: snapshot failure blocks mutating command before execution\n');
    process.stdout.write('PASS shell undo: read-only commands bypass snapshotting\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
