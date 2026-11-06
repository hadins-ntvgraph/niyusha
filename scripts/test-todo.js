'use strict';

// ── Tes tool set_todos (tanpa API key) ─────────────────────────────────
// Memverifikasi pemetaan status (pending/in_progress/completed), alias done,
// dan filter item tanpa "text".

const path = require('path');
const { Agent } = require(path.join(__dirname, '..', 'bin/ai'));

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

const agent = new Agent({ vfs: {}, cwd: '/', config: { apiKey: 'x', model: 'm' } });

(async () => {
  const msg = await agent.executeTool('set_todos', {
    todos: [
      { text: 'langkah A', status: 'in_progress' },
      { text: 'langkah B', status: 'completed' },
      { text: 'langkah C', done: true },
      { text: 'langkah D' },
      { text: '', status: 'completed' },
      { status: 'pending' },
    ],
  });
  const t = agent.state.todos;
  ok('hanya item ber-"text" yang disimpan (4)', Array.isArray(t) && t.length === 4, JSON.stringify(t));
  ok('A → in_progress', t[0] && t[0].status === 'in_progress' && t[0].done === false);
  ok('B → completed', t[1] && t[1].status === 'completed' && t[1].done === true);
  ok('C done:true → completed', t[2] && t[2].status === 'completed' && t[2].done === true);
  ok('D default → pending', t[3] && t[3].status === 'pending' && t[3].done === false);
  ok('pesan hasil menyebut 4 item & 2 completed', /4 item/.test(msg) && /2 completed/.test(msg), msg);

  await agent.executeTool('set_todos', { todos: [{ text: 'X', status: 'weird' }, { text: 'Y', status: 'weird', done: true }] });
  const t2 = agent.state.todos;
  ok('status tak dikenal tanpa done → pending', t2[0] && t2[0].status === 'pending');
  ok('status tak dikenal + done:true → completed', t2[1] && t2[1].status === 'completed');

  await agent.executeTool('set_todos', { todos: [] });
  ok('daftar kosong → []', Array.isArray(agent.state.todos) && agent.state.todos.length === 0);

  await agent.executeTool('set_todos', { todos: 'bukan-array' });
  ok('args bukan array → [] (tidak error)', Array.isArray(agent.state.todos) && agent.state.todos.length === 0);

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
