# logreport

Membuat laporan HTML (satu file, bisa dibuka offline) dari log Laravel. Parser membaca log per chunk 1 MB,
jadi aman untuk log harian lebih dari 100 MB.

Isi laporan: jumlah kejadian per error, timeline, filter (level, origin, layer, exception, jam, pencarian),
dan detail per error berupa call chain per layer (Middleware → Controller → Service → Repository → Job),
exception chain, daftar kejadian, dan trace mentah.

Tanpa dependency. Berjalan di Node.js 16 atau lebih baru, dan di Bun 1.4 (lihat [Menjalankan dengan Bun](#menjalankan-dengan-bun)).

## Isi direktori

```
logreport.js           CLI (titik masuk)
template.html          tampilan laporan (HTML/CSS/JS satu file, tanpa sumber eksternal)
lib/                   reader (streaming), parser, aggregate, layers, hints, util
test/                  uji otomatis dan pembuat log contoh
examples/              log contoh sintetis dan laporan hasilnya
deploy/                script harian, contoh konfigurasi, unit systemd
.github/workflows/     CI
CHANGELOG.md           riwayat perubahan
```

## Pakai

```bash
node logreport.js storage/logs/laravel-2026-09-21.log
# hasil: report.html

node logreport.js storage/logs/laravel-2026-09-21.log \
  --level=error --from=08:00 --to=17:00 --mask --out=laporan.html
```

Bisa juga file `.log.gz`, atau beberapa file sekaligus:

```bash
node logreport.js laravel-2026-09-20.log laravel-2026-09-21.log.gz --out=dua-hari.html
```

Coba dengan data contoh: `node logreport.js examples/sample.log --level=warning`.

### Opsi

| Opsi | Keterangan | Default |
|---|---|---|
| `--level=error` | Level minimum: debug, info, notice, warning, error, critical, alert, emergency | `error` |
| `--from=08:00` `--to=17:00` | Batasi jam (HH:MM atau HH:MM:SS) | semua |
| `--date=2026-09-21` | Hanya tanggal ini (untuk file berisi beberapa hari) | semua |
| `--tail=50MB` | Baca hanya 50 MB terakhir (tidak untuk `.gz`; diabaikan dengan peringatan) | seluruh file |
| `--samples=3` | Sampel trace mentah per group (1 pertama + sisanya terbaru) | `3` |
| `--max-occ=500` | Jumlah waktu kejadian yang disimpan per group | `500` |
| `--max-groups=2000` | Jumlah group maksimal. Entry dari group baru sesudah batas tercapai diabaikan dan dicatat di laporan | `2000` |
| `--max-mb=10` | Batas ukuran data di HTML; sampel dikurangi otomatis bila lewat | `10` |
| `--mask` | Samarkan email, NIK 16 digit, nomor HP, dan token (JWT, `Bearer ...`) sebelum diproses | mati |
| `--mask-uuid` | Samarkan juga UUID. Otomatis mengaktifkan `--mask` | mati |
| `--out=report.html` | File keluaran. Folder yang belum ada dibuat | `report.html` |
| `--mode=600` | Izin file keluaran (oktal) | `600` |
| `--title="..."` | Judul laporan | Laravel Log Report |
| `--json=data.json` | Simpan juga data hasil parsing (untuk debug); izin sama dengan `--mode` | tidak |
| `--template=path` | Pakai template HTML lain | `template.html` |
| `--quiet` | Tanpa progress dan ringkasan (peringatan tetap tampil) | |
| `--version`, `--help` | | |

Nilai boleh ditulis `--level=warning` atau `--level warning`. Opsi yang tidak dikenal ditolak.
Keluaran (`--out`, `--json`) tidak boleh sama dengan file masukan.

### Kode keluar

| Kode | Arti |
|---|---|
| 0 | Berhasil (bisa disertai `peringatan:` di stderr) |
| 1 | Gagal saat berjalan: file tidak terbaca, `.gz` rusak, tidak bisa menulis, template salah |
| 2 | Salah pemakaian: opsi tidak dikenal atau nilainya tidak valid |

Pesan error singkat. Untuk stack trace lengkap, jalankan dengan `LOGREPORT_DEBUG=1`.

Peringatan yang perlu diperhatikan (stderr): tidak ada entry berformat Laravel di file (kemungkinan file salah),
entry gagal diparse, baris terlalu panjang dipotong, `--max-groups` tercapai, data masih di atas `--max-mb`.

## Cara kerja

```
file log ─► pembaca streaming ─► pemisah entry ─► filter murah (level, jam)
         ─► parser ─► fingerprint ─► agregasi per group ─► JSON ─► template.html ─► report.html
```

- **Filter murah**: level dan jam dicek dari baris header saja. Entry yang tidak lolos dibuang tanpa diparse.
- **Fingerprint** (kunci group): kelas exception terluar + pesan yang dinormalisasi
  (UUID, IP, angka, durasi diganti placeholder) + frame app pertama (`file:baris`).
  Error yang sama tapi beda ID jatuh ke group yang sama.
- **Call chain**: dibangun dari stack trace. Baris `#i file(baris): call` berarti kode di `file:baris` memanggil
  `call`, sehingga fungsi yang sedang berjalan di baris itu adalah callee dari frame berikutnya. Frame vendor
  yang berurutan dilipat jadi satu.
- **Memori dibatasi per group, bukan per kejadian**: counter dan histogram per menit tidak dibatasi (angka tetap
  akurat), sedangkan daftar waktu kejadian dan trace mentah dibatasi (`--max-occ`, `--samples`). Jumlah group
  dibatasi `--max-groups`, dan satu baris log dibatasi 1 juta karakter.
- **Entry terkait**: dua group ditautkan bila muncul dalam selisih 2 detik dan berbagi class Service/Repository/Job.

Format log yang dikenali:

1. `Kelas: pesan in /file.php:123` diikuti `Stack trace:` (termasuk `Next ...` untuk exception berantai)
2. Format Monolog/Laravel bawaan: `{"exception":"[object] (Kelas(code: 0): pesan at /file.php:123)\n[stacktrace]\n#0 ..."}`
3. Baris log biasa tanpa stack trace (dikelompokkan berdasarkan level dan pesan)

Kecepatan (log sintetis 120 MB, 54 ribu entry, `--mask`, diukur di mesin pengembangan; angka di server Anda akan berbeda):

| Runtime | Waktu | Memori puncak (RSS) |
|---|---|---|
| Node 24 | 3,7 dtk | 146 MB |
| Bun 1.4 | 2,1 dtk | 86 MB |

## Menyesuaikan

- **Layer**: ubah aturan path di `lib/layers.js` (mis. tambah `app/Actions/`).
- **Saran awal**: tambah pola di `lib/hints.js`.
- **Tampilan**: ubah `template.html`. Penanda `/*__DATA__*/null` harus tetap ada satu kali. Jangan menambah
  sumber eksternal (CDN, font, fetch): laporan dikunci dengan Content-Security-Policy yang memblokirnya.

## Batasan yang perlu diketahui

- Filter jam di laporan beresolusi **menit** (histogram disimpan per menit). Filter jam di CLI (`--from/--to`) presisi detik.
- Call chain dan kunci group diambil dari **entry pertama** tiap group. Bila error yang sama muncul lewat
  jalur pemanggil yang berbeda, keduanya digabung selama frame app pertamanya sama.
- Waktu log dibaca apa adanya (tanpa konversi zona waktu).
- File dibaca berurutan, satu proses. Untuk banyak file besar, jalankan beberapa proses paralel per file lalu buka laporannya masing-masing.
- Untuk `.gz`, ukuran yang tampil di ringkasan adalah ukuran terkompresi. `.gz` yang terpotong dianggap rusak (gagal, tidak diam-diam dipotong).
- **Log biasa (tanpa stack trace) hanya dikelompokkan lewat pesannya**, dan hanya `[]` di ujung yang dibuang.
  Bila konteks JSON-nya berbeda-beda (mis. `{"email":"..."}`), tiap variasi menjadi group sendiri.
  Dengan `--mask` nilai seperti email sudah seragam sehingga tergabung.
- Klasifikasi layer memakai path file. Bila folder root proyek **bernama persis `app`** (mis. `/var/www/app/...`),
  frame `public/index.php` dan `bootstrap/` terbaca sebagai layer `Other`, bukan vendor.

## Keamanan (log data medis)

Pesan error sering memuat data pasien.

- Pakai `--mask` (dan `--mask-uuid` bila perlu). Penyamaran memakai pola (email, NIK 16 digit, nomor HP Indonesia,
  JWT, `Bearer ...`), jadi **tidak menjamin semua data pribadi terhapus**. Nama pasien, alamat, atau isi field bebas
  tidak dikenali. Periksa laporan sebelum dibagikan.
- File laporan dan JSON dibuat dengan izin `600` (hanya pemilik). Bila tim perlu membaca, atur `--mode=640` dan grup
  yang sesuai. Ditulis lewat file sementara lalu di-rename, jadi tidak pernah terlihat setengah jadi.
- Simpan laporan di lokasi yang tidak disajikan web server. Laporan **tidak berisi autentikasi**.
- Laporan hanya berisi satu file HTML. Content-Security-Policy `default-src 'none'` memblokir semua permintaan jaringan,
  dan semua teks dari log di-escape saat ditampilkan, jadi isi log yang berbahaya (mis. `</script>`) tidak dieksekusi.
- Log dan laporan sudah masuk `.gitignore`. Jangan meng-commit log asli. Data di `examples/` seluruhnya sintetis.

## Menjalankan terjadwal

Script `deploy/logreport-daily.sh` membuat laporan untuk **kemarin** (log hari itu sudah lengkap), menyamarkan data,
memakai kunci supaya tidak tumpang tindih, dan menghapus laporan yang lebih tua dari `RETENTION_DAYS`.

```bash
sudo mkdir -p /opt/logreport && sudo cp -r logreport.js template.html lib deploy package.json /opt/logreport/
sudo cp /opt/logreport/deploy/logreport.env.example /etc/default/logreport   # lalu sesuaikan LOG_DIR dll
sudo chmod 640 /etc/default/logreport
```

Cron:

```cron
10 0 * * *  REPORT_DATE=yesterday /opt/logreport/deploy/logreport-daily.sh >> /var/log/logreport.log 2>&1
```

Atau systemd timer (dengan pembatasan akses, jalan sebagai user `logreport` yang hanya boleh membaca log):

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin logreport
sudo install -d -o logreport -g logreport -m 700 /var/reports/laravel
sudo cp /opt/logreport/deploy/logreport.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now logreport.timer
systemctl list-timers logreport.timer          # cek jadwal
journalctl -u logreport.service -n 20          # cek hasil terakhir
```

`ReadOnlyPaths` dan `ReadWritePaths` di `logreport.service` harus mencakup `LOG_DIR` dan `REPORT_DIR`. User `logreport`
harus punya hak baca ke folder log (mis. masuk grup pemilik log).

Konfigurasi (environment menang atas file `/etc/default/logreport`, yang menang atas nilai bawaan): `LOG_DIR` (wajib), `REPORT_DIR`,
`LOG_PREFIX`, `REPORT_DATE`, `LEVEL`, `MASK`, `REPORT_MODE`, `RETENTION_DAYS`, `RUNTIME`, `LOGREPORT_ARGS`.
Penjelasan tiap nilai ada di `deploy/logreport.env.example`. Mengisi ulang laporan hari tertentu:

```bash
REPORT_DATE=2026-09-20 /opt/logreport/deploy/logreport-daily.sh
```

Bila tidak ada file log untuk tanggal itu, script keluar dengan kode 0 (Laravel hanya membuat file harian saat ada yang dicatat).
Kesalahan konfigurasi (folder tidak ada, runtime tidak ada) keluar dengan kode 1.

## Menjalankan dengan Bun

Kode runtime hanya memakai modul bawaan (`fs`, `zlib`, `stream`, `path`), sehingga berjalan di Bun tanpa perubahan.
Sudah diuji di Bun 1.4.0: seluruh uji lulus dan hasil JSON identik dengan Node.

```bash
bun logreport.js storage/logs/laravel-2026-09-21.log --mask
RUNTIME=bun deploy/logreport-daily.sh
bun test test/
```

Baris `#!/usr/bin/env node` di `logreport.js` membuat `./logreport.js` memakai Node. Di server yang hanya punya Bun,
panggil dengan `bun logreport.js ...` (atau `RUNTIME=bun` untuk script harian). Unit `logreport.service` memanggil script,
jadi tidak perlu diubah selain `RUNTIME=bun` di `/etc/default/logreport`. Karena unit memakai `ProtectHome=yes`, pasang Bun di
lokasi yang bisa dibaca user `logreport` (mis. `/usr/local/bin/bun`), bukan di `~/.bun`.

## Pengembangan dan uji

```bash
npm test                # semua uji (butuh Node 18+ karena memakai node:test)
bun test test/          # sama, di Bun
npm run sample          # perbarui examples/sample.log dan examples/sample-report.html
node test/make-sample-log.js --out=big.log --mb=120   # log besar untuk uji performa
```

Uji mencakup util, klasifikasi layer, parser, reader (chunk, CRLF, UTF-8, gz, baris raksasa, error baca), CLI (validasi
argumen, kode keluar, izin file, perlindungan menimpa masukan, `--max-groups`, `--mask`), hasil end-to-end pada log
contoh, dan keamanan HTML (isi log yang berbahaya, CSP). CI (`.github/workflows/ci.yaml`) menjalankannya di Node 18/20/22/24 dan
Bun 1.4, ditambah uji asap di Node 16 (runtime tetap didukung, tapi test runner-nya tidak).

Data di `test/make-sample-log.js` sepenuhnya sintetis (UUID `0000...`, IP `192.0.2.x`). Jangan mengganti dengan data log asli.
# laravel-log-exporter
