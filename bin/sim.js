#!/usr/bin/env node
/**
 * @fileoverview Simulation harness for web and Android testing
 *
 * @module sim
 */

'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const DEFAULT_TIMEOUT = 15000;
const MAX_BUFFER = 50 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseViewport(value) {
  const m = String(value || '').trim().match(/^(\d+)x(\d+)$/i);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  return { width, height };
}

function mimeFor(file) {
  return MIME[path.extname(String(file)).toLowerCase()] || 'application/octet-stream';
}

function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findChrome(explicit) {
  if (explicit && fileExists(explicit)) return explicit;
  const env = process.env.CHROME_PATH || process.env.CHROME_BIN;
  if (env && fileExists(env)) return env;
  const candidates = [];
  if (process.platform === 'win32') {
    for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!root) continue;
      candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return candidates.find(fileExists) || null;
}

function findAdb(explicit) {
  if (explicit && fileExists(explicit)) return explicit;
  const env = process.env.ADB || process.env.ADB_PATH;
  if (env && fileExists(env)) return env;
  const names = process.platform === 'win32' ? ['adb.exe', 'adb'] : ['adb'];
  const roots = [];
  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (process.env[key]) roots.push(process.env[key]);
  }
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const props = path.join(dir, 'local.properties');
    try {
      const text = fs.readFileSync(props, 'utf8');
      const m = text.match(/^\s*sdk\.dir\s*=\s*(.+)\s*$/m);
      if (m) roots.push(m[1].replace(/\\\\/g, '\\').trim());
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  if (process.platform === 'darwin') roots.push(path.join(os.homedir(), 'Library', 'Android', 'sdk'));
  roots.push(path.join(os.homedir(), 'Android', 'Sdk'));
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, 'platform-tools', name);
      if (fileExists(candidate)) return candidate;
    }
  }
  return names[0];
}

function execFileP(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: MAX_BUFFER, windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr, code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0 });
    });
  });
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function httpJson(port, pathname, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
    req.on('error', reject);
  });
}

