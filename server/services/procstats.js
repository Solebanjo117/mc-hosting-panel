import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { IS_WINDOWS } from '../config.js';

/**
 * CPU y RAM de los procesos de Java, sin dependencias nativas.
 * Windows: una sola llamada a PowerShell para todos los PID (wmic ya no existe en Windows 11).
 * Linux:   /proc/<pid>/stat.
 */

const previous = new Map(); // pid -> { cpuMs, at }

function readWindows(pids) {
  return new Promise((resolve) => {
    const script =
      `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ` +
      `ForEach-Object { "$($_.Id) $([int64]$_.TotalProcessorTime.TotalMilliseconds) $($_.WorkingSet64)" }`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        const out = new Map();
        if (!err) {
          for (const line of stdout.split(/\r?\n/)) {
            const [pid, cpuMs, mem] = line.trim().split(/\s+/).map(Number);
            if (pid) out.set(pid, { cpuMs, memBytes: mem });
          }
        }
        resolve(out);
      }
    );
  });
}

function readLinux(pids) {
  const out = new Map();
  const ticks = 100;
  const page = 4096;
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const cpuMs = ((Number(fields[11]) + Number(fields[12])) / ticks) * 1000;
      out.set(pid, { cpuMs, memBytes: Number(fields[21]) * page });
    } catch {
      /* el proceso terminó */
    }
  }
  return out;
}

export async function getStats(pids) {
  if (!pids.length) return new Map();
  const raw = IS_WINDOWS ? await readWindows(pids) : readLinux(pids);
  const now = Date.now();
  const cores = os.cpus().length || 1;
  const result = new Map();
  for (const [pid, { cpuMs, memBytes }] of raw) {
    const prev = previous.get(pid);
    let cpu = 0;
    if (prev && now > prev.at) cpu = Math.max(0, ((cpuMs - prev.cpuMs) / (now - prev.at) / cores) * 100);
    previous.set(pid, { cpuMs, at: now });
    result.set(pid, { cpu: Math.round(cpu * 10) / 10, memoryMb: Math.round(memBytes / 1024 / 1024) });
  }
  for (const pid of previous.keys()) if (!raw.has(pid)) previous.delete(pid);
  return result;
}

export function systemInfo() {
  return {
    platform: process.platform,
    cpuModel: os.cpus()[0]?.model || 'CPU',
    cores: os.cpus().length,
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    hostname: os.hostname(),
  };
}
