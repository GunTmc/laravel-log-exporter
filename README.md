# alogreport

Membuat laporan HTML (satu file, bisa dibuka offline) dari log Laravel. Parser membaca log per chunk 1 MB,
jadi aman untuk log harian lebih dari 100 MB.

Isi laporan: jumlah kejadian per error, timeline, filter (level, origin, layer, exception, jam, pencarian),
dan detail per error berupa call chain per layer (Middleware → Controller → Service → Repository → Job),
exception chain, daftar kejadian, dan trace mentah.

Ditulis dalam TypeScript dan dijalankan langsung oleh [Bun](https://bun.sh) 1.4 atau lebih baru: tanpa tahap build dan tanpa
dependency runtime. Node.js tidak didukung. Tersedia juga sebagai [image Docker](#docker).

## Isi direktori

```
src/alogreport.ts      CLI (titik masuk)
src/template.html      tampilan laporan (HTML/CSS/JS satu file, tanpa sumber eksternal)
src/lib/               reader (streaming), parser, aggregate, layers, hints, util, types
test/                  uji (bun:test) dan pembuat log contoh
examples/              log contoh sintetis dan laporan hasilnya
deploy/                script harian, contoh konfigurasi, unit systemd
Dockerfile             image berbasis Bun (tahap test dan runtime)
.github/workflows/     CI dan build image
bun.lock               kunci versi devDependencies (typescript, @types/bun); di-commit
CHANGELOG.md           riwayat perubahan
```

## Pakai

Butuh Bun 1.4+ (`curl -fsSL https://bun.sh/install | bash`), atau pakai [image Docker](#docker). Tidak ada langkah install atau build.

```bash
bun src/alogreport.ts storage/logs/laravel-2026-09-21.log
# hasil: report.html

bun src/alogreport.ts storage/logs/laravel-2026-09-21.log \
  --level=error --from=08:00 --to=17:00 --mask --out=laporan.html

./src/alogreport.ts storage/logs/laravel-2026-09-21.log   # sama; baris #!/usr/bin/env bun memilih runtime
```

Bisa juga file `.log.gz`, atau beberapa file sekaligus:

```bash
bun src/alogreport.ts laravel-2026-09-20.log laravel-2026-09-21.log.gz --out=dua-hari.html
```

Coba dengan data contoh: `bun src/alogreport.ts examples/sample.log --level=warning`.

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
| `--template=path` | Pakai template HTML lain | template bawaan |
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

Pesan error singkat. Untuk stack trace lengkap, jalankan dengan `ALOGREPORT_DEBUG=1`.

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

Kecepatan (log sintetis 120 MB, 54 ribu entry, `--mask`, diukur di mesin pengembangan; angka di server Anda akan berbeda).
Node hanya pembanding, alasan proyek ini memakai Bun:

| Runtime | Waktu | Memori puncak (RSS) |
|---|---|---|
| Node 24 | 3,7 dtk | 146 MB |
| Bun 1.4 | 2,1 dtk | 86 MB |

## Menyesuaikan

- **Layer**: ubah aturan path di `src/lib/layers.ts` (mis. tambah `app/Actions/`).
- **Saran awal**: tambah pola di `src/lib/hints.ts`.
- **Tampilan**: ubah `src/template.html`. Penanda `/*__DATA__*/null` harus tetap ada satu kali. Jangan menambah
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

## Docker

Image berbasis `oven/bun:1.4.0-slim` (Bun menjalankan `src/alogreport.ts` langsung, tanpa tahap build), berjalan sebagai user `bun`
(bukan root), sekitar 165 MB. Di dalamnya hanya kode program: log dan laporan tidak pernah ikut (lihat `.dockerignore`). Image langsung
menjadi perintah `alogreport`:

```bash
docker build -t alogreport .          # atau: bun run docker:build

docker run --rm --user "$(id -u):$(id -g)" \
  -v /var/www/portal-seemedik-api/storage/logs:/logs:ro \
  -v "$PWD/reports:/reports" \
  alogreport /logs/laravel-2026-09-21.log --level=error --mask --out=/reports/laporan.html
```

- `--user "$(id -u):$(id -g)"` membuat file laporan dimiliki Anda. Tanpa itu proses berjalan sebagai uid 1000 (`bun`), yang harus
  bisa membaca log dan menulis ke folder laporan. Uid lain dan `--read-only` sudah diuji.
- Folder keluaran harus di-mount (`-v`), kalau tidak laporan hilang bersama container. Izin laporan tetap `600` (lihat `--mode`).
- Tanpa argumen, image menampilkan bantuan. Kode keluar (0, 1, 2) diteruskan ke pemanggil. Ctrl+C dan `docker stop` menghentikan
  proses dengan segera (memakai `tini`; tanpanya Bun sebagai PID 1 mengabaikan sinyal).
- Semua opsi sama dengan CLI biasa, jadi `--tail`, `--date`, `--from/--to`, `--json` dst. bisa dipakai.

Script harian (kemarin, penyamaran data, kunci, retensi) juga ada di image; panggil dengan `--entrypoint`:

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -v /var/www/portal-seemedik-api/storage/logs:/logs:ro -v /var/reports/laravel:/reports \
  -e LOG_DIR=/logs -e REPORT_DIR=/reports -e REPORT_DATE=yesterday \
  --entrypoint /app/deploy/alogreport-daily.sh alogreport
```

Contoh Docker Compose (tidak ikut `docker compose up`; jalankan sesuai kebutuhan):

```yaml
services:
  alogreport:
    image: alogreport            # atau ghcr.io/<pemilik>/alogreport:latest
    profiles: [tools]
    volumes:
      - ./storage/logs:/logs:ro
      - ./reports:/reports
```

```bash
docker compose run --rm --user "$(id -u):$(id -g)" alogreport /logs/laravel-2026-09-21.log --mask --out=/reports/laporan.html
```

Workflow `.github/workflows/docker.yaml` membangun dan menguji image di setiap perubahan terkait. Saat tag `v*` didorong
(mis. `git tag v1.2.0 && git push --tags`), image amd64 dan arm64 dipublikasikan ke `ghcr.io/<pemilik>/alogreport` dengan tag
`1.2.0`, `1.2`, dan `latest`. Package di GHCR bersifat privat secara default; atur visibilitasnya sesuai kebutuhan.

## Menjalankan terjadwal

Script `deploy/alogreport-daily.sh` membuat laporan untuk **kemarin** (log hari itu sudah lengkap), menyamarkan data,
memakai kunci supaya tidak tumpang tindih, dan menghapus laporan yang lebih tua dari `RETENTION_DAYS`.

```bash
sudo mkdir -p /opt/alogreport && sudo cp -r src deploy package.json /opt/alogreport/
sudo cp /opt/alogreport/deploy/alogreport.env.example /etc/default/alogreport   # lalu sesuaikan LOG_DIR dll
sudo chmod 640 /etc/default/alogreport
```

Cron:

```cron
10 0 * * *  REPORT_DATE=yesterday /opt/alogreport/deploy/alogreport-daily.sh >> /var/log/alogreport.log 2>&1
```

Atau systemd timer (dengan pembatasan akses, jalan sebagai user `alogreport` yang hanya boleh membaca log):

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin alogreport
sudo install -d -o alogreport -g alogreport -m 700 /var/reports/laravel
sudo cp /opt/alogreport/deploy/alogreport.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now alogreport.timer
systemctl list-timers alogreport.timer          # cek jadwal
journalctl -u alogreport.service -n 20          # cek hasil terakhir
```

`ReadOnlyPaths` dan `ReadWritePaths` di `alogreport.service` harus mencakup `LOG_DIR` dan `REPORT_DIR`. User `alogreport`
harus punya hak baca ke folder log (mis. masuk grup pemilik log). Karena unit memakai `ProtectHome=yes`, pasang Bun di lokasi yang
bisa dibaca user `alogreport` (mis. `/usr/local/bin/bun`), bukan di `~/.bun`; atau isi `RUNTIME` dengan path lengkapnya.

Konfigurasi (environment menang atas file `/etc/default/alogreport`, yang menang atas nilai bawaan): `LOG_DIR` (wajib), `REPORT_DIR`,
`LOG_PREFIX`, `REPORT_DATE`, `LEVEL`, `MASK`, `REPORT_MODE`, `RETENTION_DAYS`, `RUNTIME` (executable Bun, default `bun`), `ALOGREPORT_ARGS`.
Penjelasan tiap nilai ada di `deploy/alogreport.env.example`. Mengisi ulang laporan hari tertentu:

```bash
REPORT_DATE=2026-09-20 /opt/alogreport/deploy/alogreport-daily.sh
```

Bila tidak ada file log untuk tanggal itu, script keluar dengan kode 0 (Laravel hanya membuat file harian saat ada yang dicatat).
Kesalahan konfigurasi (folder tidak ada, Bun tidak ditemukan) keluar dengan kode 1.

## Pengembangan dan uji

```bash
bun install             # hanya typescript dan @types/bun, untuk type check; runtime tidak butuh dependency
bun run typecheck       # tsc --noEmit untuk src/ dan test/ (Bun sendiri tidak memeriksa tipe)
bun test ./test/        # seluruh uji. Pakai "./": tanpa itu Bun mencocokkan path yang memuat "test/" di mana pun
bun run sample          # perbarui examples/sample.log dan examples/sample-report.html
bun test/make-sample-log.ts --out=big.log --mb=120   # log besar untuk uji performa
docker build --target test .   # jalankan seluruh uji di dalam image
```

Uji (`bun:test`) mencakup util, klasifikasi layer, parser, reader (chunk, CRLF, UTF-8, gz, baris raksasa, error baca), CLI
(validasi argumen, kode keluar, izin file, perlindungan menimpa masukan, `--max-groups`, `--mask`), hasil end-to-end pada log
contoh, dan keamanan HTML (isi log yang berbahaya, CSP). CI (`.github/workflows/ci.yaml`) menjalankan type check, uji di Bun 1.4.0
(dan `latest` sebagai peringatan dini, tidak menggagalkan CI), dan script deploy (shellcheck dan dijalankan sungguhan).
`docker.yaml` membangun dan menguji image; tag `v*` mendorongnya ke GHCR.

Data di `test/make-sample-log.ts` sepenuhnya sintetis (UUID `0000...`, IP `192.0.2.x`). Jangan mengganti dengan data log asli.