function safeTarget(root, urlPath) {
  const clean = decodeURIComponent(String(urlPath || '/').split('?')[0].split('#')[0]);
  const target = path.resolve(root, '.' + (clean.startsWith('/') ? clean : '/' + clean));
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function startStaticServer(root, options = {}) {
  const base = path.resolve(root);
  if (!fs.existsSync(base)) return Promise.reject(new Error(`serve dir tidak ada: ${root}`));
  const host = options.host || '127.0.0.1';
  const port = Number(options.port) || 0;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const target = safeTarget(base, req.url || '/');
      if (!target) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const sendFile = (file) => {
        fs.readFile(file, (err, data) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': mimeFor(file), 'Cache-Control': 'no-store' });
          if (req.method === 'HEAD') res.end();
          else res.end(data);
        });
      };
      fs.stat(target, (err, st) => {
        if (err || !st.isFile()) {
          if (!err && st.isDirectory()) return sendFile(path.join(target, 'index.html'));
          if (!path.extname(target)) return sendFile(path.join(base, 'index.html'));
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
          return;
        }
        sendFile(target);
      });
    });
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        server,
        port: actual,
        host,
        root: base,
        url: `http://${host}:${actual}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

class MiniWS {
  constructor(url) {
    this.url = url;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.handshaken = false;
    this.frags = [];
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.closed = false;
  }

  connect(timeout = 10000) {
    return new Promise((resolve, reject) => {
      let u;
      try {
        u = new URL(this.url);
      } catch (e) {
        reject(e);
        return;
      }
      if (u.protocol !== 'ws:') {
        reject(new Error(`hanya ws:// yang didukung: ${u.protocol}`));
        return;
      }
      const key = crypto.randomBytes(16).toString('base64');
      let settled = false;
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        try {
          this.sock.destroy();
        } catch {}
        done(reject, new Error('WebSocket handshake timeout'));
      }, timeout);
      this.sock = net.connect(Number(u.port) || 80, u.hostname, () => {
        this.sock.write(
          `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
            `Host: ${u.host}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n'
        );
      });
      this.sock.setNoDelay(true);
      this.sock.on('data', (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        if (!this.handshaken) {
          const idx = this.buf.indexOf('\r\n\r\n');
          if (idx < 0) return;
          const head = this.buf.slice(0, idx).toString('latin1');
          this.buf = this.buf.slice(idx + 4);
          if (!/^HTTP\/1\.1 101\b/.test(head)) {
            try {
              this.sock.destroy();
            } catch {}
            done(reject, new Error(`WebSocket handshake gagal: ${head.split('\r\n')[0]}`));
            return;
          }
          this.handshaken = true;
          done(resolve);
          this._drain();
          return;
        }
        this._drain();
      });
      this.sock.on('error', (e) => {
        if (!settled) done(reject, e);
        this.onerror?.(e);
      });
      this.sock.on('close', () => {
        this.closed = true;
        this.onclose?.();
      });
    });
  }

  _drain() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const hi = this.buf.readUInt32BE(2);
        const lo = this.buf.readUInt32BE(6);
        len = hi * 0x100000000 + lo;
        off = 10;
      }
      let mask = null;
      if (masked) {
        if (this.buf.length < off + 4) return;
        mask = this.buf.slice(off, off + 4);
        off += 4;
      }
      if (this.buf.length < off + len) return;
      let payload = this.buf.slice(off, off + len);
      this.buf = this.buf.slice(off + len);
      if (masked) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      if (opcode === 8) {
        this.close();
        return;
      }
      if (opcode === 9) {
        this._sendFrame(10, payload);
        continue;
      }
      if (opcode === 10) continue;
      if (opcode === 1 || opcode === 0) {
        this.frags.push(payload);
        if (fin) {
          const text = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
          this.onmessage?.(text);
        }
      }
    }
  }

  _sendFrame(opcode, payload) {
    if (this.closed || !this.sock || this.sock.destroyed) return;
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const mask = crypto.randomBytes(4);
    let head;
    if (data.length < 126) {
      head = Buffer.from([0x80 | opcode, 0x80 | data.length]);
    } else if (data.length < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | opcode;
      head[1] = 0x80 | 126;
      head.writeUInt16BE(data.length, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | opcode;
      head[1] = 0x80 | 127;
      head.writeUInt32BE(Math.floor(data.length / 0x100000000), 2);
      head.writeUInt32BE(data.length >>> 0, 6);
    }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, masked]));
  }

  send(text) {
    this._sendFrame(1, Buffer.from(String(text), 'utf8'));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this._sendFrame(8, Buffer.alloc(0));
    } catch {}
    try {
      this.sock?.destroy();
    } catch {}
  }
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = new MiniWS(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.connected = false;
  }

  async connect(timeout = 10000) {
    this.ws.onmessage = (raw) => this._onMessage(raw);
    this.ws.onclose = () => {
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    };
    await this.ws.connect(timeout);
    this.connected = true;
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const item = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(item.timer);
      if (msg.error) item.reject(new Error(msg.error.message || 'CDP error'));
      else item.resolve(msg.result);
      return;
    }
    if (msg.method) {
      for (const fn of this.listeners) {
        try {
          fn(msg);
        } catch {}
      }
    }
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  send(method, params = {}, timeout = DEFAULT_TIMEOUT) {
    if (!this.connected) return Promise.reject(new Error('CDP belum terkoneksi'));
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.connected = false;
    this.ws.close();
  }
}

function stopChrome(proc, userDir) {
  if (proc && proc.pid) {
    if (process.platform === 'win32') {
      return execFileP('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { timeout: 5000 }).then(() => {
        if (userDir) {
          try {
            fs.rmSync(userDir, { recursive: true, force: true });
          } catch {}
        }
      });
    }
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
  if (userDir) {
    try {
      fs.rmSync(userDir, { recursive: true, force: true });
    } catch {}
  }
  return Promise.resolve();
}

async function launchChrome(options = {}) {
  const chrome = findChrome(options.chrome);
  if (!chrome) throw new Error('Chrome/Edge tidak ditemukan. Set CHROME_PATH atau pakai --chrome <path>.');
  const width = Number(options.width) || 430;
  const height = Number(options.height) || 880;
  const timeout = Number(options.timeout) || DEFAULT_TIMEOUT;
  const port = await findFreePort();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyusha-sim-chrome-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  const proc = spawn(chrome, args, { stdio: 'ignore', windowsHide: true });
  let lastError = null;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) break;
    try {
      const list = await httpJson(port, '/json/list', 1000);
      const page = Array.isArray(list) ? list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl) : null;
      if (page) return { proc, port, userDir, chrome, wsUrl: page.webSocketDebuggerUrl, width, height };
    } catch (e) {
      lastError = e;
    }
    await sleep(200);
  }
  await stopChrome(proc, userDir);
  throw new Error(`Chrome headless gagal start${lastError ? ': ' + lastError.message : ''}`);
}

