/**
 * @fileoverview Command execution and shell management
 *
 * @module runner
 */
'use strict';

const { execFile, spawn } = require('child_process');

// ─── Resolusi shell ────────────────────────────────────────────────
// Pilihan: 'auto' (default) · 'cmd' · 'powershell' · 'pwsh' · 'bash' · 'wsl'.
// Prioritas: opsi eksplisit > env NIYUSHA_SHELL > 'auto'.
// Kalau shell pilihan tidak ada (ENOENT), otomatis fallback ke default sekali
// supaya perintah tetap jalan daripada gagal total.

function isWin() {
  return process.platform === 'win32';
}

function defaultShell() {
  if (isWin()) {
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'], kind: 'powershell' };
  }
  return { file: process.env.SHELL || '/bin/bash', args: ['-lc'], kind: 'bash' };
}

function pickShell(pref) {
  const p = String(pref || process.env.NIYUSHA_SHELL || 'auto').toLowerCase().trim();
  if (!isWin()) {
    if (p === 'bash') return { file: process.env.SHELL || '/bin/bash', args: ['-lc'], kind: 'bash' };
    return defaultShell();
  }
  if (p === 'cmd') return { file: 'cmd.exe', args: ['/d', '/s', '/c'], kind: 'cmd' };
  if (p === 'powershell') return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'], kind: 'powershell' };
  if (p === 'pwsh') return { file: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-Command'], kind: 'powershell' };
  if (p === 'bash') return { file: 'bash.exe', args: ['-lc'], kind: 'bash' };
  if (p === 'wsl') return { file: 'wsl.exe', args: ['--', 'bash', '-lc'], kind: 'wsl' };
  return defaultShell();
}

// cwd UNC WSL (\\wsl.localhost\Ubuntu\home\x atau \\wsl$\Ubuntu\...) → { distro, path }.
function wslCwd(cwd) {
  const m = /^\\\\wsl(?:\.localhost|\$)?\\([^\\]+)(?:\\(.*))?$/i.exec(String(cwd || ''));
  if (!m) return null;
  // UNC \\wsl.localhost\Ubuntu\home\x  →  path Linux absolut /home/x
  const rest = (m[2] || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return { distro: m[1], path: '/' + rest };
}

// Susun file/args akhir. WSL otomatis hanya kalau pref 'auto'/'wsl' dan cwd memang
// UNC WSL — pilihan eksplisit user (mis. 'powershell') tetap dihormati.
function materialize(spec, cmd, cwd, pref) {
  const p = String(pref || process.env.NIYUSHA_SHELL || 'auto').toLowerCase().trim();
  const wsl = wslCwd(cwd);
  if (wsl && (p === 'auto' || p === 'wsl') && spec.kind !== 'wsl') {
    const inner = `cd "${wsl.path}" 2>/dev/null || true; ${cmd}`;
    return { file: 'wsl.exe', args: ['-d', wsl.distro, '--', 'bash', '-lc', inner], cwd: undefined, kind: 'wsl' };
  }
  let command = cmd;
  // PowerShell 5.1 default output ANSI → paksa UTF-8 biar teks non-ASCII tidak rusak.
  // Dibungkus try/catch: [Console] bisa gagal di proses tanpa console (background/server).
  if (spec.kind === 'powershell' && spec.file === 'powershell.exe') {
    command = 'try{[Console]::OutputEncoding=[System.Text.Encoding]::UTF8}catch{};' + command;
  }
  return { file: spec.file, args: [...spec.args, command], cwd, kind: spec.kind };
}

function killTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
      return;
    }
    // Bunuh seluruh process group (shell + anak-anaknya) agar pipe tertutup.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    }, 800).unref?.();
  } catch {}
}

const SAFE_ENV_KEYS = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'windir', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'NUMBER_OF_PROCESSORS', 'OS', 'PROCESSOR_ARCHITECTURE', 'SHELL'];

function cleanEnv(env) {
  const out = {};
  for (const k of SAFE_ENV_KEYS) if (env[k] != null) out[k] = env[k];
  return out;
}

function isDefaultSpec(spec) {
  const d = defaultShell();
  return spec.file === d.file && spec.kind === d.kind;
}

