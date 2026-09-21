import { test, describe } from 'bun:test';
import assert from 'node:assert/strict';
import { classify, relPath } from '../src/lib/layers';
import { hintFor } from '../src/lib/hints';
import { parseEntry } from '../src/lib/parser';

describe('classify', () => {
  const cases: Array<[string | null, string]> = [
    ['/srv/app/app/Http/Middleware/Auth.php', 'Middleware'],
    ['/srv/app/app/Http/Controllers/Api/X.php', 'Controller'],
    ['/srv/app/app/Services/Mcu/Y.php', 'Service'],
    ['/srv/app/app/Repositories/Z.php', 'Repository'],
    ['/srv/app/app/Jobs/J.php', 'Job'],
    ['/srv/app/artisan', 'Command'],
    ['/srv/app/app/Foo/Bar.php', 'Other'],
    ['/srv/app/vendor/laravel/framework/src/Illuminate/Pipeline/Pipeline.php', 'Vendor'],
    ['/srv/api/public/index.php', 'Vendor'],
    [null, 'Vendor'],
  ];
  for (const [file, layer] of cases) test(`${file} -> ${layer}`, () => assert.equal(classify(file), layer));
  test('path Windows', () => assert.equal(classify('C:\\www\\app\\app\\Http\\Controllers\\X.php'), 'Controller'));
  test('kode app di dalam folder yang namanya memuat "vendor" tetap app', () => {
    assert.equal(classify('/srv/vendor-portal/app/Services/X.php'), 'Service');
  });
});

describe('relPath', () => {
  test('memotong sampai root proyek', () => {
    assert.equal(relPath('/usr/share/nginx/html/api/app/Services/X.php'), 'app/Services/X.php');
    assert.equal(relPath('/x/y/vendor/a/b.php'), 'vendor/a/b.php');
    assert.equal(relPath('/x/y/artisan'), 'artisan');
    assert.equal(relPath(''), '');
  });
});

describe('hintFor', () => {
  test('timeout menyebut host tujuan', () => {
    const h = hintFor('cURL error 28: Operation timed out for http://svc.internal:3000/api');
    assert.match(h as string, /svc\.internal:3000/);
  });
  test('unique violation', () => assert.match(hintFor('SQLSTATE[23505]: Unique violation') as string, /unique constraint/));
  test('tidak ada saran untuk error yang tidak dikenal', () => assert.equal(hintFor('sesuatu yang aneh'), null));
});

describe('parseEntry', () => {
  const trace = '\nStack trace:\n#0 /srv/app/app/Services/A.php(10): Foo->bar()\n#1 {main}';
  test('format A: Next mengurutkan pembungkus lebih dulu', () => {
    const p = parseEntry(`Inner\\Cause: akar in /srv/app/app/Services/A.php:5${trace}\n\nNext Outer\\Wrap: bungkus in /srv/app/app/Services/A.php:9${trace}`);
    assert.ok(p.kind === 'exception');
    assert.deepEqual(p.excs.map((e) => e.cls), ['Outer\\Wrap', 'Inner\\Cause']);
  });
  test('format B (Monolog [object])', () => {
    const p = parseEntry('Pesan {"exception":"[object] (App\\\\Boom(code: 0): gagal at /srv/app/app/Services/A.php:7)\n[stacktrace]\n#0 {main}\n"}');
    assert.ok(p.kind === 'exception');
    assert.equal(p.excs[0].line, 7);
  });
  test('tanpa stack trace = pesan biasa; array extra kosong di ujung dibuang', () => {
    const p = parseEntry('Cache miss for key []');
    assert.ok(p.kind === 'message');
    assert.equal(p.message, 'Cache miss for key');
  });
});
