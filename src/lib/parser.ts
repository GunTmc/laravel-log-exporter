import * as path from 'path';
import { classify, relPath } from './layers';
import { norm, truncate } from './util';
import { hintFor } from './hints';
import type { AppNode, Callee, ChainNode, ErrNode, ExceptionInfo, Frame, GroupInfo, Layer, Origin, ParsedEntry, ParsedException } from './types';

/* ------------------------------------------------------------------ *
 *  Pola frame stack trace PHP
 *    #12 /path/File.php(97): Kelas->method()
 *    #3 [internal function]: Kelas->method()
 *    #61 {main}
 * ------------------------------------------------------------------ */
const FRAME_FILE = /^#\d+ (.*?)\((\d+)\): (.*)$/;
const FRAME_INT = /^#\d+ \[internal function\]: (.*)$/;
const FRAME_MAIN = /^#\d+ \{main\}\s*$/;

// Format A (Laravel report / PHP __toString):  Kelas: pesan in /file.php:123\nStack trace:\n#0 ...
const HEAD_A = /^([\w\\]+): ([\s\S]*) in (\S+):(\d+)\s*$/;
// Format B (Monolog/Laravel default):  {"exception":"[object] (Kelas(code: 0): pesan at /file.php:123)\n[stacktrace]\n#0 ..."}
const RE_B_SRC = /\[object\] \(([\w\\]+)\(code: -?\d+\): ([\s\S]*?) at (\S+?):(\d+)\)\n\[stacktrace\]\n/.source;

/* ------------------------------------------------------------------ *
 *  Parsing exception
 * ------------------------------------------------------------------ */
function parseA(text: string): ParsedException[] | null {
  const parts = text.split(/\n(?=Next [\w\\]+: )/);
  const out: ParsedException[] = [];
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    if (i > 0) part = part.slice(5); // buang "Next "
    const idx = part.indexOf('\nStack trace:');
    if (idx < 0) {
      if (i === 0) return null;
      continue;
    }
    const m = HEAD_A.exec(part.slice(0, idx));
    if (!m) {
      if (i === 0) return null;
      continue;
    }
    out.push({ cls: m[1], msg: m[2], file: m[3], line: +m[4], trace: part.slice(idx + 13) });
  }
  // Di format A, exception "previous" (penyebab utama) tercetak lebih dulu. Balik supaya pembungkus (outer) di depan.
  return out.length ? out.reverse() : null;
}

function parseB(text: string): ParsedException[] | null {
  const re = new RegExp(RE_B_SRC, 'g');
  const ms: Array<{ m: RegExpExecArray; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ms.push({ m, end: re.lastIndex });
  if (!ms.length) return null;
  return ms.map((x, i) => ({
    cls: x.m[1],
    msg: x.m[2],
    file: x.m[3],
    line: +x.m[4],
    trace: text.slice(x.end, i + 1 < ms.length ? ms[i + 1].m.index : text.length),
  }));
}

function cleanMessage(text: string): string {
  const first = text.split('\n')[0].replace(/\s+(\{.*\}|\[\])\s*$/, '');
  return truncate(first, 400);
}

/** text = isi entry setelah "env.LEVEL: " (baris pertama + baris lanjutan). */
function parseEntry(text: string): ParsedEntry {
  let excs: ParsedException[] | null = null;
  if (text.indexOf('\nStack trace:') > 0 && /^[\w\\]+: /.test(text)) excs = parseA(text);
  if (!excs && text.indexOf('[object] (') >= 0) excs = parseB(text);
  if (excs) return { kind: 'exception', excs };
  return { kind: 'message', message: cleanMessage(text) };
}

function parseFrames(trace: string): Frame[] {
  const out: Frame[] = [];
  const lines = trace.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.charCodeAt(0) !== 35) continue; // '#'
    let m = FRAME_FILE.exec(ln);
    if (m) {
      out.push({ kind: 'file', file: m[1], line: +m[2], call: m[3] });
      continue;
    }
    m = FRAME_INT.exec(ln);
    if (m) {
      out.push({ kind: 'internal', call: m[1] });
      continue;
    }
    if (FRAME_MAIN.test(ln)) out.push({ kind: 'main' });
  }
  return out;
}

