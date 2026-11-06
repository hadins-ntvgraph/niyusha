#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const sim = require(path.join(__dirname, '..', 'bin/sim'));
const ideRoot = path.join(__dirname, '..', '..', 'ide-engine', 'tui');
const ideSimPath = path.join(ideRoot, 'bin', 'sim.js');
const ideSim = fs.existsSync(ideSimPath) ? require(ideSimPath) : null;
const { Agent } = require(path.join(__dirname, '..', 'bin/ai'));
const { VirtualFS } = require(path.join(__dirname, '..', 'bin/vfs'));
const ideAIPath = path.join(ideRoot, 'bin', 'ai.js');
const IdeAgent = ideSim ? require(ideAIPath).Agent : null;
const IdeVfs = ideSim ? require(path.join(ideRoot, 'bin', 'vfs')).VirtualFS : null;

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

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function main() {
  ok('parseViewport valid', JSON.stringify(sim.parseViewport('430x880')) === JSON.stringify({ width: 430, height: 880 }));
  ok('parseViewport invalid', sim.parseViewport('430') === null && sim.parseViewport('x880') === null);

  const parsed = sim.parseWebArgs([
    '--viewport', '360x640',
    '--metrics', '.a,.b',
    '--click', '#go',
    '--step-wait', '50',
    '--eval', '1+1',
    '--assert', 'document.title === "sim"',
    '--shot', 'x.png',
    '--shot-on-failure', 'failure.png',
    '--evidence', 'visual-context.json',
  ]);
  ok('parseWebArgs viewport', parsed.width === 360 && parsed.height === 640);
  ok('parseWebArgs metrics', parsed.metrics.join(',') === '.a,.b');
  ok('parseWebArgs actions order', parsed.actions.map((a) => a.type).join(',') === 'click,wait,eval,assert');
  ok('parseWebArgs evidence paths', parsed.shotOnFailure === 'failure.png' && parsed.evidence === 'visual-context.json');
  if (ideSim) {
    ok('TUI and IDE parse the same visual QA options', JSON.stringify(ideSim.parseWebArgs([
      '--assert', 'document.body !== null', '--shot-on-failure', 'failure.png',
    ])) === JSON.stringify({
      url: null, serve: null, width: 430, height: 880, wait: 0,
      timeout: sim.DEFAULT_TIMEOUT, chrome: null, shot: null, shotOnFailure: 'failure.png',
      evidence: null, actions: [{ type: 'assert', code: 'document.body !== null' }], metrics: [], help: false,
    }));
  }
  const input = sim.parseWebArgs(['--tap', '10,20', '--key', 'Space']);
  ok('parseWebArgs tap/key', input.actions[0].x === 10 && input.actions[0].y === 20 && input.actions[1].key === 'Space');
  let badTap = false;
  try {
    sim.parseWebArgs(['--tap', '10']);
  } catch {
    badTap = true;
  }
  ok('parseWebArgs tap invalid throws', badTap);
  let threw = false;
  try {
    sim.parseWebArgs(['--nope']);
  } catch {
    threw = true;
  }
  ok('parseWebArgs unknown flag throws', threw);

  ok('mimeFor html', sim.mimeFor('a.html').includes('text/html'));
  ok('mimeFor unknown', sim.mimeFor('a.bin') === 'application/octet-stream');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  ok('isPng valid', sim.isPng(png));
  ok('isPng invalid', !sim.isPng(Buffer.from('not png')));

  const adb = sim.findAdb();
  ok('findAdb returns path/name', typeof adb === 'string' && adb.length > 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-sim-test-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>sim</title><button id="go">Start</button><div id="box">box</div><main><h1>Visual test</h1><img src="/missing.png" alt="Unavailable image"></main><script src="app.js"></script>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'window.__sim = 42; window.__taps = 0; window.__keys = ""; document.querySelector("#go").addEventListener("click", () => window.__taps++); document.addEventListener("keydown", (e) => (window.__keys += e.key));');
  const fixtureReportPath = path.join(dir, 'visual-context-fixture.json');
  fs.writeFileSync(fixtureReportPath, JSON.stringify({
    ok: true,
    page: { url: 'http://example.test/', title: 'fixture' },
    viewport: { width: 320, height: 480 },
    screenshot: { path: path.join(dir, 'fixture.png') },
    errors: [],
    visual_context: {
      schema: 'ntvgraph.visual-context.v1',
      source: 'browser-dom',
      capture: { url: 'http://example.test/', title: 'fixture', viewport: { width: 320, height: 480 } },
      summary: { component_count: 1, by_role: { button: 1 } },
      checks: { horizontal_document_overflow: false, broken_image_count: 0 },
      findings: [],
      elements: [{ id: 'vc-0', role: 'button', selector: '#go', label: 'Start', text: 'Start', bbox: [0.1, 0.1, 0.2, 0.1], visible: true, on_screen: true }],
    },
  }));
  const evidenceAgent = new Agent({ vfs: new VirtualFS('visual-evidence-test', dir), cwd: dir, config: {} });
  const evidenceText = await evidenceAgent.executeTool('read_visual_evidence', { path: '/visual-context-fixture.json' });
  ok('text reader formats Visual Context for models without image input', evidenceText.includes('ntvgraph.visual-context.v1') && evidenceText.includes('button') && evidenceText.includes('bbox=') && evidenceText.includes('not pixel-level vision'));
  if (IdeAgent) {
    const ideEvidenceAgent = new IdeAgent({ vfs: new IdeVfs('ide-visual-evidence-test', dir), cwd: dir, config: {} });
    const ideEvidenceText = await ideEvidenceAgent.executeTool('read_visual_evidence', { path: '/visual-context-fixture.json' });
    ok('IDE reader preserves Visual Context schema and screenshot reference', ideEvidenceText.includes('ntvgraph.visual-context.v1') && ideEvidenceText.includes('button') && ideEvidenceText.includes('Screenshot:') && ideEvidenceText.includes('fixture.png'));
  }
  const server = await sim.startStaticServer(dir);
  const html = await get(server.url);
  const js = await get(server.url + 'app.js');
  ok('static server html', html.status === 200 && html.body.includes('<title>sim</title>'));
  ok('static server mime js', String(js.headers['content-type']).includes('text/javascript'));
  await server.close();

  const chrome = sim.findChrome();
  if (!chrome) {
    console.log('SKIP chrome integration (Chrome/Edge tidak ditemukan)');
  } else {
    const shot = path.join(dir, 'visual-context.png');
    const evidence = path.join(dir, 'visual-context.json');
    const result = await sim.openWeb({
      serve: dir,
      chrome,
      width: 320,
      height: 480,
      wait: 250,
      metrics: ['#box', 'body'],
      evidence,
      actions: [
        { type: 'eval', code: 'window.__sim' },
        { type: 'click', selector: '#go' },
        { type: 'eval', code: 'window.__taps = 0' },
        { type: 'tap', x: 20, y: 20 },
        { type: 'key', key: 'ArrowUp' },
        { type: 'eval', code: '({taps: window.__taps, keys: window.__keys})' },
      ],
    });
    ok('openWeb ok', result.ok === true);
    ok('openWeb viewport', result.metrics.viewport.w === 320 && result.metrics.viewport.h === 480);
    ok('openWeb eval', result.steps[0].result === 42);
    ok('openWeb click', result.steps[1].result.ok === true);
    ok('openWeb tap/key', result.steps[3].action === 'tap' && result.steps[4].action === 'key');
    ok('openWeb input effect', result.steps[5].result.taps === 1 && result.steps[5].result.keys === 'ArrowUp', JSON.stringify(result.steps[5].result));
    ok('openWeb metrics rect', result.metrics.nodes['#box'] && result.metrics.nodes['#box'].rect.w > 0);
    ok('openWeb screenshot', fs.existsSync(shot) && sim.isPng(fs.readFileSync(shot)));
    ok('openWeb captures versioned DOM visual context', result.visual_context.schema === 'ntvgraph.visual-context.v1' && result.visual_context.source === 'browser-dom');
    ok('visual context contains roles, normalized bounds and broken image evidence', result.visual_context.elements.some((item) => item.role === 'button' && item.label === 'Start' && item.bbox.length === 4) && result.visual_context.checks.broken_image_count === 1);
    ok('visual context JSON artifact is persisted', fs.existsSync(evidence) && JSON.parse(fs.readFileSync(evidence, 'utf8')).visual_context.schema === 'ntvgraph.visual-context.v1');
    const evidenceAgent = new Agent({ vfs: new VirtualFS('visual-evidence-test', dir), cwd: dir, config: {} });
    const evidenceText = await evidenceAgent.executeTool('read_visual_evidence', { path: '/visual-context.json' });
    ok('read_visual_evidence exposes structure to text-only models', evidenceText.includes('VISUAL CONTEXT') && evidenceText.includes('button') && evidenceText.includes('bbox=') && evidenceText.includes('not pixel-level vision'));
    if (IdeAgent) {
      const ideEvidenceAgent = new IdeAgent({ vfs: new IdeVfs('ide-visual-evidence-test', dir), cwd: dir, config: {} });
      const ideEvidenceText = await ideEvidenceAgent.executeTool('read_visual_evidence', { path: '/visual-context.json' });
      ok('IDE reader exposes the same model-agnostic visual evidence', ideEvidenceText.includes('ntvgraph.visual-context.v1') && ideEvidenceText.includes('button') && ideEvidenceText.includes('Screenshot:'), ideEvidenceText.slice(0, 250));
    }

    const failureShot = path.join(dir, 'failure.png');
    let failedRun;
    try {
      await sim.openWeb({
        serve: dir,
        chrome,
        width: 320,
        height: 480,
        wait: 150,
        metrics: ['#box'],
        shotOnFailure: failureShot,
        evidence: path.join(dir, 'failure-context.json'),
        actions: [{ type: 'assert', code: 'document.querySelector("#missing") !== null' }],
      });
    } catch (error) {
      failedRun = error.simulation;
    }
    ok('openWeb failure includes structured evidence', failedRun && failedRun.ok === false && failedRun.steps.length === 1 && failedRun.metrics.nodes['#box']);
    ok('openWeb failure captures valid screenshot', failedRun && failedRun.screenshot && fs.existsSync(failureShot) && sim.isPng(fs.readFileSync(failureShot)));
    ok('failure evidence persists screenshot and structured context', failedRun && failedRun.evidence && fs.existsSync(failedRun.evidence.path) && JSON.parse(fs.readFileSync(failedRun.evidence.path, 'utf8')).visual_context.schema === 'ntvgraph.visual-context.v1');

    if (ideSim) {
      let ideFailedRun;
      try {
        await ideSim.openWeb({
          serve: dir,
          chrome,
          width: 320,
          height: 480,
          wait: 100,
          evidence: path.join(dir, 'ide-failure-context.json'),
          actions: [{ type: 'assert', code: 'false' }],
        });
      } catch (error) {
        ideFailedRun = error.simulation;
      }
      const ideAutoFailureShot = path.join(dir, 'ide-failure-context.failure.png');
      ok('IDE simulation captures screenshot on assertion failure', ideFailedRun && ideFailedRun.ok === false && fs.existsSync(ideAutoFailureShot) && ideSim.isPng(fs.readFileSync(ideAutoFailureShot)));
    }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