function collectMetricsExpr(selectors) {
  return `(function(sels){
    var out={viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},doc:{scrollW:document.documentElement.scrollWidth,scrollH:document.documentElement.scrollHeight,clientW:document.documentElement.clientWidth,clientH:document.documentElement.clientHeight},nodes:{}};
    sels.forEach(function(sel){
      var e=document.querySelector(sel);
      if(!e){out.nodes[sel]=null;return;}
      var r=e.getBoundingClientRect(), cs=getComputedStyle(e);
      out.nodes[sel]={
        rect:{x:r.x,y:r.y,w:r.width,h:r.height,top:r.top,right:r.right,bottom:r.bottom,left:r.left},
        display:cs.display,position:cs.position,flex:cs.flex,overflow:cs.overflow,
        zIndex:cs.zIndex,borderRadius:cs.borderRadius,
        margin:cs.margin,padding:cs.padding,gap:cs.gap,
        minHeight:cs.minHeight,height:cs.height,width:cs.width,
        background:cs.backgroundColor,color:cs.color,fontSize:cs.fontSize,
        scrollW:e.scrollWidth,scrollH:e.scrollHeight,clientW:e.clientWidth,clientH:e.clientHeight,
        text:String(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,160)
      };
    });
    var cv=document.querySelector('canvas');
    if(cv) out.canvas={bitmapW:cv.width,bitmapH:cv.height,rect:{w:cv.getBoundingClientRect().width,h:cv.getBoundingClientRect().height}};
    return out;
  })(${JSON.stringify(selectors || [])})`;
}

function collectVisualContextExpr() {
  return `(function(){
    var vw=innerWidth,vh=innerHeight,all=Array.from(document.querySelectorAll('body *'));
    var tracked=[],ids=new Map(),roles={BUTTON:'button',A:'link',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox',IMG:'image',NAV:'navigation',MAIN:'main',HEADER:'banner',FOOTER:'contentinfo',FORM:'form',DIALOG:'dialog'};
    function directText(el){return Array.from(el.childNodes).filter(function(n){return n.nodeType===Node.TEXT_NODE}).map(function(n){return n.nodeValue||''}).join(' ').replace(/\\s+/g,' ').trim()}
    function selector(el){
      if(el.id)return '#'+CSS.escape(el.id);
      var parts=[];
      while(el&&el.nodeType===1&&el!==document.body){
        var part=el.tagName.toLowerCase();
        if(el.parentElement){var same=Array.from(el.parentElement.children).filter(function(x){return x.tagName===el.tagName});if(same.length>1)part+=':nth-of-type('+(same.indexOf(el)+1)+')'}
        parts.unshift(part);el=el.parentElement;
      }
      return 'body>'+parts.join('>');
    }
    all.forEach(function(el){
      var tag=el.tagName,role=el.getAttribute('role')||roles[tag]||null;
      var label=el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('alt')||'';
      if(!label&&el.labels&&el.labels.length)label=Array.from(el.labels).map(function(x){return x.innerText||''}).join(' ');
      var text=directText(el);
      if(!text&&/^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(tag))text=String(el.innerText||el.value||'').replace(/\\s+/g,' ').trim();
      var semantic=!!role||/^(H[1-6]|IMG|SVG|LABEL)$/.test(tag)||!!label||!!text;
      if(!semantic||tracked.length>=300)return;
      var rect=el.getBoundingClientRect(),cs=getComputedStyle(el),id='vc-'+tracked.length;
      var visible=rect.width>0&&rect.height>0;
      try{visible=visible&&el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})}catch{visible=visible&&cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)!==0}
      var onScreen=rect.bottom>0&&rect.right>0&&rect.top<vh&&rect.left<vw;
      var parent=el.parentElement, parentId=null;
      while(parent&&!parentId){parentId=ids.get(parent)||null;parent=parent.parentElement}
      var item={id:id,parent_id:parentId,selector:selector(el),tag:tag.toLowerCase(),role:role||tag.toLowerCase(),label:String(label||text).replace(/\\s+/g,' ').trim().slice(0,120),text:text.slice(0,200),bbox:[+(rect.x/vw).toFixed(4),+(rect.y/vh).toFixed(4),+(rect.width/vw).toFixed(4),+(rect.height/vh).toFixed(4)],visible:visible,on_screen:onScreen};
      if(tag==='IMG'){item.src=String(el.currentSrc||el.src||'').slice(0,240);item.image_complete=!!el.complete;item.image_loaded=!!(el.complete&&el.naturalWidth>0)}
      if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1){item.content_overflow={scroll_width:el.scrollWidth,client_width:el.clientWidth,scroll_height:el.scrollHeight,client_height:el.clientHeight,css_overflow:cs.overflow}}
      ids.set(el,id);tracked.push(item);
    });
    var imgs=tracked.filter(function(x){return x.tag==='img'}),broken=imgs.filter(function(x){return x.image_complete&&!x.image_loaded});
    return {schema:'ntvgraph.visual-context.v1',source:'browser-dom',capture:{viewport:{width:vw,height:vh},url:location.href,title:document.title},summary:{component_count:tracked.length,by_role:tracked.reduce(function(o,x){o[x.role]=(o[x.role]||0)+1;return o},{})},checks:{horizontal_document_overflow:document.documentElement.scrollWidth>vw,broken_image_count:broken.length,visible_interactive_count:tracked.filter(function(x){return /^(button|link|textbox|combobox|checkbox|radio|switch|menuitem)$/.test(x.role)&&x.visible}).length},findings:broken.map(function(x){return {type:'broken-image-candidate',element_id:x.id,selector:x.selector,src:x.src,bbox:x.bbox,evidence:'img.complete && naturalWidth === 0'}}),elements:tracked};
  })()`;
}

