#!/usr/bin/env bash
# Membuat laporan harian dari log Laravel. Dipanggil dari cron atau systemd timer.
#
# Konfigurasi: environment > file /etc/default/alogreport > nilai bawaan (lihat deploy/alogreport.env.example).
# Jadi pengisian ulang cukup: REPORT_DATE=2026-09-20 deploy/alogreport-daily.sh
# Disarankan berjalan sesudah tengah malam untuk kemarin (REPORT_DATE=yesterday), supaya log hari itu sudah lengkap.
set -euo pipefail
umask 077 # laporan bisa memuat data pasien: hanya pemilik yang boleh membaca

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_FILE="${ALOGREPORT_ENV:-/etc/default/alogreport}"
if [ -r "$ENV_FILE" ]; then
  # simpan nilai dari environment, baca file, lalu kembalikan: environment menang atas file
  declare -A saved=()
  for v in LOG_DIR REPORT_DIR LOG_PREFIX REPORT_DATE LEVEL MASK REPORT_MODE RETENTION_DAYS RUNTIME ALOGREPORT_ARGS; do
    [ -n "${!v+x}" ] && saved[$v]="${!v}"
  done
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  for v in "${!saved[@]}"; do printf -v "$v" '%s' "${saved[$v]}"; done
fi

: "${LOG_DIR:?LOG_DIR harus diisi, mis. /var/www/app/storage/logs}"
: "${REPORT_DIR:=/var/reports/laravel}"
: "${LOG_PREFIX:=laravel}"        # nama file log: <LOG_PREFIX>-YYYY-MM-DD.log[.gz]
: "${REPORT_DATE:=$(date +%F)}"   # YYYY-MM-DD atau "yesterday"
: "${LEVEL:=error}"
: "${MASK:=1}"                    # 1 = samarkan data pribadi (--mask); 0 = mati
: "${REPORT_MODE:=600}"           # izin file laporan
: "${RETENTION_DAYS:=30}"         # hapus laporan lebih tua dari ini; 0 = jangan hapus
: "${RUNTIME:=bun}"               # executable Bun (nama di PATH atau path lengkap, mis. /usr/local/bin/bun)
: "${ALOGREPORT_ARGS:=}"           # opsi tambahan, dipisah spasi (mis. "--max-groups=500")

log() { printf '%s alogreport: %s\n' "$(date '+%F %T')" "$*"; }
die() { log "GAGAL: $*" >&2; exit 1; }

[ "$REPORT_DATE" = "yesterday" ] && REPORT_DATE="$(date -d yesterday +%F)"
[[ "$REPORT_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "REPORT_DATE tidak valid: $REPORT_DATE (pakai YYYY-MM-DD atau yesterday)"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "RETENTION_DAYS harus bilangan bulat: $RETENTION_DAYS"
[[ "$LOG_PREFIX" =~ ^[A-Za-z0-9._-]+$ ]] || die "LOG_PREFIX hanya boleh huruf, angka, titik, garis bawah, dan strip: $LOG_PREFIX"
command -v "$RUNTIME" >/dev/null 2>&1 || die "Bun tidak ditemukan: $RUNTIME (pasang Bun, atau isi RUNTIME dengan path lengkapnya)"
CLI="$APP_DIR/src/alogreport.ts" # Bun menjalankan TypeScript langsung, tanpa build
[ -f "$CLI" ] || die "$CLI tidak ada"
[ -d "$LOG_DIR" ] || die "LOG_DIR tidak ada: $LOG_DIR"

# satu proses pada satu waktu (mencegah tumpang tindih bila proses sebelumnya lambat)
mkdir -p "$REPORT_DIR"
exec 9>"$REPORT_DIR/.alogreport.lock"
flock -n 9 || { log "masih ada proses lain yang berjalan, dilewati"; exit 0; }

input=""
for candidate in "$LOG_DIR/$LOG_PREFIX-$REPORT_DATE.log" "$LOG_DIR/$LOG_PREFIX-$REPORT_DATE.log.gz"; do
  [ -f "$candidate" ] && { input="$candidate"; break; }
done
if [ -z "$input" ]; then
  # Laravel baru membuat file harian saat ada yang dicatat, jadi tidak ada file = tidak ada log hari itu
  log "tidak ada log untuk $REPORT_DATE di $LOG_DIR, dilewati"
  exit 0
fi

output="$REPORT_DIR/$LOG_PREFIX-$REPORT_DATE.html"
args=(--level="$LEVEL" --out="$output" --mode="$REPORT_MODE" --title="Laporan error $REPORT_DATE" --quiet)
[ "$MASK" = "1" ] && args+=(--mask)
# shellcheck disable=SC2206 # ALOGREPORT_ARGS sengaja dipecah per spasi
[ -n "$ALOGREPORT_ARGS" ] && args+=($ALOGREPORT_ARGS)

"$RUNTIME" "$CLI" "$input" "${args[@]}" || die "alogreport gagal untuk $input"
log "OK: $output ($(du -h "$output" | cut -f1)) dari $(basename "$input")"

if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$REPORT_DIR" -maxdepth 1 -type f -name "$LOG_PREFIX-*.html" -mtime "+$RETENTION_DAYS" -print -delete |
    while read -r old; do log "hapus laporan lama: $old"; done
fi