/** "Kelas->method()" / "Kelas::method()" / "fungsi()" -> {cls,type,method} */
function calleeOf(call: string): Callee {
  const m = /^([^\s(]+?)(->|::)(.+?)\(.*\)$/.exec(call);
  if (m) return { cls: m[1], type: m[2], method: m[3] };
  return { cls: '', type: '', method: call.replace(/\(.*\)$/, '') };
}

const shortCls = (c: string): string => String(c).replace(/^.*\\/, '');
const shortMethod = (m: string): string => String(m).replace(/^.*\\/, '');

/** Teks pemanggilan sebuah frame; frame `{main}` tidak punya. */
const callOf = (f: Frame | undefined): string | undefined => (f && f.kind !== 'main' ? f.call : undefined);

/* ------------------------------------------------------------------ *
 *  Fingerprint cepat (tanpa membangun call chain penuh)
 * ------------------------------------------------------------------ */
function firstAppSite(exc: ParsedException): { file: string; line: number } | null {
  if (classify(exc.file) !== 'Vendor') return { file: exc.file, line: exc.line };
  const t = exc.trace;
  let pos = 0;
  while (pos < t.length) {
    let nl = t.indexOf('\n', pos);
    if (nl < 0) nl = t.length;
    const ln = t.slice(pos, nl);
    pos = nl + 1;
    if (ln.charCodeAt(0) !== 35) continue;
    const m = FRAME_FILE.exec(ln);
    if (m && classify(m[1]) !== 'Vendor') return { file: m[1], line: +m[2] };
  }
  return null;
}

/**
 * Kunci group = kelas exception terluar + pesan ternormalisasi + frame app pertama (file:baris).
 * Untuk entry tanpa stack trace: level + pesan ternormalisasi.
 */
function quickKey(p: ParsedEntry, level: string): string {
  if (p.kind === 'message') return 'log|' + level + '|' + norm(p.message);
  const outer = p.excs[0];
  const s = firstAppSite(outer) || firstAppSite(p.excs[p.excs.length - 1]);
  const where = s ? relPath(s.file) + ':' + s.line : relPath(outer.file) + ':' + outer.line;
  return outer.cls + '|' + norm(outer.msg) + '|' + where;
}

/* ------------------------------------------------------------------ *
 *  Call chain: dari titik masuk (request/job/command) sampai titik error
 *
 *  Baris trace "#i file(line): call" berarti: kode di file:line memanggil `call`.
 *  Jadi fungsi yang sedang berjalan di file:line adalah callee dari frame berikutnya (i+1).
 * ------------------------------------------------------------------ */
interface Site {
  file: string | null;
  line: number;
  fn: Callee | null;
  text?: string; // untuk frame tanpa file: [internal function] atau {main}
}

function buildChain(exc: ParsedException, fr: Frame[], msg1: string): { nodes: ChainNode[]; k: number } {
  const callee = (i: number): Callee | null => {
    const c = callOf(fr[i]);
    return c ? calleeOf(c) : null;
  };
  const sites: Site[] = [];
  // Titik exception dilempar. Untuk ErrorException (warning/notice PHP), frame #0 berada di file:baris
  // yang sama (pemanggil handleError), jadi tidak perlu dicatat dua kali.
  const dup = fr[0] && fr[0].kind === 'file' && fr[0].file === exc.file && fr[0].line === exc.line;
  if (!dup) sites.push({ file: exc.file, line: exc.line, fn: callee(0) });
  for (let i = 0; i < fr.length; i++) {
    const f = fr[i];
    if (f.kind === 'file') sites.push({ file: f.file, line: f.line, fn: callee(i + 1) });
    else if (f.kind === 'internal') sites.push({ file: null, line: 0, fn: null, text: f.call });
    else sites.push({ file: null, line: 0, fn: null, text: '{main}' });
  }
  sites.reverse(); // luar -> dalam

  const nodes: ChainNode[] = [];
  for (const s of sites) {
    const layer = classify(s.file);
    if (layer === 'Vendor') {
      const text = s.fn
        ? (s.fn.cls ? s.fn.cls + s.fn.type : '') + s.fn.method
        : s.text || (s.file ? relPath(s.file) + ':' + s.line : '?');
      const last = nodes[nodes.length - 1];
      if (last && last.layer === 'Vendor') {
        last.vendor++;
        if (last.samples.length < 4 && !last.samples.includes(text)) last.samples.push(text);
      } else {
        nodes.push({ layer: 'Vendor', vendor: 1, samples: [text] });
      }
    } else {
      nodes.push({
        layer,
        cls: s.fn && s.fn.cls ? shortCls(s.fn.cls) : path.posix.basename((s.file || '').replace(/\\/g, '/'), '.php'),
        method: s.fn ? shortMethod(s.fn.method) : '',
        line: s.line,
        file: relPath(s.file),
      });
    }
  }

  // Tandai: origin = frame app terdalam, err = tempat exception dilempar
  let k = -1;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].layer !== 'Vendor') {
      k = i;
      break;
    }
  }
  if (k >= 0) nodes[k].origin = true;
  const throwIsApp = classify(exc.file) !== 'Vendor';
  if (throwIsApp && k >= 0) {
    nodes[k].err = true;
  } else if (nodes.length) {
    const e = k >= 0 && nodes[k + 1] && nodes[k + 1].layer === 'Vendor' ? nodes[k + 1] : nodes[nodes.length - 1];
    e.err = true;
    e.note = truncate(msg1, 120);
  }
  return { nodes, k };
}