function writeJsonArtifact(file, value) {
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return abs;
}

function siblingScreenshotPath(file, suffix = '') {
  const parsed = path.parse(path.resolve(file));
  const stem = parsed.ext.toLowerCase() === '.json' ? parsed.name : parsed.base;
  return path.join(parsed.dir, `${stem}${suffix}.png`);
}

const KEY_SPECS = {
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
};

function keySpec(value) {
  const raw = String(value);
  if (KEY_SPECS[raw]) return { ...KEY_SPECS[raw] };
  if (raw.length === 1) {
    const key = raw;
    const upper = key.toUpperCase();
    if (/[a-z]/i.test(key)) return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key };
    if (/\d/.test(key)) return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key };
    return { key, code: '', keyCode: key.charCodeAt(0), text: key };
  }
  return { key: raw, code: raw, keyCode: 0 };
}

async function dispatchTap(cdp, x, y, timeout) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }, timeout);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, timeout);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, timeout);
}

async function dispatchKey(cdp, value, timeout) {
  const spec = keySpec(value);
  const base = {
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.keyCode,
    nativeVirtualKeyCode: spec.keyCode,
  };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(spec.text != null ? { text: spec.text } : {}) }, timeout);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, timeout);
}

function actionExpr(action) {
  if (action.type === 'click') {
    return `(function(){
      var e=document.querySelector(${JSON.stringify(action.selector)});
      if(!e) return {ok:false,missing:true};
      if(e.scrollIntoView) e.scrollIntoView({block:'center',inline:'center'});
      e.click();
      return {ok:true,tag:e.tagName,text:String(e.innerText||e.value||'').replace(/\\s+/g,' ').trim().slice(0,120)};
    })()`;
  }
  return action.code;
}

async function evalValue(cdp, expression, timeout) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    timeout
  );
  if (result && result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'evaluation error';
    throw new Error(desc);
  }
  return result ? result.result?.value : undefined;
}

