/**
 * Saran awal berdasarkan pola error. Tambahkan aturan sendiri sesuai error yang sering muncul.
 * Bentuk: [regex, (matchArray, teks) => string]
 */
type HintRule = [RegExp, (m: RegExpExecArray, text: string) => string];

const hostOf = (u: string): string => {
  try {
    return new URL(u).host;
  } catch (_) {
    return u;
  }
};

const RULES: HintRule[] = [
  [
    /cURL error 28|Operation timed out|timed out after/i,
    (_m, t) => {
      const u = t.match(/for (https?:\/\/[^\s)]+)/);
      return `Request keluar tidak dibalas tepat waktu${u ? ' oleh ' + hostOf(u[1]) : ''}. Cek kesehatan service tujuan dan nilai timeout pada Http::timeout(). Untuk proses berat (mis. generate PDF), pertimbangkan memakai queue.`;
    },
  ],
  [
    /cURL error 7|Connection refused|Could not resolve host|cURL error 6/i,
    () => 'Koneksi ke service tujuan ditolak atau host tidak ditemukan. Cek apakah service berjalan, alamat/port, dan DNS atau network antar container.',
  ],
  [
    /SQLSTATE\[23505\]|Unique violation|Duplicate entry/i,
    () => 'Insert melanggar unique constraint. Pertimbangkan updateOrCreate / upsert / insertOrIgnore, dan pastikan job idempotent jika di-retry atau di-dispatch dua kali.',
  ],
  [
    /SQLSTATE\[23503\]|foreign key constraint/i,
    () => 'Pelanggaran foreign key: data induk belum ada atau masih dipakai. Periksa urutan penyimpanan dan penghapusan data terkait.',
  ],
  [
    /SQLSTATE\[23502\]|not-null constraint|cannot be null/i,
    () => 'Kolom wajib diisi menerima nilai NULL. Periksa validasi input dan default value pada payload yang disimpan.',
  ],
  [
    /SQLSTATE\[40P01\]|Deadlock found|deadlock detected/i,
    () => 'Deadlock database. Urutkan akses tabel secara konsisten, perpendek transaksi, dan beri retry pada operasi tersebut.',
  ],
  [
    /SQLSTATE\[42P01\]|Base table or view not found|relation ".*" does not exist/i,
    () => 'Tabel tidak ditemukan. Cek migration yang belum dijalankan atau nama tabel/schema pada query.',
  ],
  [
    /SQLSTATE\[HY000\] \[2002\]|could not connect to server|SQLSTATE\[08006\]/i,
    () => 'Aplikasi tidak bisa terhubung ke database. Cek host/port, status database, dan batas koneksi (max_connections).',
  ],
  [
    /Allowed memory size .* exhausted/i,
    () => 'Memori PHP habis. Proses data dalam chunk/cursor/lazy collection, atau naikkan memory_limit untuk proses tersebut.',
  ],
  [
    /Maximum execution time/i,
    () => 'Melewati batas waktu eksekusi PHP. Pindahkan proses panjang ke queue atau optimalkan query di bagian tersebut.',
  ],
  [
    /Undefined (array key|index|variable|offset|property)/i,
    () => 'Key atau variabel belum ada. Validasi input (FormRequest) atau pakai null-safe access dan nilai default.',
  ],
  [
    /Call to a member function .* on null|Attempt to read property .* on null/i,
    () => 'Objek bernilai null saat dipakai. Periksa hasil query (first() bisa null) dan gunakan null-safe operator atau findOrFail.',
  ],
  [
    /MaxAttemptsExceededException|has been attempted too many times/i,
    () => 'Job gagal berulang sampai melewati batas percobaan ($tries). Biasanya akibat error lain di job yang sama; cari error penyebabnya di log.',
  ],
  [
    /ModelNotFoundException|No query results for model/i,
    () => 'Data yang dicari tidak ada. Pastikan ID valid atau tangani kasus tidak ditemukan dengan respons 404 yang jelas.',
  ],
  [
    /TokenExpiredException|Token has expired|Unauthenticated|JWT/i,
    () => 'Masalah autentikasi token. Cek masa berlaku token, mekanisme refresh, dan sinkronisasi waktu server.',
  ],
];

function hintFor(text: string): string | null {
  for (let i = 0; i < RULES.length; i++) {
    const m = RULES[i][0].exec(text);
    if (m) return RULES[i][1](m, text);
  }
  return null;
}

export { hintFor, RULES };
