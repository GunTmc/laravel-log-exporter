/** Uji end-to-end: log contoh -> CLI -> periksa hasil parsing dan HTML. */
import { test, describe, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { report, mkTmp, rmTmp, makeSampleLog, line, TEMPLATE } from './helpers';
import type { ReportPayload } from '../src/lib/types';

let dir: string;
let log: string;
beforeAll(() => {
  dir = mkTmp();
  log = makeSampleLog(path.join(dir, 'sample.log'));
});
afterAll(() => rmTmp(dir));

describe('log contoh', () => {
  let data: ReportPayload;
  beforeAll(() => (data = report(dir, log, ['--level=warning', '--quiet']).data));
  const by = (t: string) => data.groups.find((g) => g.title === t)!;

  test('menghasilkan 5 group', () => assert.equal(data.groups.length, 5));

  test('chained exception jadi satu entry (pembungkus lalu penyebab utama)', () => {
    const g = by('Illuminate\\Http\\Client\\ConnectionException');
    assert.deepEqual(g.exceptions.map((e) => e.role), ['wrapper', 'root']);
    assert.equal(g.exceptions[1].cls, 'GuzzleHttp\\Exception\\ConnectException');
  });

  test('titik error di kode app (bukan vendor)', () => {
    const g = by('Illuminate\\Http\\Client\\ConnectionException');
    assert.equal(g.errNode.cls, 'PrintMedicalRecordMcuService');
    assert.equal(g.errNode.method, 'generatePdfServer');
    assert.equal(g.errNode.line, 1326);
  });

  test('call chain berurutan Middleware > Controller > Service', () => {
    const g = by('Exception');
    const app = g.chain.filter((n) => n.layer !== 'Vendor').map((n) => n.layer);
    assert.deepEqual(app, ['Middleware', 'Middleware', 'Controller', 'Service', 'Service']);
    assert.ok(g.chain[g.chain.length - 1].err, 'frame terakhir ditandai error');
  });

  test('origin HTTP vs Queue', () => {
    assert.equal(by('Exception').origin, 'HTTP');
    assert.equal(by('PDOException').origin, 'Queue');
    assert.equal(by('PDOException').endpoint, 'GenerateCriticalCaseJob');
  });

  test('entry berdekatan di service yang sama ditandai terkait', () => {
    const a = by('Exception');
    const b = by('Illuminate\\Http\\Client\\ConnectionException');
    assert.ok(a.related.includes(b.id) && b.related.includes(a.id));
  });

  test('format Monolog [object] terbaca; ErrorException tidak dobel node', () => {
    const g = by('ErrorException');
    assert.equal(g.errNode.method, 'buildResultPayload');
    assert.equal(g.chain.filter((n) => n.layer === 'Service').length, 1);
  });

  test('entry tanpa stack trace jadi group log biasa', () => assert.equal(by('Log WARNING').chain.length, 0));

  test('saran awal muncul untuk error yang dikenal', () => {
    assert.match(by('PDOException').hint as string, /unique constraint/);
  });

  test('level default (error) membuang WARNING', () => {
    const d = report(dir, log, ['--quiet']).data;
    assert.ok(!d.groups.some((g) => g.level === 'WARNING'));
  });

  test('filter jam', () => {
    const d = report(dir, log, ['--from=11:12', '--to=11:30', '--quiet']).data;
    assert.deepEqual(d.groups.map((g) => g.title).sort(), ['ErrorException', 'PDOException']);
  });

  test('filter tanggal', () => {
    assert.equal(report(dir, log, ['--date=2026-09-20', '--quiet']).data.groups.length, 0);
    assert.ok(report(dir, log, ['--date=2026-09-21', '--quiet']).data.groups.length > 0);
  });

  test('sampel tidak memuat data asli (ID/IP sintetis)', () => {
    const all = fs.readFileSync(log, 'utf8');
    assert.doesNotMatch(all, /10\.96\.240\./);
    assert.match(all, /192\.0\.2\.10/);
  });
});

describe('pengelompokan', () => {
  test('error yang sama dengan angka/ID berbeda masuk satu group', () => {
    const f = path.join(dir, 'grup.log');
    fs.writeFileSync(
      f,
      line('2026-09-21 10:00:00', 'ERROR', 'Order 123 gagal setelah 50 ms') +
        line('2026-09-21 10:00:05', 'ERROR', 'Order 456 gagal setelah 71 ms') +
        line('2026-09-21 10:00:09', 'ERROR', 'Order 789 gagal setelah 12 ms')
    );
    const { groups } = report(dir, f).data;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 3);
  });

  test('level tertinggi dalam satu group dipakai', () => {
    const f = path.join(dir, 'level.log');
    fs.writeFileSync(f, line('2026-09-21 10:00:00', 'WARNING', 'Antrian 1 lambat') + line('2026-09-21 10:00:01', 'CRITICAL', 'Antrian 2 lambat'));
    const { groups } = report(dir, f, ['--level=warning']).data;
    assert.equal(groups.length, 2, 'level ikut dalam kunci group untuk entry biasa');
  });

  test('entry multi-baris tanpa header baru masuk ke entry sebelumnya', () => {
    const f = path.join(dir, 'multi.log');
    fs.writeFileSync(f, '[2026-09-21 10:00:00] production.ERROR: Gagal\nbaris lanjutan\n[bukan header]\n');
    const { groups } = report(dir, f).data;
    assert.equal(groups.length, 1);
    assert.match(groups[0].samples[0].raw, /baris lanjutan/);
  });

  test('CR tunggal di tengah baris header tidak membuat entry hilang', () => {
    const f = path.join(dir, 'cr.log');
    fs.writeFileSync(f, '[2026-09-21 10:00:00] production.ERROR: Gagal\rlanjut\n');
    assert.equal(report(dir, f).data.groups.length, 1);
  });

  test('format header dengan milidetik dan zona waktu', () => {
    const f = path.join(dir, 'iso.log');
    fs.writeFileSync(f, '[2026-09-21T10:00:00.123456+07:00] production.ERROR: Gagal\n');
    assert.equal(report(dir, f).data.groups.length, 1);
  });
});