function runCommand(command, { cwd, timeout = 120000, env, signal, jail, shell } = {}) {
  const cmd = String(command == null ? '' : command);
  const maxBuffer = 32 * 1024 * 1024;
  return new Promise((resolve) => {
    if (!cmd.trim()) {
      resolve({ exit: 0, timedOut: false, aborted: false, stdout: '', stderr: '', error: 'empty command', shell: null });
      return;
    }
    if (signal && signal.aborted) {
      resolve({ exit: 130, timedOut: false, aborted: true, stdout: '', stderr: '', error: 'aborted', shell: null });
      return;
    }
    let spec = pickShell(shell);
    let prefArg = shell;
    let child = null;
    let exitTimer = null;
    let gen = 0;
    let retried = false;
    let aborted = false;
    let timedOut = false;
    let done = false;
    let stdout = '';
    let stderr = '';

    const spawnOne = () => {
      const m = materialize(spec, cmd, cwd, prefArg);
      return spawn(m.file, m.args, {
        cwd: m.cwd || process.cwd(),
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
        env: jail ? { ...cleanEnv(process.env), ...(env || {}) } : { ...process.env, ...(env || {}) },
      });
    };

    const finish = (err) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (exitTimer) clearTimeout(exitTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      const exit = aborted ? 130 : timedOut ? 124 : err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({
        exit,
        timedOut,
        aborted,
        stdout,
        stderr,
        error: aborted
          ? 'aborted'
          : timedOut
            ? `timeout after ${timeout}ms`
            : err
              ? err.message
              : null,
        shell: spec.file,
        fellBack: retried,
      });
    };

    const onAbort = () => {
      aborted = true;
      killTree(child);
    };

    const timer = timeout > 0
      ? setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeout)
      : null;
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const attach = (c) => {
      const myGen = ++gen;
      child = c;
      if (c.stdout) c.stdout.on('data', (d) => { if (stdout.length < maxBuffer) stdout += d; });
      if (c.stderr) c.stderr.on('data', (d) => { if (stderr.length < maxBuffer) stderr += d; });
      c.on('error', (err) => {
        // Abaikan event dari child yang sudah digantikan (fallback).
        if (myGen !== gen) return;
        // Shell pilihan tidak ada (ENOENT) → coba default sekali, baru menyerah.
        if (!retried && err && err.code === 'ENOENT' && !isDefaultSpec(spec)) {
          retried = true;
          spec = defaultShell();
          prefArg = 'auto';
          attach(spawnOne());
          return;
        }
        finish(err);
      });
      c.on('close', (code, sig) => {
        // Windows: spawn ENOENT memicu 'error' DAN 'close(-4058)'. Kalau child ini
        // sudah diganti fallback, close-nya diabaikan supaya promise tidak
        // selesai sebelum percobaan fallback benar-benar jalan.
        if (myGen !== gen) return;
        finish(aborted ? null : code ? { code } : sig && !timedOut ? { message: `signal ${sig}` } : null);
      });
      // Fallback penting: 'close' menunggu SEMUA stdio tertutup. Kalau ada
      // grandchild (mis. Gradle daemon / MSBuild) mewarisi pipe stdout, 'close'
      // bisa TIDAK PERNAH menyala → runCommand menggantung, app macet "busy".
      // 'exit' menandakan proses utama sudah keluar; selesaikan setelah jeda
      // singkat agar sisa output sempat ter-flush.
      c.on('exit', (code, sig) => {
        if (myGen !== gen) return;
        const finishErr = aborted ? null : code ? { code } : sig && !timedOut ? { message: `signal ${sig}` } : null;
        exitTimer = setTimeout(() => finish(finishErr), 250);
      });
      if (c.stdin) c.stdin.end();
    };

    attach(spawnOne());
  });
}

function describeShell(pref) {
  const s = pickShell(pref);
  return `${process.platform}/${process.arch} -> ${s.file}`;
}

async function runBackground(command, { cwd, env, shell } = {}) {
  const cmd = String(command == null ? '' : command);
  const spec = pickShell(shell);
  const m = materialize(spec, cmd, cwd, shell);
  // Unix: detached + unref → proses hidup mandiri setelah parent keluar.
  // Windows: detached membuat console app (PowerShell/cmd) langsung exit;
  //           non-detached tetap hidup selama Niyusha jalan & pid valid untuk
  //           liveness check & /kill (taskkill /T /F). Server mati bersama app
  //           lebih aman daripada server yatim.
  const detached = process.platform !== 'win32';
  let child;
  try {
    child = spawn(m.file, m.args, {
      cwd: m.cwd || process.cwd(),
      detached,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
      env: { ...process.env, ...(env || {}) },
    });
  } catch (e) {
    return { pid: 0, command: cmd, alive: false, error: `spawn sync error: ${e.message}`, shell: m.file };
  }
  let spawnErr = null;
  child.on('error', (e) => { spawnErr = e.code || e.message; });
  const pid = child.pid;
  child.unref();
  // Tunggu sebentar lalu cek apakah proses masih hidup (mis. port sudah terpakai → langsung keluar).
  // 1,2s (bukan 0,7s): python/node butuh ~1s untuk bind port di Windows.
  await new Promise((r) => setTimeout(r, 1200));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (!alive && spawnErr) return { pid, command: cmd, alive: false, error: `spawn failed: ${spawnErr}`, shell: m.file };
  return { pid, command: cmd, alive, shell: m.file };
}

module.exports = { runCommand, runBackground, defaultShell, pickShell, materialize, wslCwd, describeShell };
