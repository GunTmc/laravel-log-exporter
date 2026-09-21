/** Bentuk data yang dipakai bersama oleh parser, agregator, CLI, dan template.html. */

export type Layer = 'Middleware' | 'Controller' | 'Service' | 'Repository' | 'Job' | 'Command' | 'Listener' | 'Model' | 'Other' | 'Vendor';
export type Origin = 'HTTP' | 'Queue' | 'Console' | 'Unknown';

/* ---------------- hasil parsing satu entry ---------------- */

export interface ParsedException {
  cls: string;
  msg: string;
  file: string;
  line: number;
  trace: string;
}

export type ParsedEntry = { kind: 'exception'; excs: ParsedException[] } | { kind: 'message'; message: string };

export type Frame =
  | { kind: 'file'; file: string; line: number; call: string }
  | { kind: 'internal'; call: string }
  | { kind: 'main' };

/** "Kelas->method()" dipecah jadi kelas, pemisah (`->` atau `::`), dan method. */
export interface Callee {
  cls: string;
  type: string;
  method: string;
}

/* ---------------- call chain ---------------- */

interface NodeFlags {
  origin?: boolean; // frame app terdalam
  err?: boolean; // tempat exception dilempar
  note?: string;
}

export interface VendorNode extends NodeFlags {
  layer: 'Vendor';
  vendor: number; // jumlah frame vendor berurutan yang dilipat
  samples: string[];
}

export interface AppNode extends NodeFlags {
  layer: Exclude<Layer, 'Vendor'>;
  cls: string;
  method: string;
  line: number;
  file: string;
}

export type ChainNode = VendorNode | AppNode;

export interface ErrNode {
  layer: Layer;
  cls: string;
  method: string;
  line: number;
  file: string;
}

export interface ExceptionInfo {
  cls: string;
  role: 'root' | 'wrapper';
  file: string;
  line: number;
  msg: string;
}

/** Hasil `analyze()`: semua yang diturunkan dari entry pertama sebuah group. */
export interface GroupInfo {
  title: string;
  msg1: string;
  fp: string;
  exceptions: ExceptionInfo[];
  chain: ChainNode[];
  errNode: ErrNode;
  layers: Layer[];
  origin: Origin;
  endpoint: string;
  errClass: string;
  hint: string | null;
  svc: Set<string>; // class Service/Repository/Job, dasar penautan group terkait
}

/* ---------------- keluaran (JSON yang ditanam di template) ---------------- */

export interface Sample {
  t: number;
  raw: string;
}

export interface ReportGroup {
  id: string;
  level: string;
  origin: Origin;
  endpoint: string;
  errClass: string;
  title: string;
  msg1: string;
  fp: string;
  exceptions: ExceptionInfo[];
  chain: ChainNode[];
  errNode: ErrNode;
  layers: Layer[];
  hint: string | null;
  count: number;
  first: number;
  last: number;
  m: Array<[number, number]>; // [ms epoch awal menit, jumlah]
  occ: number[];
  samples: Sample[];
  related: string[];
}

export interface ReportMeta {
  version: string;
  files: string[];
  title: string;
  generatedAt: string;
  minLevel: string;
  from: string | null;
  to: string | null;
  date: string | null;
  tail: number | null;
  entries: number;
  kept: number;
  dropped: number;
  maxGroups: number;
  bytes: number;
  seconds: number;
  reduced: boolean;
  masked: boolean;
  samples: number;
  maxOcc: number;
}

export interface ReportPayload {
  meta: ReportMeta;
  groups: ReportGroup[];
}
