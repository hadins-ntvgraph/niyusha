'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TUI, stripAnsi } = require('../bin/tui');
const config = require('../bin/config');
const ideRoot = path.join(__dirname, '..', '..', 'ide-engine', 'tui');
const hasIdeEngine = fs.existsSync(path.join(ideRoot, 'bin', 'tui.js'));
const suites = [['TUI', TUI, config.PROVIDERS]];

if (hasIdeEngine) {
  suites.push([
    'IDE',
    require(path.join(ideRoot, 'bin', 'tui')).TUI,
    require(path.join(ideRoot, 'bin', 'config')).PROVIDERS,
  ]);
}

function render(tui, method, ...args) {
  return stripAnsi(tui[method](...args).join('\n'));
}

for (const [label, UI, providers] of suites) {
  const instance = Object.create(UI.prototype);
  instance.cfg = () => ({ theme: 'dark-blue', provider: 'openrouter', model: 'model' });
  instance.settingsIdx = 0;
  instance.themeIdx = 0;
  instance.customSlotStep = 0;
  instance.customSlotData = {};
  instance.customSlotBuffer = '';

  const theme = render(instance, '_bodyTheme', 100, 30);
  assert.ok(theme.includes('select') && theme.includes('apply') && theme.includes('cancel'), `${label} theme controls are in English`);
  assert.ok(!/\bpilih\b|\bterapkan\b|\bbatal\b|\batau\b/i.test(theme), `${label} theme picker has no Indonesian UI text`);

  const customProvider = render(instance, '_bodyCustomSlot', 100, 30);
  assert.ok(customProvider.includes('Provider name') && customProvider.includes('type here'));
  assert.ok(customProvider.includes('continue/save') && customProvider.includes('delete') && customProvider.includes('cancel'));
  assert.ok(!/\bNama\b|\blangkah\b|\bketik\b|\blanjut\b|\bsimpan\b|\bhapus\b|\bbatal\b/i.test(customProvider), `${label} custom provider screen has no Indonesian UI text`);
  instance.customSlotStep = 2;
  assert.ok(render(instance, '_bodyCustomSlot', 100, 30).includes('Model (optional)'), `${label} optional model label is in English`);

  for (const [id, provider] of Object.entries(providers)) {
    const text = `${provider.name || ''} ${provider.freeNote || ''}`;
    assert.ok(!/\bLokal\b|\bgratis\b|\bperlu\b|\bbutuh\b|\btersedia\b|\binput sendiri\b/i.test(text), `${label} provider metadata for ${id} is in English`);
  }
}

console.log(`PASS Ctrl+S settings screens use English in ${suites.map(([label]) => label).join(' and ')}`);
