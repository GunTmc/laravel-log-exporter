import { test, describe } from 'bun:test';
import assert from 'node:assert/strict';
import { rank, norm, tsToSec, parseClock, parseSize, parseIntOpt, parsePositiveOpt, makeMasker } from '../src/lib/util';

describe('rank', () => {
  test('urutan level dan huruf besar/kecil', () => {
    assert.ok(rank('debug') < rank('INFO') && rank('INFO') < rank('warning') && rank('warning') < rank('ERROR'));
    assert.equal(rank('emergency'), 7);
  });
  test('level tidak dikenal = -1', () => assert.equal(rank('verbose'), -1));
});

describe('norm', () => {
  test('ID, IP, durasi, dan angka dinormalisasi supaya error sama jatuh ke satu group', () => {
    const a = norm('Timeout after 50023 milliseconds for http://10.0.0.5:3000/x id=720a87bb-1fb7-49bb-98f4-2eab2e84a4c8');
    const b = norm('Timeout after 51000 milliseconds for http://10.0.9.9:3000/x id=00000000-0000-4000-8000-000000000001');
    assert.equal(a, b);
  });
  test('hanya baris pertama yang dipakai', () => assert.equal(norm('a 1\nb 2'), 'a <n>'));
});

describe('parseClock', () => {
  test('melengkapi detik: awal 00, akhir 59', () => {
    assert.equal(parseClock('8:30', false), '08:30:00');
    assert.equal(parseClock('08:30', true), '08:30:59');
    assert.equal(parseClock('08:30:15', true), '08:30:15');
  });
  for (const bad of ['25:00', '08:60', '08:30:61', 'abc', '8', '']) {
    test(`menolak "${bad}"`, () => assert.throws(() => parseClock(bad, false), /Format jam tidak valid/));
  }
});

describe('parseSize', () => {
  test('satuan', () => {
    assert.equal(parseSize('50MB'), 50 * 1024 ** 2);
    assert.equal(parseSize('1.5gb'), 1.5 * 1024 ** 3);
    assert.equal(parseSize('512kb'), 512 * 1024);
  });
  test('tanpa satuan dianggap MB', () => assert.equal(parseSize('2'), 2 * 1024 ** 2));
  test('menolak nilai tidak valid', () => assert.throws(() => parseSize('banyak'), /Ukuran tidak valid/));
});

describe('parseIntOpt / parsePositiveOpt', () => {
  test('menerima bilangan valid', () => {
    assert.equal(parseIntOpt('samples', '3'), 3);
    assert.equal(parsePositiveOpt('max-mb', '0.5'), 0.5);
  });
  for (const bad of ['0', '-1', '1.5', 'abc', '']) {
    test(`parseIntOpt menolak "${bad}" dan menyebut nama opsi`, () => assert.throws(() => parseIntOpt('samples', bad), /--samples/));
  }
  for (const bad of ['0', '-2', 'abc', '']) {
    test(`parsePositiveOpt menolak "${bad}"`, () => assert.throws(() => parsePositiveOpt('max-mb', bad), /--max-mb/));
  }
});

describe('tsToSec', () => {
  test('selisih 1 menit = 60 detik', () => assert.equal(tsToSec('2026-09-21', '11:12:00') - tsToSec('2026-09-21', '11:11:00'), 60));
});

describe('makeMasker', () => {
  const mask = makeMasker();
  test('email, NIK 16 digit, nomor HP', () => {
    const out = mask('user budi.s@example.co.id nik 3171234567890001 hp 081234567890 / +6281234567890');
    assert.equal(out, 'user <email> nik <nik> hp <phone> / <phone>');
  });
  test('JWT dan Bearer token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwMTIzNDU2In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    assert.equal(mask(`token=${jwt}`), 'token=<jwt>');
    assert.equal(mask('Authorization: Bearer 12|abcdefghijklmnopqrstuvwxyz0123456789'), 'Authorization: Bearer <token>');
  });
  test('angka di dalam JWT tidak diproses sebagai NIK/HP lebih dulu', () => {
    assert.ok(!/<nik>|<phone>/.test(mask('eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjMxNzEyMzQ1Njc4OTAwMDEifQ.abcdefghij')));
  });
  test('UUID hanya disamarkan bila diminta', () => {
    const u = 'id 720a87bb-1fb7-49bb-98f4-2eab2e84a4c8';
    assert.equal(mask(u), u);
    assert.equal(makeMasker({ uuid: true })(u), 'id <uuid>');
  });
  test('teks biasa tidak berubah', () => {
    const t = 'Undefined array key "patient_id" in app/Services/X.php:212';
    assert.equal(mask(t), t);
  });
});