async function openWeb(options = {}) {
  let server = null;
  let chrome = null;
  let cdp = null;
  let url = options.url;
  let consoleLog = [];
  let errors = [];
  let steps = [];
  let viewport = null;
  let visualContext = null;
  let activeAction = null;
  let activeActionRecorded = false;
  const started = Date.now();
  try {
    if (options.serve) {
      server = await startStaticServer(options.serve);
      if (!url) url = server.url;
    }
    if (!url) throw new Error('URL atau --serve <dir> wajib diisi.');
    const target = await launchChrome(options);
    chrome = target;
    cdp = new CDP(target.wsUrl);
    await cdp.connect(options.timeout);
    cdp.onEvent((msg) => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args || []).map((a) => (a.value != null ? a.value : a.description || a.type));
        consoleLog.push({ type: msg.params.type, text: args.join(' ').slice(0, 400) });
        while (consoleLog.length > 50) consoleLog.shift();
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        errors.push(String(d.exception?.description || d.text || 'exception').slice(0, 500));
        while (errors.length > 50) errors.shift();
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry || {};
        if (e.level === 'error') {
          errors.push(String(e.text || '').slice(0, 500));
          while (errors.length > 50) errors.shift();
        }
      }
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    viewport = {
      width: target.width,
      height: target.height,
      screenWidth: target.width,
      screenHeight: target.height,
      deviceScaleFactor: 1,
      mobile: true,
    };
    await cdp.send('Emulation.setDeviceMetricsOverride', viewport);
    await cdp.send('Page.navigate', { url }, options.timeout);
    const deadline = Date.now() + (Number(options.timeout) || DEFAULT_TIMEOUT);
    while (Date.now() < deadline) {
      try {
        if ((await evalValue(cdp, 'document.readyState', 3000)) === 'complete') break;
      } catch {}
      await sleep(150);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', viewport);
    await sleep(100);
    if (options.wait) await sleep(Number(options.wait) || 0);
    steps = [];
    for (const action of options.actions || []) {
      activeAction = action;
      activeActionRecorded = false;
      if (action.type === 'wait') {
        await sleep(Math.max(0, Number(action.ms) || 0));
        steps.push({ action: 'wait', ms: Number(action.ms) || 0 });
        activeActionRecorded = true;
      } else if (action.type === 'click') {
        const value = await evalValue(cdp, actionExpr(action), options.timeout);
        steps.push({ action: 'click', selector: action.selector, result: value });
        activeActionRecorded = true;
        if (!value || value.ok !== true) throw new Error(`selector tidak ditemukan: ${action.selector}`);
        await sleep(250);
      } else if (action.type === 'tap') {
        await dispatchTap(cdp, action.x, action.y, options.timeout);
        steps.push({ action: 'tap', x: action.x, y: action.y });
        activeActionRecorded = true;
        await sleep(100);
      } else if (action.type === 'key') {
        await dispatchKey(cdp, action.key, options.timeout);
        steps.push({ action: 'key', key: action.key });
        activeActionRecorded = true;
        await sleep(100);
      } else if (action.type === 'eval') {
        const value = await evalValue(cdp, action.code, options.timeout);
        steps.push({ action: 'eval', code: action.code, result: value });
        activeActionRecorded = true;
      } else if (action.type === 'assert') {
        try {
          const value = await evalValue(cdp, action.code, options.timeout);
          steps.push({ action: 'assert', code: action.code, result: value, ok: !!value });
          activeActionRecorded = true;
          if (!value) throw new Error(`assertion gagal: ${action.code} (hasil: ${JSON.stringify(value)})`);
        } catch (error) {
          if (!activeActionRecorded) {
            steps.push({ action: 'assert', code: action.code, ok: false, error: String(error && error.message || error) });
            activeActionRecorded = true;
          }
          throw error;
        }
      }
      activeAction = null;
    }
    const metrics = await evalValue(cdp, collectMetricsExpr(options.metrics), options.timeout);
    visualContext = await evalValue(cdp, collectVisualContextExpr(), options.timeout);
    visualContext.capture.captured_at = new Date().toISOString();
    const page = await evalValue(
      cdp,
      '(function(){return {url:location.href,title:document.title,readyState:document.readyState}})()',
      3000
    );
    let screenshot = null;
    if (options.shot || options.evidence) {
      const abs = path.resolve(options.shot || siblingScreenshotPath(options.evidence));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, options.timeout);
      const buf = Buffer.from(shot.data || '', 'base64');
      fs.writeFileSync(abs, buf);
      screenshot = { path: abs, bytes: buf.length };
    }
    const result = {
      ok: true,
      command: 'web',
      ms: Date.now() - started,
      page,
      viewport: { width: target.width, height: target.height },
      steps,
      metrics,
      visual_context: visualContext,
      console: consoleLog,
      errors,
      screenshot,
    };
    if (options.evidence) {
      result.evidence = { path: path.resolve(options.evidence) };
      writeJsonArtifact(options.evidence, result);
    }
    return result;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (activeAction && !activeActionRecorded) {
      steps.push({
        action: activeAction.type,
        ...(activeAction.selector ? { selector: activeAction.selector } : {}),
        ...(activeAction.code ? { code: activeAction.code } : {}),
        error: failure.message,
      });
    }
    if ((options.shotOnFailure || options.evidence) && cdp) {
      const failureShotPath = options.shotOnFailure || siblingScreenshotPath(options.evidence, '.failure');
      const abs = path.resolve(failureShotPath);
      let screenshot = null;
      let screenshotError = null;
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, options.timeout);
        const buf = Buffer.from(shot.data || '', 'base64');
        if (!isPng(buf)) throw new Error('Chrome returned an invalid PNG');
        fs.writeFileSync(abs, buf);
        screenshot = { path: abs, bytes: buf.length };
      } catch (captureError) {
        screenshotError = String(captureError && captureError.message || captureError);
      }
      let page = null;
      let metrics = null;
      try {
        page = await evalValue(
          cdp,
          '(function(){return {url:location.href,title:document.title,readyState:document.readyState}})()',
          3000
        );
        metrics = await evalValue(cdp, collectMetricsExpr(options.metrics || []), 3000);
        visualContext = await evalValue(cdp, collectVisualContextExpr(), options.timeout);
        visualContext.capture.captured_at = new Date().toISOString();
      } catch {}
      failure.simulation = {
        ok: false,
        command: 'web',
        error: failure.message,
        ms: Date.now() - started,
        page: page || (url ? { url } : null),
        viewport: viewport ? { width: viewport.width, height: viewport.height } : null,
        steps,
        metrics,
        visual_context: visualContext,
        console: consoleLog,
        errors,
        screenshot,
        ...(screenshotError ? { screenshotError } : {}),
      };
      if (options.evidence) {
        try {
          failure.simulation.evidence = { path: path.resolve(options.evidence) };
          writeJsonArtifact(options.evidence, failure.simulation);
        } catch (evidenceError) {
          failure.simulation.evidenceError = String(evidenceError && evidenceError.message || evidenceError);
        }
      }
    }
    throw failure;
  } finally {
    try {
      cdp?.close();
    } catch {}
    if (chrome) await stopChrome(chrome.proc, chrome.userDir);
    if (server) await server.close();
  }
}

