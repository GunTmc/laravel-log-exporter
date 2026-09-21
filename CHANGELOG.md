# Riwayat perubahan

## [Belum dirilis]

TypeScript, runtime Bun, image Docker, dan perbaikan CI.

### Diubah (perlu perhatian bila memakai dari script)

- **Runtime menjadi Bun 1.4+; Node.js tidak lagi didukung.** Kode memakai `import.meta.dir` dan `import.meta.main`. Tidak ada tahap
  build: Bun menjalankan `src/alogreport.ts` langsung, dan shebang-nya `#!/usr/bin/env bun`. `engines` menjadi `bun >=1.4.0`.
- **Nama menjadi `alogreport`.** Paket dan `bin`: `alogreport` (`src/alogreport.ts`). Environment: `LOGREPORT_DEBUG` menjadi
  `ALOGREPORT_DEBUG`, `LOGREPORT_ENV` menjadi `ALOGREPORT_ENV`, `LOGREPORT_ARGS` menjadi `ALOGREPORT_ARGS`. Deploy:
  `/etc/default/logreport` menjadi `/etc/default/alogreport`, dan `deploy/logreport*` menjadi `deploy/alogreport*` (script, env contoh,
  unit dan timer systemd, user `alogreport`). Sesuaikan instalasi yang sudah berjalan.
- **Ditulis ulang dalam TypeScript** (`src/`, mode `strict`). Perilaku CLI tidak berubah: laporan dari log contoh identik dengan versi
  JavaScript, dan 119 uji yang sama lulus. `lib/` pindah ke `src/lib/`, `template.html` ke `src/template.html`. Opsi `--template` tidak berubah.
- Script deploy: `RUNTIME` sekarang berisi executable Bun (default `bun`; sebelumnya `node`). Bila Bun terpasang di luar `PATH`
  (mis. `~/.bun/bin/bun`), isi dengan path lengkap. Salin `src/` ke server, bukan `logreport.js` dan `lib/`.
- Uji memakai `bun:test` (sebelumnya `node:test`). Jalankan dengan `bun test ./test/`; tanpa `./` Bun mencocokkan path apa pun yang
  memuat `test/`. `npm test` diganti `bun test`, `npm run sample` menjadi `bun run sample`.
- `typescript` dan `@types/bun` menjadi devDependencies (hanya untuk `bun run typecheck`); `bun.lock` di-commit (sebelumnya diabaikan).

### Ditambahkan

- `Dockerfile` (tahap test dan runtime). Image berbasis `oven/bun:1.4.0-slim` (sekitar 165 MB), menjalankan `src/alogreport.ts` langsung.
  Berjalan sebagai user non-root, memakai `tini` (tanpanya Bun sebagai PID 1 mengabaikan SIGTERM, sehingga `docker stop` menunggu
  sampai proses selesai), dan sudah berisi script harian (`--entrypoint /app/deploy/alogreport-daily.sh`). `.dockerignore` mencegah
  log dan laporan masuk ke build context. Uji di dalam image: `docker build --target test .`.
- `.github/workflows/docker.yaml`: bangun dan uji image; tag `v*` mendorong image amd64 + arm64 ke GHCR.
- `bun run typecheck` dan `bun run docker:build`.

### Diperbaiki (CI)

- CI hanya memakai Bun (tidak ada Node di pipeline): type check, uji di Bun 1.4.0 dan `latest` (`latest` tidak menggagalkan CI, hanya
  peringatan dini), dan script deploy.
- Script deploy sebelumnya hanya diperiksa sintaksnya (`bash -n`). Kini juga lewat `shellcheck` dan dijalankan sungguhan pada log contoh
  (memeriksa file laporan terbentuk dan izinnya `600`).
- Action dinaikkan: `checkout@v7`. Ditambahkan `timeout-minutes` pada tiap job.

## [1.1.0] - 2026-09-21

Rilis persiapan produksi.

### Diperbaiki

- Struktur direktori dipulihkan (`lib/`, `test/`, `examples/`). Sebelumnya semua file berada di satu level sehingga
  `require('./lib/...')`, `npm test`, dan `npm run sample` tidak bisa jalan.
- Error baca pada file `.gz` (mis. izin ditolak) tidak tertangkap dan membuat proses crash dengan stack trace mentah.
  Sekarang menjadi pesan `Gagal: ...` dengan kode keluar 1.
- Entry yang baris header-nya memuat karakter U+2028/U+2029 (atau CR tunggal) hilang diam-diam karena `.` pada regex
  tidak mencocokkan pemisah baris Unicode.
- Satu baris log raksasa tanpa newline (puluhan MB) menumpuk di memori dan bisa menggagalkan seluruh laporan
  (`Invalid string length`). Sekarang baris dipotong pada 1 juta karakter dan dihitung sebagai peringatan.
- Contoh cron memakai pukul 23:55 dengan tanggal hari itu sehingga log lima menit terakhir tidak ikut. Diganti menjadi
  00:10 untuk log kemarin.

### Ditambahkan

- `--max-groups` (default 2000): membatasi jumlah group agar memori dan ukuran HTML tidak tumbuh tanpa batas pada log
  yang pesannya unik di tiap baris. Jumlah entry yang diabaikan dicatat di CLI dan di banner laporan.
- `--mode` (default `600`) untuk izin file keluaran, `--version`, dan pemisah `--` sebelum daftar file.
- Penyamaran token: JWT dan `Bearer ...` (bagian dari `--mask`).
- Validasi argumen: opsi tidak dikenal, nilai kosong, angka/jam/tanggal/mode tidak valid, `--from` > `--to`.
- Perlindungan: keluaran tidak boleh sama dengan file masukan (termasuk lewat symlink).
- `deploy/`: script harian (kunci, retensi, isi ulang tanggal), contoh konfigurasi, unit dan timer systemd.
- Test suite (119 uji) dengan `node:test`, berjalan di Node 18/20/22/24 dan `bun test`. CI GitHub Actions.
- `.gitignore`, `.gitattributes`, `.editorconfig`.
- Template: Content-Security-Policy `default-src 'none'`, `noscript`, `referrer`/`robots`, dan banner bila ada
  group yang diabaikan.

### Diubah (perlu perhatian bila memakai dari script)

- Opsi yang tidak dikenal sekarang **ditolak** (kode 2); sebelumnya diabaikan diam-diam.
- Tanpa argumen file, kode keluar 2 (sebelumnya 1) dan bantuan ditulis ke stderr.
- File laporan dan JSON dibuat dengan izin `600` (sebelumnya mengikuti umask). Gunakan `--mode=640` bila perlu dibaca grup.
- `--mask-uuid` sekarang otomatis mengaktifkan `--mask` (sebelumnya tidak berefek tanpa `--mask`).
- `--quiet` tidak lagi menyembunyikan peringatan.
- Keluaran ditulis lewat file sementara lalu di-rename, dan folder keluaran dibuat bila belum ada.
- `main` dihapus dari `package.json` (paket ini CLI; mengimpornya menjalankan CLI). `bin` tetap.
- `sample-report.html` pindah ke `examples/`. Data contoh diganti nilai sintetis (sebelumnya memuat UUID dan IP yang
  tampak berasal dari log asli).

## [1.0.0]

Rilis awal.
