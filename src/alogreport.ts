#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { readLines } from './lib/reader';
import { parseEntry } from './lib/parser';
import { Aggregator } from './lib/aggregate';
import type { GroupLimits } from './lib/aggregate';
import { rank, tsToSec, parseClock, parseSize, parseIntOpt, parsePositiveOpt, makeMasker } from './lib/util';
import type { ReportMeta, ReportPayload } from './lib/types';

/** Versi dari package.json terdekat di atas file ini (di repo dan di image Docker: satu tingkat di atas src/). */
function readVersion(): string {
  for (let dir = import.meta.dir; ; dir = path.dirname(dir)) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    } catch (_) {
      /* tidak ada di folder ini; naik satu tingkat */
    }
    if (dir === path.dirname(dir)) return 'tidak diketahui';
  }
}
const VERSION = readVersion();

const HELP = `
alogreport ${VERSION}: buat laporan HTML dari log Laravel (streaming, aman untuk file >100 MB)

Pemakaian:
  alogreport <file.log|file.log.gz> [file lain ...] [opsi]

Opsi:
  --level=error        level minimum yang dimasukkan (debug|info|notice|warning|error|critical|alert|emergency). Default: error
  --from=08:00         hanya entry mulai jam ini (HH:MM atau HH:MM:SS)
  --to=17:00           hanya entry sampai jam ini
  --date=2026-09-21    hanya entry pada tanggal ini (berguna jika satu file memuat beberapa hari)
  --tail=50MB          baca hanya 50 MB terakhir dari file (tidak untuk .gz)
  --samples=3          jumlah sampel raw per group (1 pertama + sisanya terbaru). Default: 3
  --max-occ=500        jumlah waktu kejadian yang disimpan per group. Default: 500
  --max-groups=2000    jumlah group maksimal; entry dari group baru sesudahnya diabaikan (dan dicatat). Default: 2000
  --max-mb=10          batas ukuran data di HTML; sampel dikurangi otomatis bila lewat. Default: 10
  --mask               samarkan email, NIK 16 digit, nomor HP, dan token (JWT/Bearer) sebelum diproses
  --mask-uuid          samarkan juga UUID (otomatis mengaktifkan --mask)
  --out=report.html    file keluaran. Default: report.html
  --mode=600           izin file keluaran (oktal). Default: 600, karena isi laporan bisa memuat data pasien
  --title="Judul"      judul laporan
  --json=data.json     simpan juga data hasil parsing dalam JSON (untuk debug)
  --template=path      pakai template HTML lain
  --quiet              tanpa progress dan ringkasan (peringatan tetap tampil)
  --version            tampilkan versi
  --help               tampilkan bantuan

Kode keluar: 0 berhasil, 1 gagal saat berjalan (file tidak terbaca, tidak bisa menulis, dll), 2 salah pemakaian.
`;

/* ---------------- argumen ---------------- */
class UsageError extends Error {}

const FLAGS = ['mask', 'mask-uuid', 'quiet', 'help', 'version'] as const;
const VALUES = [
  'level', 'from', 'to', 'date', 'tail', 'samples', 'max-occ', 'max-groups', 'max-mb',
  'out', 'mode', 'title', 'json', 'template',
] as const;

type Options = { [K in (typeof FLAGS)[number]]?: boolean } & { [K in (typeof VALUES)[number]]?: string };

const isFlag = (n: string): n is (typeof FLAGS)[number] => (FLAGS as readonly string[]).includes(n);
const isValue = (n: string): n is (typeof VALUES)[number] => (VALUES as readonly string[]).includes(n);

function parseArgs(argv: string[]): { opts: Options; files: string[] } {
  const opts: Options = {};
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      files.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      files.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).trim();
    if (isFlag(name)) {
      if (eq >= 0) throw new UsageError(`Opsi --${name} tidak memakai nilai`);
      opts[name] = true;
    } else if (isValue(name)) {
      const v = eq >= 0 ? a.slice(eq + 1) : argv[i + 1];
      if (eq < 0) {
        if (v === undefined || v.startsWith('--')) throw new UsageError(`Opsi --${name} butuh nilai`);
        i++;
      }
      if (v === '') throw new UsageError(`Opsi --${name} butuh nilai`);
      opts[name] = v;
    } else {
      throw new UsageError(`Opsi tidak dikenal: --${name}`);
    }
  }
  return { opts, files };
}

/** Path nyata bila file sudah ada (menembus symlink), kalau belum ada path absolutnya saja. */
const realOrResolved = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch (_) {
    return path.resolve(p);
  }
};

/** Tulis lewat file sementara lalu rename, supaya pembaca tidak pernah melihat laporan setengah jadi. */
function writeFileSecure(file: string, data: string, mode: number): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode, flag: 'wx' });
    fs.chmodSync(tmp, mode); // umask hanya bisa mengurangi izin; chmod memastikan nilai persis
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* tidak ada file sementara */
    }
    throw e;
  }
}

