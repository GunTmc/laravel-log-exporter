/** Perkakas bersama untuk test. Proses anak memakai Bun yang sama dengan yang menjalankan test. */
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ReportPayload } from '../src/lib/types';

const SRC = path.join(import.meta.dir, '..', 'src');

const CLI = path.join(SRC, 'alogreport.ts');
const TEMPLATE = path.join(SRC, 'template.html');
const MAKE_SAMPLE = path.join(import.meta.dir, 'make-sample-log.ts');

/** Versi di package.json terdekat di atas folder ini (yang di root repo). */
function readPackageVersion(): string {
  for (let dir = import.meta.dir; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).version;
  }
  throw new Error('package.json tidak ditemukan');
}
const PKG_VERSION = readPackageVersion();

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'alogreport-test-'));
const rmTmp = (dir: string): void => fs.rmSync(dir, { recursive: true, force: true });

/** Jalankan CLI; hasilnya { status, stdout, stderr }. */
function cli(args: string[], opts: { cwd?: string } = {}): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd, encoding: 'utf8' });
}

/** Jalankan CLI dan harapkan berhasil; kembalikan hasil parsing (--json) beserta HTML-nya. */
function report(dir: string, logs: string | string[], args: string[] = []): { data: ReportPayload; html: string; stderr: string } {
  const json = path.join(dir, 'data.json');
  const html = path.join(dir, 'report.html');
  const r = cli([...([] as string[]).concat(logs), '--json=' + json, '--out=' + html, ...args]);
  if (r.status !== 0) throw new Error(`CLI gagal (${r.status}): ${r.stderr}`);
  return { data: JSON.parse(fs.readFileSync(json, 'utf8')), html: fs.readFileSync(html, 'utf8'), stderr: r.stderr };
}

/** Buat log contoh sintetis (format produksi) di `file`. */
function makeSampleLog(file: string): string {
  const r = spawnSync(process.execPath, [MAKE_SAMPLE, '--out=' + file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || 'gagal membuat log contoh');
  return file;
}

/** Satu entry log tanpa stack trace. */
const line = (ts: string, level: string, msg: string): string => `[${ts}] production.${level}: ${msg}\n`;

export { CLI, TEMPLATE, PKG_VERSION, mkTmp, rmTmp, cli, report, makeSampleLog, line };
