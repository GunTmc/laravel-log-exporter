const RANKS: Record<string, number> = { DEBUG: 0, INFO: 1, NOTICE: 2, WARNING: 3, ERROR: 4, CRITICAL: 5, ALERT: 6, EMERGENCY: 7 };
const rank = (l: string): number => {
  const r = RANKS[String(l).toUpperCase()];
  return r === undefined ? -1 : r;
};

/** Normalisasi pesan supaya error yang sama (beda ID/angka) jatuh ke group yang sama. */
function norm(s: unknown): string {
  return String(s)
    .split('\n')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?/g, '<ip>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?\s?(ms|milliseconds|seconds|s)\b/gi, '<dur>')
    .replace(/\d+/g, '<n>');
}

/** "2026-09-21", "11:11:32" -> detik epoch (dianggap UTC, hanya untuk bucket waktu). */
function tsToSec(d: string, t: string): number {
  return (
    Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), +t.slice(0, 2), +t.slice(3, 5), +t.slice(6, 8)) / 1000
  );
}

/** "08:30" -> "08:30:00" (dari) atau "08:30:59" (sampai). */
function parseClock(str: string, isEnd: boolean): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(str).trim());
  if (!m || +m[1] > 23 || +m[2] > 59 || (m[3] !== undefined && +m[3] > 59)) {
    throw new Error(`Format jam tidak valid: "${str}" (pakai HH:MM atau HH:MM:SS)`);
  }
  const hh = m[1].padStart(2, '0');
  const ss = m[3] !== undefined ? m[3] : isEnd ? '59' : '00';
  return `${hh}:${m[2]}:${ss}`;
}

const SIZE_UNITS: Record<string, number> = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** "50MB" -> byte */
function parseSize(str: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(kb|mb|gb)?$/i.exec(String(str).trim());
  if (!m) throw new Error(`Ukuran tidak valid: "${str}" (contoh: 50MB)`);
  return Math.round(parseFloat(m[1]) * SIZE_UNITS[(m[2] || 'mb').toLowerCase()]);
}

/** Bilangan bulat >= min dari nilai opsi CLI; melempar error yang menyebut nama opsi. */
function parseIntOpt(name: string, str: string, min = 1): number {
  if (!/^\d+$/.test(String(str).trim()) || parseInt(str, 10) < min) {
    throw new Error(`Nilai --${name} tidak valid: "${str}" (harus bilangan bulat >= ${min})`);
  }
  return parseInt(str, 10);
}

/** Bilangan > 0 (boleh desimal) dari nilai opsi CLI. */
function parsePositiveOpt(name: string, str: string): number {
  const n = /^\d+(\.\d+)?$/.test(String(str).trim()) ? parseFloat(str) : NaN;
  if (!(n > 0)) throw new Error(`Nilai --${name} tidak valid: "${str}" (harus bilangan > 0)`);
  return n;
}

/** Penyamaran data sensitif (untuk log data medis). Dijalankan sebelum parsing. */
function makeMasker({ uuid = false }: { uuid?: boolean } = {}): (text: string) => string {
  const rules: Array<[RegExp, string]> = [
    // token dulu, supaya angka di dalamnya tidak dibaca sebagai NIK/nomor HP
    [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '<jwt>'],
    [/\b(Bearer)\s+[A-Za-z0-9._~+/=|-]{16,}/gi, '$1 <token>'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>'],
    [/\b\d{16}\b/g, '<nik>'],
    [/(?:\+62|\b62|\b0)8\d{8,11}\b/g, '<phone>'],
  ];
  if (uuid) rules.push([/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>']);
  return (text: string) => {
    for (let i = 0; i < rules.length; i++) text = text.replace(rules[i][0], rules[i][1]);
    return text;
  };
}

const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

export { rank, norm, tsToSec, parseClock, parseSize, parseIntOpt, parsePositiveOpt, makeMasker, truncate };