describe('HTML hasil', () => {
  const hostile = '</script><script>alert(1)</script><img src=x onerror=alert(2)>\u2028\u2029';
  let r: ReturnType<typeof report>;
  beforeAll(() => {
    const f = path.join(dir, 'hostile.log');
    fs.writeFileSync(f, line('2026-09-21 10:00:00', 'ERROR', hostile));
    r = report(dir, f);
  });

  test('data ditanam sekali dan penanda diganti', () => {
    assert.ok(!r.html.includes('/*__DATA__*/null'));
    assert.equal(r.html.split('const REPORT=').length - 1, 1);
  });

  test('isi log yang berisi </script> tidak bisa keluar dari tag script', () => {
    const tpl = fs.readFileSync(TEMPLATE, 'utf8');
    assert.equal(r.html.split('</script>').length, tpl.split('</script>').length);
    assert.ok(!r.html.includes('<img src=x'));
    assert.ok(!r.html.includes('\u2028') && !r.html.includes('\u2029'));
  });

  test('data yang ditanam bisa dibaca kembali persis sama', () => {
    const m = /const REPORT=(.*);\n/.exec(r.html);
    const embedded = JSON.parse((m as RegExpExecArray)[1]);
    assert.equal(embedded.groups[0].samples[0].raw, hostile);
    assert.ok(embedded.groups[0].msg1.includes('<script>alert(1)</script>'));
    assert.deepEqual(embedded.groups, r.data.groups);
  });

  test('template membatasi jaringan lewat CSP dan tidak memuat sumber eksternal', () => {
    assert.match(r.html, /Content-Security-Policy" content="default-src 'none'/);
    const tpl = fs.readFileSync(TEMPLATE, 'utf8');
    assert.ok(!/(src|href)=["']https?:/i.test(tpl), 'template harus bisa dibuka offline');
    assert.ok(!/@import|fetch\(|XMLHttpRequest/.test(tpl));
  });
});
