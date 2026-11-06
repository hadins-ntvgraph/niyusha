'use strict';

// Test state lifecycle: todo replace/clear, resolved-issue memory, and
// approval auto-apply not applying twice.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Agent } = require(path.join(__dirname, '..', 'bin/ai'));
const ideAIPath = path.join(__dirname, '..', '..', 'ide-engine', 'tui', 'bin', 'ai.js');
const IdeAgent = fs.existsSync(ideAIPath) ? require(ideAIPath).Agent : null;
const { TUI, parseKeys } = require(path.join(__dirname, '..', 'bin/tui'));
const { VirtualFS } = require(path.join(__dirname, '..', 'bin/vfs'));

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`PASS ${label}`);
  } else {
    fail++;
    console.log(`FAIL ${label} ${extra}`);
  }
};

(async () => {
  const timePrompt = new Agent({ config: {} }).systemPrompt();
  const localTimeMatch = timePrompt.match(
    /Current local date\/time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \([^,\n]+, UTC[+-]\d{2}:\d{2}\)\. Verify current events with web_search\./
  );
  ok('prompt: includes local date/time, timezone, and freshness reminder', Boolean(localTimeMatch));
  if (IdeAgent) {
    const ideTimePrompt = new IdeAgent({ config: {} }).systemPrompt();
    ok('IDE prompt: includes local date/time context', /Current local date\/time: \d{4}-\d{2}-\d{2}/.test(ideTimePrompt));
  }

  // 1) _replaceTodos mengganti seluruh daftar, termasuk mengosongkannya.
  let todos = [{ text: 'lama' }];
  let persisted = 0;
  const fakeTui = Object.create(TUI.prototype);
  fakeTui.agent = { state: { todos } };
  fakeTui._todos = () => todos;
  fakeTui._persistTodos = () => {
    persisted++;
  };
  fakeTui._replaceTodos([{ text: 'baru' }]);
  ok('replaceTodos: daftar diganti', todos.length === 1 && todos[0].text === 'baru', JSON.stringify(todos));
  ok('replaceTodos: state agent ikut', fakeTui.agent.state.todos === todos);
  ok('replaceTodos: persist dipanggil', persisted === 1, String(persisted));
  fakeTui._replaceTodos([]);
  ok('replaceTodos: daftar kosong menghapus semua', todos.length === 0 && persisted === 2);

  // 2) Auto-apply mengembalikan count/paths, bukan apply dua kali.
  let applied = 0;
  let appliedPathsArg = null;
  const vfs = {
    pending: [{ path: '/a.txt' }],
    pendingChanges() {
      return this.pending;
    },
    hasPending() {
      return this.pending.length > 0;
    },
    applyPending(paths) {
      applied++;
      appliedPathsArg = paths;
      this.pending = [];
      return 1;
    },
  };
  const autoTui = Object.create(TUI.prototype);
  autoTui.autoApply = true;
  autoTui.agent = { vfs };
  const decision = await TUI.prototype._askApproval.call(autoTui, [{ path: '/a.txt' }]);
  ok('auto approval: apply sekali', applied === 1, String(applied));
  ok('auto approval: hasil applied+count', decision.applied === true && decision.count === 1, JSON.stringify(decision));
  ok('auto approval: paths diteruskan', Array.isArray(decision.paths) && decision.paths[0] === '/a.txt');
  ok('auto approval: apply hanya path yang disetujui', Array.isArray(appliedPathsArg) && appliedPathsArg[0] === '/a.txt');

  // 2b) "Allow this session" saat mid-run hanya menyetujui; AI loop yang
  // meng-apply sekali. TUI tidak boleh apply sendiri lalu AI apply lagi.
  let appliedMid = 0;
  const vfsMid = {
    pending: [{ path: '/b.txt' }],
    pendingChanges() {
      return this.pending;
    },
    hasPending() {
      return this.pending.length > 0;
    },
    applyPending() {
      appliedMid++;
      this.pending = [];
      return 1;
    },
  };
  const midTui = Object.create(TUI.prototype);
  midTui.agent = { vfs: vfsMid };
  midTui.autoApply = false;
  midTui.approvalResolve = () => {};
  midTui.awaitingApproval = true;
  midTui.push = () => {};
  let settled = null;
  midTui._settleApproval = (d) => {
    settled = d;
    midTui.approvalResolve = null;
  };
  TUI.prototype._applyCmd.call(midTui, 'auto');
  ok('midrun auto: TUI tidak apply sendiri', appliedMid === 0, String(appliedMid));
  ok('midrun auto: autoApply aktif untuk sesi', midTui.autoApply === true);
  ok('midrun auto: menyerahkan apply ke AI loop', settled && settled.decision === 'apply' && settled.applied !== true, JSON.stringify(settled));

  // 2c) Prompt izin menjelaskan command, konteks eksekusi, dan batas izin.
  const promptLines = [];
  const permTui = Object.create(TUI.prototype);
  permTui.agent = { vfs: { root: 'C:\\repo' } };
  permTui.cfg = () => ({ shell: 'powershell' });
  permTui.push = (_type, text) => promptLines.push(String(text));
  permTui.render = () => {};
  const riskyApproval = TUI.prototype._askPerm.call(permTui, {
    type: 'shell',
    command: 'Remove-Item -Recurse C:\\temp\\example',
    cwd: 'C:\\repo',
    shell: 'win32/x64 -> powershell.exe',
    timeout: 5000,
    alwaysConfirm: true,
    reason: 'selalu perlu konfirmasi: penghapusan rekursif',
  });
  const promptText = promptLines.join('\n');
  ok('permission prompt: command, cwd, shell, mode, timeout visible', /Remove-Item -Recurse/.test(promptText) && /cwd: C:\\repo/.test(promptText) && /powershell\.exe/.test(promptText) && /timeout 5s/.test(promptText));
  ok('permission prompt: risky action has no persistent/session allow option', !/allow this exact command|allow always \(save\)/.test(promptText));
  const pendingResolve = permTui.permResolve;
  TUI.prototype._settlePerm.call(permTui, 'session');
  ok('permission prompt: risky command cannot be session-approved', permTui.permResolve === pendingResolve);
  TUI.prototype._settlePerm.call(permTui, 'once');
  ok('permission prompt: risky command can be allowed once', await riskyApproval === true);

  const mcpLines = [];
  const mcpTui = Object.create(TUI.prototype);
  mcpTui.agent = { addMcpAllow() {} };
  mcpTui.cfg = () => ({ shell: 'powershell' });
  mcpTui.push = (_type, text) => mcpLines.push(String(text));
  mcpTui.render = () => {};
  const mcpApproval = TUI.prototype._askPerm.call(mcpTui, {
    type: 'mcp',
    server: 'prod',
    tool: 'delete_record',
    arguments: { id: 42, confirm: false },
  });
  ok('MCP prompt: server, tool, full arguments and trust scope visible', /prod\.delete_record/.test(mcpLines.join('\n')) && /"id": 42/.test(mcpLines.join('\n')) && /all its tools/.test(mcpLines.join('\n')));
  TUI.prototype._settlePerm.call(mcpTui, 'reject');
  ok('MCP prompt: reject settles permission request', await mcpApproval === false);

  // 2d) Relax keeps approval choices colored and exposes activity in its footer.
  const relaxDiffLine = TUI.prototype._relaxPaint.call(
    { relaxMode: true },
    '\x1b[32mTotal +1 -1. Press \x1b[32;1my\x1b[0m apply · \x1b[32;1ma\x1b[0m always · \x1b[31;1mn\x1b[0m reject'
  );
  const hasColorBefore = (label) => {
    const at = relaxDiffLine.indexOf(label);
    return at >= 0 && /\x1b\[(?!90m)[0-9;]*m/.test(relaxDiffLine.slice(Math.max(0, at - 24), at));
  };
  ok('relax diff: y apply remains colored', hasColorBefore('y apply'));
  ok('relax diff: a always remains colored', hasColorBefore('a always'));
  ok('relax diff: n reject remains colored', hasColorBefore('n reject'));
  const relaxFooter = TUI.prototype._bottomBar.call({
    relaxMode: true,
    busy: true,
    status: 'thinking (test-model)',
    currentAction: null,
  }, 100).replace(/\x1b\[[0-9;]*m/g, '');
  ok('relax footer: brand and thinking status stay visible', /Niyusha/.test(relaxFooter) && /AI · thinking \(test-model\)/.test(relaxFooter));
  const relaxStandbyFooter = TUI.prototype._bottomBar.call({
    relaxMode: true,
    busy: true,
    status: 'thinking (test-model)',
    currentAction: 'Standby',
  }, 100).replace(/\x1b\[[0-9;]*m/g, '');
  ok('relax footer: completed tool activity returns to Standby', /AI · Standby/.test(relaxStandbyFooter));
  const parsedRelax = parseKeys('\x12');
  const parsedLegacyControl = parseKeys(String.fromCharCode(26));
  ok('relax shortcut: Ctrl+R maps to relax key', parsedRelax.length === 1 && parsedRelax[0] === 'ctrl+r');
  ok('relax shortcut: former control key is no longer mapped', parsedLegacyControl.length === 0);
  const relaxTui = Object.create(TUI.prototype);
  relaxTui.relaxMode = false;
  relaxTui.showSidebar = false;
  relaxTui.mode = 'chat';
  relaxTui.input = '';
  relaxTui.multiline = false;
  relaxTui.push = () => {};
  relaxTui.render = () => {};
  TUI.prototype._handle.call(relaxTui, 'ctrl+r');
  ok('relax shortcut: Ctrl+R toggles relax mode and hides sidebar', relaxTui.relaxMode && !relaxTui.showSidebar);

  // 3) Resolved issue dipisah dari FAILURES dan tidak dianggap terbuka.
  const agent = new Agent({ vfs: {}, cwd: '/', config: { apiKey: 'x', model: 'm' } });
  const modeAgent = new Agent({ vfs: {}, cwd: '/', config: {} });
  try { await modeAgent.run('test', { uiMode: 'relax' }); } catch {}
  const relaxPrompt = modeAgent.systemPrompt();
  ok('Relax mode: prompt includes concise, playful task-focused guidance', /UI MODE: RELAX/.test(relaxPrompt) && /ngopi santai/.test(relaxPrompt) && /jangan sampai candaan mengganggu/.test(relaxPrompt));
  try { await modeAgent.run('test', { uiMode: 'normal' }); } catch {}
  ok('Relax mode: normal prompt omits Relax-only guidance', !/UI MODE: RELAX/.test(modeAgent.systemPrompt()));
  agent._addFailure('run_command GAGAL: npm test');
  const msg = await agent.executeTool('resolve_issue', { issue: 'npm test', note: 'exit 0 setelah fix' });
  ok('resolve_issue: failure cocok dipindah', agent.failures.length === 0 && agent.resolved.length === 1, msg);
  const prompt1 = agent.systemPrompt();
  ok('prompt: RESOLVED tampil', /RESOLVED/.test(prompt1) && /exit 0 setelah fix/.test(prompt1));
  ok('prompt: FAILURES lama tidak tampil', !/FAILURES \(error yang MASIH terbuka/.test(prompt1));

  // 4) Masalah yang muncul lagi kembali menjadi open (bukan tetap resolved).
  agent._addFailure('run_command GAGAL: npm test');
  const prompt2 = agent.systemPrompt();
  ok('reopen: failure kembali', agent.failures.length === 1 && agent.resolved.length === 0);
  ok('reopen: prompt memuat FAILURES', /FAILURES \(error yang MASIH terbuka/.test(prompt2));

  // 5) Catatan runtime /undo masuk prompt; tag sama menggantikan yang lama.
  agent.addContextNote('undo', 'User menjalankan /undo: 2 perubahan dibatalkan.');
  const prompt3 = agent.systemPrompt();
  ok('context note: tampil di prompt', /Catatan konteks runtime/.test(prompt3) && /2 perubahan dibatalkan/.test(prompt3));
  agent.addContextNote('undo', 'User menjalankan /redo: 2 perubahan diterapkan ulang.');
  const prompt4 = agent.systemPrompt();
  ok('context note: tag sama menggantikan', /diterapkan ulang/.test(prompt4) && !/dibatalkan/.test(prompt4));
  agent.reset();
  ok('context note: reset membersihkan', !/Catatan konteks runtime/.test(agent.systemPrompt()));

  // 6) Ledger menyimpan transisi goal dan supersede eksplisit per scope.
  const ledgerAgent = new Agent({ config: { compactionMode: 'urich' } });
  ledgerAgent._recordGoal('Perbaiki autentikasi', 'user');
  ledgerAgent._recordGoal('Tugas baru: migrasikan pencarian API', 'user');
  ok(
    'goal ledger: goal lama superseded',
    ledgerAgent.goalLedger.length === 2 &&
      ledgerAgent.goalLedger[0].status === 'superseded' &&
      ledgerAgent.goalLedger[1].status === 'active' &&
      ledgerAgent.goalHistory[0] === 'Perbaiki autentikasi'
  );
  ledgerAgent.goal = 'Perbaiki autentikasi';
  ok('goal transition: kata sekarang saja bukan penggantian goal', !ledgerAgent._isGoalChange('Sekarang jalankan test autentikasi lagi.'));
  ok('goal transition: perubahan eksplisit terdeteksi', ledgerAgent._isGoalChange('Ganti tujuan ke migrasi API.'));
  ledgerAgent._recordDecisionUpdates('Keputusan [api]: Pertahankan endpoint v1 dengan adapter.');
  ledgerAgent._recordDecisionUpdates('Keputusan [frontend]: Gunakan Vue.');
  ledgerAgent._recordDecisionUpdates('Keputusan [api]: Hapus endpoint v1 setelah migrasi klien.');
  ok(
    'decision ledger: hanya scope sama yang superseded',
    ledgerAgent.decisionLedger.length === 3 &&
      ledgerAgent.decisionLedger[0].status === 'superseded' &&
      ledgerAgent.decisionLedger[1].status === 'active' &&
      ledgerAgent.decisionLedger[2].status === 'active'
  );
  const ledgerPrompt = ledgerAgent.systemPrompt();
  ok('decision ledger: prompt menandai fakta aktif dan historis', /LEDGER KEPUTUSAN/.test(ledgerPrompt) && /Riwayat superseded/.test(ledgerPrompt) && /frontend/.test(ledgerPrompt));
  ledgerAgent.reset();
  ok('state ledger: reset membersihkan', ledgerAgent.goalLedger.length === 0 && ledgerAgent.decisionLedger.length === 0);

  // 7) Goal, decision, summary, dan compaction session bertahan pada save/load.
  const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-session-state-'));
  try {
    const sessionAgent = new Agent({
      vfs: new VirtualFS('session-state-test', sessionRoot),
      cwd: sessionRoot,
      config: {
        compactionMode: 'urich',
        contextEngineDir: path.join(sessionRoot, '.context'),
        compactionArchiveDir: path.join(sessionRoot, '.archive'),
      },
    });
    sessionAgent.compactionSessionId = 'saved-urich-session';
    sessionAgent.summary = 'Ringkasan: parser menjaga kontrak API.';
    sessionAgent._recordGoal('Perbaiki parser tanpa mengubah kontrak API');
    sessionAgent._recordDecisionUpdates('Keputusan [api]: Pertahankan endpoint v1.');
    const sessionTodos = [];
    let savedSession = null;
    const sessionTui = Object.create(TUI.prototype);
    Object.assign(sessionTui, {
      agent: sessionAgent,
      store: {
        todos: () => sessionTodos,
        setTodos: (items) => { sessionTodos.splice(0, sessionTodos.length, ...items); },
        saveSession: (id, data) => { savedSession = { id, ...data }; },
      },
      transcript: [{ type: 'user', text: 'Perbaiki parser.' }],
      push: () => {},
      _invalidateChat: () => {},
      _setInput: () => {},
      _pushAnswer: () => {},
    });
    TUI.prototype._saveSession.call(sessionTui);
    sessionAgent._recordGoal('Tugas baru: migrasikan API');
    sessionAgent._recordDecisionUpdates('Keputusan [api]: Ganti endpoint setelah migrasi.');
    TUI.prototype._restoreState.call(sessionTui, savedSession, 'Session restored');
    ok(
      'session lifecycle: goal ledger and decision ledger restored',
      sessionAgent.goalLedger.length === 1 &&
        sessionAgent.goalLedger[0].text === 'Perbaiki parser tanpa mengubah kontrak API' &&
        sessionAgent.decisionLedger.length === 1 &&
        sessionAgent.decisionLedger[0].text === 'Pertahankan endpoint v1'
    );
    ok(
      'session lifecycle: summary and compaction archive identity restored',
      sessionAgent.summary === 'Ringkasan: parser menjaga kontrak API.' &&
        sessionAgent.compactionSessionId === 'saved-urich-session'
    );
  } finally {
    fs.rmSync(sessionRoot, { recursive: true, force: true });
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