function parseWebArgs(argv) {
  const out = {
    url: null,
    serve: null,
    width: 430,
    height: 880,
    wait: 0,
    timeout: DEFAULT_TIMEOUT,
    chrome: null,
    shot: null,
    shotOnFailure: null,
    evidence: null,
    actions: [],
    metrics: [],
    help: false,
  };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} butuh nilai`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--url') {
      out.url = need(i, a);
      i++;
    } else if (a === '--serve') {
      out.serve = need(i, a);
      i++;
    } else if (a === '--viewport') {
      const v = parseViewport(need(i, a));
      if (!v) throw new Error('--viewport harus format 430x880');
      out.width = v.width;
      out.height = v.height;
      i++;
    } else if (a === '--width') {
      out.width = Number(need(i, a));
      i++;
    } else if (a === '--height') {
      out.height = Number(need(i, a));
      i++;
    } else if (a === '--wait') {
      out.wait = Number(need(i, a));
      i++;
    } else if (a === '--timeout') {
      out.timeout = Number(need(i, a));
      i++;
    } else if (a === '--chrome') {
      out.chrome = need(i, a);
      i++;
    } else if (a === '--shot') {
      out.shot = need(i, a);
      i++;
    } else if (a === '--shot-on-failure') {
      out.shotOnFailure = need(i, a);
      i++;
    } else if (a === '--evidence') {
      out.evidence = need(i, a);
      i++;
    } else if (a === '--click') {
      out.actions.push({ type: 'click', selector: need(i, a) });
      i++;
    } else if (a === '--eval') {
      out.actions.push({ type: 'eval', code: need(i, a) });
      i++;
    } else if (a === '--assert') {
      out.actions.push({ type: 'assert', code: need(i, a) });
      i++;
    } else if (a === '--tap') {
      const parts = String(need(i, a)).split(',').map(Number);
      if (parts.length !== 2 || !parts.every(Number.isFinite)) throw new Error('--tap harus format x,y');
      out.actions.push({ type: 'tap', x: parts[0], y: parts[1] });
      i++;
    } else if (a === '--key') {
      out.actions.push({ type: 'key', key: need(i, a) });
      i++;
    } else if (a === '--step-wait') {
      out.actions.push({ type: 'wait', ms: Number(need(i, a)) });
      i++;
    } else if (a === '--metrics') {
      for (const sel of String(need(i, a)).split(',')) {
        const s = sel.trim();
        if (s) out.metrics.push(s);
      }
      i++;
    } else if (a.startsWith('--')) {
      throw new Error(`flag tidak dikenal: ${a}`);
    } else if (!out.url) {
      out.url = a;
    } else {
      throw new Error(`argumen tak terduga: ${a}`);
    }
  }
  return out;
}

async function runAdb(sub, argv) {
  const adb = findAdb();
  const call = (args, opts) => execFileP(adb, args, opts);
  const result = async (args, opts) => {
    const r = await call(args, opts);
    if (r.error && r.code !== 0) throw new Error(r.stderr || r.error.message || `adb gagal (${args.join(' ')})`);
    return r;
  };
  if (sub === 'path') return { ok: true, command: 'adb', adb, exists: fileExists(adb) };
  if (sub === 'devices') {
    const r = await result(['devices', '-l']);
    const lines = String(r.stdout || '').split(/\r?\n/).slice(1).filter((l) => l.trim());
    const devices = lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      return { serial: parts[0], state: parts[1], detail: parts.slice(2).join(' ') };
    });
    return { ok: true, command: 'adb', adb, devices, raw: String(r.stdout || '').trim() };
  }
  if (sub === 'install') {
    const apk = argv[0];
    if (!apk) throw new Error('usage: sim adb install <file.apk>');
    const r = await result(['install', '-r', path.resolve(apk)]);
    return { ok: true, command: 'adb', action: 'install', apk: path.resolve(apk), output: String(r.stdout || r.stderr || '').trim() };
  }
  if (sub === 'launch' || sub === 'stop') {
    const pkg = argv[0];
    if (!pkg) throw new Error(`usage: sim adb ${sub} <package>`);
    const args = sub === 'launch'
      ? ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']
      : ['shell', 'am', 'force-stop', pkg];
    const r = await result(args);
    return { ok: true, command: 'adb', action: sub, package: pkg, output: String(r.stdout || r.stderr || '').trim() };
  }
  if (sub === 'tap') {
    const [x, y] = argv;
    if (x == null || y == null) throw new Error('usage: sim adb tap <x> <y>');
    const r = await result(['shell', 'input', 'tap', String(x), String(y)]);
    return { ok: true, command: 'adb', action: 'tap', x: Number(x), y: Number(y), output: String(r.stdout || r.stderr || '').trim() };
  }
  if (sub === 'swipe') {
    const [x1, y1, x2, y2, ms = 300] = argv;
    if (x1 == null || y1 == null || x2 == null || y2 == null) throw new Error('usage: sim adb swipe <x1> <y1> <x2> <y2> [ms]');
    const r = await result(['shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(ms)]);
    return { ok: true, command: 'adb', action: 'swipe', output: String(r.stdout || r.stderr || '').trim() };
  }
  if (sub === 'key') {
    const code = argv[0];
    if (!code) throw new Error('usage: sim adb key <keycode>');
    const r = await result(['shell', 'input', 'keyevent', String(code)]);
    return { ok: true, command: 'adb', action: 'key', key: String(code), output: String(r.stdout || r.stderr || '').trim() };
  }
  if (sub === 'log') {
    const lines = Number(argv[0]) || 200;
    const r = await result(['logcat', '-d', '-t', String(lines)]);
    return { ok: true, command: 'adb', action: 'log', lines, output: String(r.stdout || '').trim().split(/\r?\n/).slice(-lines).join('\n') };
  }
  if (sub === 'shot') {
    const out = path.resolve(argv[0] || path.join(os.tmpdir(), `niyusha-adb-${Date.now()}.png`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const raw = await call(['exec-out', 'screencap', '-p'], { encoding: 'buffer' });
    let buf = raw.stdout;
    if (!isPng(buf)) {
      const remote = `/sdcard/niyusha-sim-${Date.now()}.png`;
      await result(['shell', 'screencap', '-p', remote]);
      await result(['pull', remote, out]);
      await call(['shell', 'rm', '-f', remote]);
      buf = fs.readFileSync(out);
    } else {
      fs.writeFileSync(out, buf);
    }
    if (!isPng(buf)) throw new Error('screenshot bukan PNG valid');
    return { ok: true, command: 'adb', action: 'shot', path: out, bytes: buf.length };
  }
  throw new Error(`subcommand adb tidak dikenal: ${sub || '(kosong)'}`);
}

function help() {
  return [
    'Niyusha simulation harness (zero-dep)',
    '',
    'Web:',
    '  node bin/sim.js web <url> [--viewport 430x880] [--serve <dir>] [--wait 800]',
    '      [--click <selector>] [--tap x,y] [--key Space] [--eval <js>]',
    '      [--metrics "sel1,sel2"] [--shot out.png] [--shot-on-failure failure.png]',
    '      [--evidence visual-context.json]',
    '      [--assert "document.body !== null"]',
    '  node bin/sim.js serve <dir> [--port 8765] [--host 127.0.0.1]',
    '  node bin/sim.js shot <url> <out.png> [--viewport 430x880]',
    '',
    'Android (ADB):',
    '  node bin/sim.js adb path',
    '  node bin/sim.js adb devices',
    '  node bin/sim.js adb install <app.apk>',
    '  node bin/sim.js adb launch <package>',
    '  node bin/sim.js adb stop <package>',
    '  node bin/sim.js adb shot [out.png]',
    '  node bin/sim.js adb tap <x> <y>',
    '  node bin/sim.js adb swipe <x1> <y1> <x2> <y2> [ms]',
    '  node bin/sim.js adb key <keycode>',
    '  node bin/sim.js adb log [lines]',
    '',
    'Options: --chrome <path> --timeout <ms> --help',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const rest = argv.slice(1);
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(help());
    return;
  }
  if (cmd === 'web' || cmd === 'shot') {
    let opts;
    if (cmd === 'shot') {
      const url = rest[0] && !rest[0].startsWith('--') ? rest.shift() : null;
      const shot = rest[0] && !rest[0].startsWith('--') ? rest.shift() : null;
      opts = parseWebArgs(rest);
      if (url) opts.url = url;
      if (shot) opts.shot = shot;
      if (!opts.shot) opts.shot = path.join(os.tmpdir(), `niyusha-shot-${Date.now()}.png`);
    } else {
      opts = parseWebArgs(rest);
    }
    if (opts.help) {
      console.log(help());
      return;
    }
    const result = await openWeb(opts);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (cmd === 'serve') {
    const dir = rest.find((x) => !x.startsWith('--')) || '.';
    let port = 0;
    let host = '127.0.0.1';
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--port') port = Number(rest[++i]) || 0;
      else if (rest[i] === '--host') host = rest[++i] || host;
    }
    const server = await startStaticServer(dir, { port, host });
    console.log(JSON.stringify({ ok: true, command: 'serve', url: server.url, port: server.port, host, root: server.root }, null, 2));
    const stop = async () => {
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  if (cmd === 'adb') {
    const result = await runAdb(rest[0], rest.slice(1));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`command tidak dikenal: ${cmd}\n\n${help()}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(JSON.stringify({
      ok: false,
      error: e && e.message ? e.message : String(e),
      ...(e && e.simulation ? { simulation: e.simulation } : {}),
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_TIMEOUT,
  parseViewport,
  mimeFor,
  isPng,
  findChrome,
  findAdb,
  findFreePort,
  startStaticServer,
  launchChrome,
  openWeb,
  parseWebArgs,
  runAdb,
  help,
  main,
  MiniWS,
  CDP,
};