/* ------------------------------------------------------------------ *
 *  Analisis lengkap (dipanggil sekali per group baru)
 * ------------------------------------------------------------------ */
function analyze(p: ParsedEntry, level: string, key: string): GroupInfo {
  if (p.kind === 'message') {
    return {
      title: 'Log ' + level,
      msg1: p.message,
      fp: key,
      exceptions: [{ cls: 'Log ' + level, role: 'root', file: '', line: 0, msg: p.message }],
      chain: [],
      errNode: { layer: 'Other', cls: '(log biasa, tanpa stack trace)', method: '', line: 0, file: '' },
      layers: [],
      origin: 'Unknown',
      endpoint: '-',
      errClass: '-',
      hint: hintFor(p.message),
      svc: new Set(),
    };
  }

  const excs = p.excs;
  const frames = excs.map((e) => parseFrames(e.trace));
  let di = 0;
  for (let i = 0; i < excs.length; i++) if (frames[i].length >= frames[di].length) di = i; // trace terdalam
  const deep = excs[di];
  const fr = frames[di];
  const outer = excs[0];
  const msg1 = truncate(outer.msg.split('\n')[0], 400);

  const { nodes, k } = buildChain(deep, fr, msg1);
  const app = nodes.filter((n): n is AppNode => n.layer !== 'Vendor');
  const layers: Layer[] = [...new Set(app.map((n) => n.layer))];

  // Titik error
  let errNode: ErrNode;
  if (k >= 0) {
    const n = nodes[k] as AppNode;
    errNode = { layer: n.layer, cls: n.cls, method: n.method, line: n.line, file: n.file };
  } else {
    errNode = {
      layer: 'Vendor',
      cls: path.posix.basename(deep.file.replace(/\\/g, '/'), '.php'),
      method: '',
      line: deep.line,
      file: relPath(deep.file),
    };
  }

  // Asal request
  let hasWorker = false;
  let hasRouting = false;
  let hasConsole = false;
  for (const f of fr) {
    const c = callOf(f) || '';
    if (!hasWorker && c.indexOf('Illuminate\\Queue\\Worker') >= 0) hasWorker = true;
    else if (!hasRouting && c.indexOf('Illuminate\\Routing\\') >= 0) hasRouting = true;
    else if (!hasConsole && c.indexOf('Illuminate\\Console\\') >= 0) hasConsole = true;
  }
  let origin: Origin = 'Unknown';
  if (hasWorker || (layers.includes('Job') && !hasRouting)) origin = 'Queue';
  else if (hasRouting || layers.includes('Controller') || layers.includes('Middleware')) origin = 'HTTP';
  else if (layers.includes('Command') || hasConsole) origin = 'Console';

  // Endpoint atau job
  let endpoint = '';
  const find = (l: Layer) => app.find((n) => n.layer === l);
  const controller = find('Controller');
  const job = find('Job');
  if (controller) endpoint = controller.cls;
  else if (job) endpoint = job.cls;
  else if (origin === 'Queue') {
    const jm = /([\w\\]*Job)\b/.exec(outer.msg);
    endpoint = jm ? shortCls(jm[1]) : '';
  }
  if (!endpoint && find('Command')) endpoint = 'artisan';
  if (!endpoint) endpoint = '(tidak diketahui)';

  const exceptions: ExceptionInfo[] = excs.map((e, i) => ({
    cls: e.cls,
    role: i === excs.length - 1 ? ('root' as const) : ('wrapper' as const),
    file: relPath(e.file),
    line: e.line,
    msg: truncate(e.msg, 2000),
  }));

  return {
    title: outer.cls,
    msg1,
    fp: key,
    exceptions,
    chain: nodes,
    errNode,
    layers,
    origin,
    endpoint,
    errClass: errNode.cls,
    hint: hintFor(excs.map((e) => e.cls + ' ' + e.msg).join('\n')),
    svc: new Set(app.filter((n) => n.layer === 'Service' || n.layer === 'Repository' || n.layer === 'Job').map((n) => n.cls)),
  };
}

export { parseEntry, quickKey, analyze, parseFrames, calleeOf };
