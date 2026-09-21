import { quickKey, analyze } from './parser';
import { rank, truncate } from './util';
import type { GroupInfo, ParsedEntry, ReportGroup, Sample } from './types';

/** Group yang sedang dikumpulkan (bentuk akhirnya untuk template dibuat oleh `toGroups`). */
interface GroupState extends GroupInfo {
  id: string;
  level: string;
  rank: number;
  count: number;
  first: number;
  last: number;
  min: Map<number, number>; // ms epoch awal menit -> jumlah
  occ: number[];
  firstSample: Sample;
  latest: Sample[];
  related: Set<string>;
}

export interface AggregatorOptions {
  samples?: number;
  maxOcc?: number;
  maxGroups?: number;
}

export interface GroupLimits {
  maxOcc?: number;
  rawMax?: number;
  samples?: number;
}

/**
 * Memori dibatasi per group (bukan per kejadian):
 *  - counter dan histogram per menit: tidak dibatasi (angka tetap akurat)
 *  - daftar waktu kejadian: N terakhir (maxOcc)
 *  - sampel raw: 1 pertama + (samples-1) terbaru
 *  - jumlah group: maksimal maxGroups. Entry dari group baru setelah batas tercapai dihitung di `dropped`
 *    dan tidak disimpan; group yang sudah ada tetap dihitung akurat.
 */
class Aggregator {
  samples: number;
  maxOcc: number;
  maxGroups: number;
  dropped = 0;
  kept = 0;
  private map = new Map<string, GroupState>();
  private byId = new Map<string, GroupState>();
  private win = new Map<string, number>(); // id group -> detik terakhir (jendela related)
  private next = 1;

  constructor({ samples = 3, maxOcc = 500, maxGroups = 2000 }: AggregatorOptions = {}) {
    this.samples = Math.max(1, samples);
    this.maxOcc = Math.max(1, maxOcc);
    this.maxGroups = Math.max(1, maxGroups);
  }

  add(p: ParsedEntry, ts: number, level: string, raw: string): void {
    const key = quickKey(p, level);
    let g = this.map.get(key);
    if (!g) {
      if (this.map.size >= this.maxGroups) {
        this.dropped++;
        return;
      }
      const info = analyze(p, level, key);
      g = {
        id: 'g' + this.next++,
        level,
        rank: rank(level),
        ...info,
        count: 0,
        first: ts,
        last: ts,
        min: new Map(),
        occ: [],
        firstSample: { t: ts, raw },
        latest: [],
        related: new Set(),
      };
      this.map.set(key, g);
      this.byId.set(g.id, g);
    } else {
      const r = rank(level);
      if (r > g.rank) {
        g.rank = r;
        g.level = level;
      }
      if (this.samples > 1) {
        g.latest.push({ t: ts, raw });
        if (g.latest.length > this.samples - 1) g.latest.shift();
      }
    }

    g.count++;
    this.kept++;
    if (ts > g.last) g.last = ts;
    if (ts < g.first) g.first = ts;

    const mk = Math.floor(ts / 60) * 60000;
    g.min.set(mk, (g.min.get(mk) || 0) + 1);

    g.occ.push(ts);
    if (g.occ.length >= this.maxOcc * 2) g.occ = g.occ.slice(-this.maxOcc);

    this._related(g, ts);
  }

  /** Dua group dianggap terkait bila muncul <=2 detik dan berbagi class Service/Repository/Job. */
  private _related(g: GroupState, ts: number): void {
    for (const [id, t] of this.win) {
      if (ts - t > 2) {
        this.win.delete(id);
        continue;
      }
      if (id === g.id || g.related.has(id)) continue;
      const o = this.byId.get(id) as GroupState;
      let shared = false;
      for (const s of g.svc) {
        if (o.svc.has(s)) {
          shared = true;
          break;
        }
      }
      if (shared) {
        g.related.add(id);
        o.related.add(g.id);
      }
    }
    this.win.set(g.id, ts);
  }

  /** Bentuk data untuk template. `limits` dipakai untuk memperkecil ukuran bila perlu. */
  toGroups(limits: GroupLimits = {}): ReportGroup[] {
    const maxOcc = limits.maxOcc || this.maxOcc;
    const rawMax = limits.rawMax || 60000;
    const nSamples = limits.samples || this.samples;
    const groups = [...this.map.values()].map((g) => {
      const samples = [g.firstSample, ...g.latest].slice(0, nSamples).map((s) => ({ t: s.t, raw: truncate(s.raw, rawMax) }));
      return {
        id: g.id,
        level: g.level,
        origin: g.origin,
        endpoint: g.endpoint,
        errClass: g.errClass,
        title: g.title,
        msg1: g.msg1,
        fp: g.fp,
        exceptions: g.exceptions,
        chain: g.chain,
        errNode: g.errNode,
        layers: g.layers,
        hint: g.hint,
        count: g.count,
        first: g.first,
        last: g.last,
        m: [...g.min].sort((a, b) => a[0] - b[0]),
        occ: g.occ.slice(-maxOcc),
        samples,
        related: [...g.related],
      };
    });
    groups.sort((a, b) => b.count - a.count);
    return groups;
  }
}

export { Aggregator };
