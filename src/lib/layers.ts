import type { Layer } from './types';

/**
 * Aturan klasifikasi layer berdasarkan path file.
 * Urutan penting: aturan pertama yang cocok dipakai.
 * Sesuaikan dengan struktur proyekmu (mis. tambah app/Actions, app/UseCases).
 */
const RULES: Array<{ name: Exclude<Layer, 'Other' | 'Vendor'>; re: RegExp }> = [
  { name: 'Middleware', re: /(^|\/)app\/Http\/Middleware\// },
  { name: 'Controller', re: /(^|\/)app\/Http\/Controllers\// },
  { name: 'Service', re: /(^|\/)app\/Services?\// },
  { name: 'Repository', re: /(^|\/)app\/Repositories\// },
  { name: 'Job', re: /(^|\/)app\/Jobs\// },
  { name: 'Command', re: /(^|\/)app\/Console\/|(^|\/)artisan$/ },
  { name: 'Listener', re: /(^|\/)app\/(Listeners|Observers|Events)\// },
  { name: 'Model', re: /(^|\/)app\/Models?\// },
];

function classify(file: string | null | undefined): Layer {
  if (!file) return 'Vendor';
  const f = file.indexOf('\\') >= 0 ? file.replace(/\\/g, '/') : file;
  if (f.indexOf('vendor/') >= 0 && /(^|\/)vendor\//.test(f)) return 'Vendor';
  for (let i = 0; i < RULES.length; i++) if (RULES[i].re.test(f)) return RULES[i].name;
  if (/(^|\/)app\//.test(f)) return 'Other';
  return 'Vendor'; // public/index.php, bootstrap/, {main}, dll
}

/** Path relatif dari root proyek: "/usr/share/.../app/Services/X.php" -> "app/Services/X.php" */
function relPath(file: string | null | undefined): string {
  if (!file) return '';
  const f = file.replace(/\\/g, '/');
  if (/\/artisan$/.test(f)) return 'artisan';
  return f.replace(/^.*?\/((?:app|vendor|bootstrap|public)\/)/, '$1');
}

export { classify, relPath, RULES };