const HEADER = /^\[(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:[.,]\d+)?(?:[+-]\d{2}:?\d{2}|Z)?\] ([\w-]+)\.([A-Za-z]+): ?([\s\S]*)$/; // [\s\S], bukan '.', supaya U+2028/U+2029 di pesan tidak membuat entry hilang

async function main(argv: string[]): Promise<void> {
  const { opts, files } = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  if (opts.version) {
    process.stdout.write(VERSION + '\n');
    return;
  }
  if (!files.length) {
    process.stderr.write(HELP);
    process.exitCode = 2;
    return;
  }
  for (const f of files) {
    let st: fs.Stats;
    try {
      st = fs.statSync(f);
    } catch (_) {
      throw new Error(`File tidak ditemukan atau tidak bisa dibaca: ${f}`);
    }
    if (!st.isFile()) throw new Error(`Bukan file biasa: ${f}`);
  }

  const minLevel = (opts.level || 'error').toUpperCase();
  const minRank = rank(minLevel);
  if (minRank < 0) throw new UsageError(`Level tidak dikenal: ${opts.level}`);
  let from: string | null, to: string | null, tail: number;
  try {
    from = opts.from ? parseClock(opts.from, false) : null;
    to = opts.to ? parseClock(opts.to, true) : null;
    tail = opts.tail ? parseSize(opts.tail) : 0;
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  if (from && to && from > to) throw new UsageError(`--from (${from}) tidak boleh lebih besar dari --to (${to})`);
  const date = opts.date || null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UsageError(`Format --date tidak valid: "${date}" (pakai YYYY-MM-DD)`);
  if (opts.mode !== undefined && !/^[0-7]{3,4}$/.test(opts.mode)) throw new UsageError(`Nilai --mode tidak valid: "${opts.mode}" (contoh: 600 atau 640)`);
  let samples: number, maxOcc: number, maxGroups: number, maxBytes: number;
  try {
    samples = opts.samples ? parseIntOpt('samples', opts.samples) : 3;
    maxOcc = opts['max-occ'] ? parseIntOpt('max-occ', opts['max-occ']) : 500;
    maxGroups = opts['max-groups'] ? parseIntOpt('max-groups', opts['max-groups']) : 2000;
    maxBytes = (opts['max-mb'] ? parsePositiveOpt('max-mb', opts['max-mb']) : 10) * 1024 * 1024;
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const fileMode = opts.mode ? parseInt(opts.mode, 8) : 0o600;
  const maxEntry = 256 * 1024; // batas teks per entry (karakter); sisanya dipotong
  const out = opts.out || 'report.html';
  const quiet = !!opts.quiet;
  const mask = opts.mask || opts['mask-uuid'] ? makeMasker({ uuid: !!opts['mask-uuid'] }) : null;

  // jangan pernah menimpa file masukan (mis. salah ketik --out=laravel.log)
  const inputs = new Set(files.map(realOrResolved));
  for (const target of [out, opts.json].filter((t): t is string => !!t)) {
    if (inputs.has(realOrResolved(target))) throw new UsageError(`Keluaran tidak boleh sama dengan file masukan: ${target}`);
  }

  const tplPath = opts.template || path.join(import.meta.dir, 'template.html');
  let tpl: string;
  try {
    tpl = fs.readFileSync(tplPath, 'utf8');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    throw new Error(`Template tidak bisa dibaca: ${tplPath} (${err.code || err.message})`);
  }
  const marker = '/*__DATA__*/null';
  if (tpl.indexOf(marker) < 0) throw new Error(`Template tidak memuat penanda ${marker}: ${tplPath}`);

  const warnings: string[] = [];
  const agg = new Aggregator({ samples, maxOcc, maxGroups });
  const stats = { entries: 0, bytes: 0, parseErrors: 0, truncatedLines: 0 };
  const t0 = Date.now();

  /* ---------------- state machine per entry ---------------- */
  interface Entry {
    ts: number;
    level: string;
    parts: string[];
    size: number;
    truncated: boolean;
  }
  let cur: Entry | null = null;
  const flush = (): void => {
    if (!cur) return;
    let text = cur.parts.length === 1 ? cur.parts[0] : cur.parts.join('\n');
    if (cur.truncated) text += '\n…[entry dipotong]';
    if (mask) text = mask(text);
    try {
      const p = parseEntry(text);
      agg.add(p, cur.ts, cur.level, text);
    } catch (e) {
      stats.parseErrors++;
    }
    cur = null;
  };

  const onLine = (line: string): void => {
    // pra-cek murah: header entry diawali "[YYYY-MM-"
    if (line.charCodeAt(0) === 91 && line.charCodeAt(5) === 45 && line.charCodeAt(8) === 45) {
      const m = HEADER.exec(line);
      if (m) {
        flush();
        stats.entries++;
        const level = m[4].toUpperCase();
        // filter murah dari header saja; entry yang tidak lolos dibuang tanpa diparse
        if (rank(level) < minRank) return;
        if (date && m[1] !== date) return;
        if (from && m[2] < from) return;
        if (to && m[2] > to) return;
        cur = { ts: tsToSec(m[1], m[2]), level, parts: [m[5]], size: m[5].length, truncated: false };
        return;
      }
    }
    if (cur) {
      if (cur.size < maxEntry) {
        cur.parts.push(line);
        cur.size += line.length + 1;
      } else {
        cur.truncated = true;
      }
    }
  };

  /* ---------------- baca file ---------------- */
  const isTTY = !!process.stderr.isTTY && !quiet;
  for (const f of files) {
    const name = path.basename(f);
    if (tail && /\.gz$/i.test(f)) warnings.push(`--tail diabaikan untuk ${name}: file .gz harus dibaca dari awal`);
    const res = await readLines(
      f,
      {
        tail,
        onProgress: isTTY ? (pct) => process.stderr.write(`\r  membaca ${name}: ${pct}%   `) : undefined,
      },
      onLine
    );
    flush();
    stats.bytes += res.bytes;
    stats.truncatedLines += res.truncatedLines;
    if (isTTY) process.stderr.write('\n');
  }

  if (!stats.entries) warnings.push('tidak ada entry berformat log Laravel ("[YYYY-MM-DD HH:MM:SS] env.LEVEL: ...") di file masukan; periksa apakah file-nya benar');
  if (stats.parseErrors) warnings.push(`${stats.parseErrors} entry gagal diparse dan dilewati`);
  if (stats.truncatedLines) warnings.push(`${stats.truncatedLines} baris melebihi batas panjang dan dipotong`);
  if (agg.dropped) warnings.push(`${agg.dropped} entry dari group baru diabaikan karena batas --max-groups=${maxGroups} tercapai (persempit filter atau naikkan batas)`);

  /* ---------------- serialisasi + batas ukuran ---------------- */
  const meta: ReportMeta = {
    version: VERSION,
    files: files.map((f) => path.basename(f)),
    title: opts.title || 'Laravel Log Report',
    generatedAt: new Date().toISOString(),
    minLevel,
    from,
    to,
    date,
    tail: tail || null,
    entries: stats.entries,
    kept: agg.kept,
    dropped: agg.dropped,
    maxGroups,
    bytes: stats.bytes,
    seconds: 0,
    reduced: false,
    masked: !!mask,
    samples,
    maxOcc,
  };

  let limits: Required<GroupLimits> = { maxOcc, rawMax: 60000, samples };
  let json = '';
  let payload: ReportPayload = { meta, groups: [] };
  for (let i = 0; i < 8; i++) {
    payload = { meta, groups: agg.toGroups(limits) };
    json = JSON.stringify(payload);
    if (json.length <= maxBytes) break;
    meta.reduced = true;
    limits = {
      maxOcc: Math.max(20, Math.floor(limits.maxOcc / 2)),
      rawMax: Math.max(4000, Math.floor(limits.rawMax / 2)),
      samples: Math.max(1, limits.samples - 1),
    };
  }
  meta.seconds = Math.round(((Date.now() - t0) / 1000) * 10) / 10;
  payload.meta = meta;
  json = JSON.stringify(payload);
  if (json.length > maxBytes) warnings.push(`data laporan ${(json.length / 1048576).toFixed(1)} MB masih di atas --max-mb=${maxBytes / 1048576} meski sudah dikurangi (terlalu banyak group; persempit filter)`);

  if (opts.json) writeFileSecure(opts.json, JSON.stringify(payload, null, 2), fileMode);

  // aman ditanam di <script>
  const safe = json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = tpl.replace(marker, () => safe).replace('<title>Laravel Log Report</title>', () => `<title>${escapeHtml(meta.title)}</title>`);
  writeFileSecure(out, html, fileMode);

  if (!quiet) {
    const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
    console.error(
      `Selesai dalam ${meta.seconds} dtk\n` +
        `  dibaca   : ${stats.entries} entry (${mb(stats.bytes)} MB)\n` +
        `  dipakai  : ${agg.kept} entry (level >= ${minLevel}${from ? ', dari ' + from : ''}${to ? ', sampai ' + to : ''}${date ? ', tanggal ' + date : ''})\n` +
        `  group    : ${payload.groups.length}\n` +
        `  keluaran : ${out} (${mb(Buffer.byteLength(html))} MB)\n` +
        `  memori   : puncak ${Math.round(process.resourceUsage().maxRSS / 1024)} MB (RSS)` +
        (meta.reduced ? '\n  catatan  : data dikurangi otomatis agar di bawah ' + maxBytes / 1024 / 1024 + ' MB' : '')
    );
  }
  for (const w of warnings) console.error('peringatan: ' + w);
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (s: string): string => String(s).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);

function handleError(e: unknown): void {
  if (e instanceof UsageError) {
    console.error(`Salah pemakaian: ${e.message}\nJalankan dengan --help untuk daftar opsi.`);
    process.exitCode = 2;
    return;
  }
  // pesan singkat untuk kesalahan input; stack trace hanya bila ALOGREPORT_DEBUG=1
  const err = e as Error | undefined;
  console.error('Gagal: ' + (process.env.ALOGREPORT_DEBUG && err && err.stack ? err.stack : err && err.message ? err.message : e));
  process.exitCode = 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(handleError);
}

export { parseArgs, UsageError };
