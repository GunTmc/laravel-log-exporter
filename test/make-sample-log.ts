#!/usr/bin/env bun
/**
 * Membuat log contoh yang meniru format log produksi. Semua nilai (ID, IP, dll) sintetis.
 *   bun test/make-sample-log.ts --out=sample.log            (satu entry per jenis error + WARNING/INFO)
 *   bun test/make-sample-log.ts --out=big.log --mb=120       (log besar untuk uji performa)
 */
import * as fs from 'fs';

const arg = (n: string, d: string): string => {
  const a = process.argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : d;
};
const OUT = arg('out', 'sample.log');
const TARGET = parseFloat(arg('mb', '0')) * 1024 * 1024;

const ROOT = '/usr/share/nginx/html/portal-seemedik-api';
const V = (p: string) => `${ROOT}/vendor/${p}`;
const A = (p: string) => `${ROOT}/${p}`;
const IL = 'laravel/framework/src/Illuminate/';
interface Frame {
  file: string;
  line: number;
  call: string;
}
interface Exc {
  cls: string;
  msg: string;
  file: string;
  line: number;
  frames: Frame[];
}
const fr = (file: string, line: number, call: string): Frame => ({ file, line, call });

const CTL = 'App\\Http\\Controllers\\Api\\MedicalRecords\\Mcu\\PrintMedicalRecordMcuController';
const CTL_F = A('app/Http/Controllers/Api/MedicalRecords/Mcu/PrintMedicalRecordMcuController.php');
const SVC = 'App\\Services\\MedicalRecords\\Mcu\\PrintMedicalRecordMcuService';
const SVC_F = A('app/Services/MedicalRecords/Mcu/PrintMedicalRecordMcuService.php');

/* ---- bagian luar stack HTTP (dari controller ke atas) ---- */
function httpUp(ctlClass: string): Frame[] {
  const P = 'Illuminate\\Pipeline\\Pipeline';
  const R = 'Illuminate\\Routing\\Router';
  const K = 'Illuminate\\Foundation\\Http\\Kernel';
  const fx = (n: string) => `Illuminate\\Foundation\\Http\\Middleware\\${n}`;
  return [
    fr(V(IL + 'Routing/Controller.php'), 54, `${ctlClass}->__invoke()`),
    fr(V(IL + 'Routing/ControllerDispatcher.php'), 43, 'Illuminate\\Routing\\Controller->callAction()'),
    fr(V(IL + 'Routing/Route.php'), 259, 'Illuminate\\Routing\\ControllerDispatcher->dispatch()'),
    fr(V(IL + 'Routing/Route.php'), 205, 'Illuminate\\Routing\\Route->runController()'),
    fr(V(IL + 'Routing/Router.php'), 798, 'Illuminate\\Routing\\Route->run()'),
    fr(V(IL + 'Pipeline/Pipeline.php'), 141, `${R}->Illuminate\\Routing\\{closure}()`),
    fr(A('app/Http/Middleware/PermissionMiddleware.php'), 36, `${P}->Illuminate\\Pipeline\\{closure}()`),
    fr(V(IL + 'Pipeline/Pipeline.php'), 180, 'App\\Http\\Middleware\\PermissionMiddleware->handle()'),
    fr(A('app/Http/Middleware/VerifyTokenMiddleware.php'), 97, `${P}->Illuminate\\Pipeline\\{closure}()`),
    fr(V(IL + 'Pipeline/Pipeline.php'), 180, 'App\\Http\\Middleware\\VerifyTokenMiddleware->handle()'),
    fr(V(IL + 'Routing/Middleware/SubstituteBindings.php'), 50, `${P}->Illuminate\\Pipeline\\{closure}()`),
    fr(V(IL + 'Pipeline/Pipeline.php'), 180, 'Illuminate\\Routing\\Middleware\\SubstituteBindings->handle()'),
    fr(V(IL + 'Pipeline/Pipeline.php'), 116, `${P}->Illuminate\\Pipeline\\{closure}()`),
    fr(V(IL + 'Routing/Router.php'), 797, `${P}->then()`),
    fr(V(IL + 'Routing/Router.php'), 776, `${R}->runRouteWithinStack()`),
    fr(V(IL + 'Routing/Router.php'), 740, `${R}->runRoute()`),
    fr(V(IL + 'Routing/Router.php'), 729, `${R}->dispatchToRoute()`),
    fr(V(IL + 'Foundation/Http/Kernel.php'), 190, `${R}->dispatch()`),
    fr(V(IL + 'Pipeline/Pipeline.php'), 141, `${K}->Illuminate\\Foundation\\Http\\{closure}()`),
    fr(V(IL + 'Foundation/Http/Middleware/TransformsRequest.php'), 21, `${P}->Illuminate\\Pipeline\\{closure}()`),
    fr(V(IL + 'Foundation/Http/Middleware/ConvertEmptyStringsToNull.php'), 31, `${fx('TransformsRequest')}->handle()`),
    fr(V(IL + 'Pipeline/Pipeline.php'), 180, `${fx('ConvertEmptyStringsToNull')}->handle()`),
    fr(V(IL + 'Foundation/Http/Middleware/TrimStrings.php'), 40, `${fx('TransformsRequest')}->handle()`),
    fr(V(IL + 'Pipeline/Pipeline.php'), 180, `${fx('TrimStrings')}->handle()`),
    fr(V(IL + 'Foundation/Http/Middleware/ValidatePostSize.php'), 27, `${P}->Illuminate\\Pipeline\\{closure}()`),
    fr(V(IL + 'Pipeline/Pipeline.php'), 180, `${fx('ValidatePostSize')}->handle()`),
    fr(V(IL + 'Http/Middleware/HandleCors.php'), 62, `${P}->Illuminate\\Pipeline\\{closure}()`),
    fr(V(IL + 'Pipeline/Pipeline.php'), 180, 'Illuminate\\Http\\Middleware\\HandleCors->handle()'),
    fr(V(IL + 'Pipeline/Pipeline.php'), 116, `${P}->Illuminate\\Pipeline\\{closure}()`),
    fr(V(IL + 'Foundation/Http/Kernel.php'), 165, `${P}->then()`),
    fr(V(IL + 'Foundation/Http/Kernel.php'), 134, `${K}->sendRequestThroughRouter()`),
    fr(A('public/index.php'), 51, `${K}->handle()`),
  ];
}

/* ---- bagian luar stack Queue (dari job ke atas) ---- */
function queueUp(jobClass: string): Frame[] {
  const B = 'Illuminate\\Container\\BoundMethod';
  const C = 'Illuminate\\Queue\\CallQueuedHandler';
  const W = 'Illuminate\\Queue\\Worker';
  const P = 'Illuminate\\Pipeline\\Pipeline';
  return [
    fr(V(IL + 'Container/BoundMethod.php'), 36, `${jobClass}->handle()`),
    fr(V(IL + 'Container/Util.php'), 41, `${B}::Illuminate\\Container\\{closure}()`),
    fr(V(IL + 'Container/BoundMethod.php'), 93, 'Illuminate\\Container\\Util::unwrapIfClosure()'),
    fr(V(IL + 'Container/BoundMethod.php'), 35, `${B}::callBoundMethod()`),
    fr(V(IL + 'Container/Container.php'), 661, `${B}::call()`),
    fr(V(IL + 'Bus/Dispatcher.php'), 128, 'Illuminate\\Container\\Container->call()'),
    fr(V(IL + 'Pipeline/Pipeline.php'), 141, 'Illuminate\\Bus\\Dispatcher->Illuminate\\Bus\\{closure}()'),
    fr(V(IL + 'Pipeline/Pipeline.php'), 116, `${P}->Illuminate\\Pipeline\\{closure}()`),
    fr(V(IL + 'Bus/Dispatcher.php'), 132, `${P}->then()`),
    fr(V(IL + 'Queue/CallQueuedHandler.php'), 123, 'Illuminate\\Bus\\Dispatcher->dispatchNow()'),
    fr(V(IL + 'Queue/CallQueuedHandler.php'), 122, `${P}->then()`),
    fr(V(IL + 'Queue/CallQueuedHandler.php'), 70, `${C}->dispatchThroughMiddleware()`),
    fr(V(IL + 'Queue/Jobs/Job.php'), 98, `${C}->call()`),
    fr(V(IL + 'Queue/Worker.php'), 425, 'Illuminate\\Queue\\Jobs\\Job->fire()'),
    fr(V(IL + 'Queue/Worker.php'), 375, `${W}->process()`),
    fr(V(IL + 'Queue/Worker.php'), 173, `${W}->runJob()`),
    fr(V(IL + 'Queue/Console/WorkCommand.php'), 147, `${W}->daemon()`),
    fr(V(IL + 'Queue/Console/WorkCommand.php'), 130, 'Illuminate\\Queue\\Console\\WorkCommand->runWorker()'),
    fr(V(IL + 'Container/BoundMethod.php'), 36, 'Illuminate\\Queue\\Console\\WorkCommand->handle()'),
    fr(V(IL + 'Container/Util.php'), 41, `${B}::Illuminate\\Container\\{closure}()`),
    fr(V(IL + 'Container/BoundMethod.php'), 93, 'Illuminate\\Container\\Util::unwrapIfClosure()'),
    fr(V(IL + 'Container/BoundMethod.php'), 35, `${B}::callBoundMethod()`),
    fr(V(IL + 'Container/Container.php'), 661, `${B}::call()`),
    fr(V(IL + 'Console/Command.php'), 183, 'Illuminate\\Container\\Container->call()'),
    fr(V('symfony/console/Command/Command.php'), 326, 'Illuminate\\Console\\Command->execute()'),
    fr(V(IL + 'Console/Command.php'), 152, 'Symfony\\Component\\Console\\Command\\Command->run()'),
    fr(V('symfony/console/Application.php'), 1083, 'Illuminate\\Console\\Command->run()'),
    fr(V('symfony/console/Application.php'), 324, 'Symfony\\Component\\Console\\Application->doRunCommand()'),
    fr(V('symfony/console/Application.php'), 175, 'Symfony\\Component\\Console\\Application->doRun()'),
    fr(V(IL + 'Console/Application.php'), 102, 'Symfony\\Component\\Console\\Application->run()'),
    fr(V(IL + 'Foundation/Console/Kernel.php'), 155, 'Illuminate\\Console\\Application->run()'),
    fr(A('artisan'), 35, 'Illuminate\\Foundation\\Console\\Kernel->handle()'),
  ];
}

/* ---- format teks ---- */
function trace(frames: Frame[]): string {
  const lines = frames.map((f, i) => `#${i} ${f.file}(${f.line}): ${f.call}`);
  lines.push(`#${frames.length} {main}`);
  return lines.join('\n');
}
/** Format A: excs root dulu, pembungkus dibelakang ("Next") */
function entryA(ts: string, level: string, excs: Exc[]): string {
  let out = '';
  excs.forEach((e, i) => {
    out += (i === 0 ? `[${ts}] production.${level}: ` : '\n\nNext ') + `${e.cls}: ${e.msg} in ${e.file}:${e.line}\nStack trace:\n${trace(e.frames)}`;
  });
  return out + '  \n';
}
/** Format B: [object] ... [stacktrace] */
function entryB(ts: string, level: string, msg: string, ctx: string, exc: Exc): string {
  return `[${ts}] production.${level}: ${msg} ${ctx}{"exception":"[object] (${exc.cls}(code: 0): ${exc.msg} at ${exc.file}:${exc.line})\n[stacktrace]\n${trace(exc.frames)}\n"} \n`;
}

/* ---- entry-entry contoh ---- */
function e1(ts: string, ip = '192.0.2.10', ms = 50023): string {
  const msg = `cURL error 28: Operation timed out after ${ms} milliseconds with 0 bytes received (see https://curl.haxx.se/libcurl/c/libcurl-errors.html) for http://${ip}:3000/api/v1/medical-records/results/generate`;
  const PR = V(IL + 'Http/Client/PendingRequest.php');
  const shared = [fr(SVC_F, 1399, `${SVC}->generatePdfServer()`), fr(CTL_F, 54, `${SVC}->previewResultMedicalRecord()`), ...httpUp(CTL)];
  const call = () => fr(SVC_F, 1326, `Illuminate\\Http\\Client\\PendingRequest->post('http://${ip}:30...', Array)`);
  const root: Exc = {
    cls: 'GuzzleHttp\\Exception\\ConnectException', msg,
    file: V('guzzlehttp/guzzle/src/Handler/CurlFactory.php'), line: 277,
    frames: [
      fr(V('guzzlehttp/guzzle/src/Handler/CurlFactory.php'), 207, 'GuzzleHttp\\Handler\\CurlFactory::createRejection()'),
      fr(V('guzzlehttp/guzzle/src/Handler/CurlFactory.php'), 159, 'GuzzleHttp\\Handler\\CurlFactory::finishError()'),
      fr(V('guzzlehttp/guzzle/src/Handler/CurlHandler.php'), 47, 'GuzzleHttp\\Handler\\CurlFactory::finish()'),
      fr(V('guzzlehttp/guzzle/src/Handler/Proxy.php'), 28, 'GuzzleHttp\\Handler\\CurlHandler->__invoke()'),
      fr(V('guzzlehttp/guzzle/src/Handler/Proxy.php'), 48, 'GuzzleHttp\\Handler\\Proxy::GuzzleHttp\\Handler\\{closure}()'),
      fr(PR, 1150, 'GuzzleHttp\\Handler\\Proxy::GuzzleHttp\\Handler\\{closure}()'),
      fr(PR, 1116, 'Illuminate\\Http\\Client\\PendingRequest->Illuminate\\Http\\Client\\{closure}()'),
      fr(PR, 1102, 'Illuminate\\Http\\Client\\PendingRequest->Illuminate\\Http\\Client\\{closure}()'),
      fr(V('guzzlehttp/guzzle/src/Client.php'), 333, 'GuzzleHttp\\HandlerStack->__invoke()'),
      fr(PR, 961, 'GuzzleHttp\\Client->request()'),
      fr(PR, 823, 'Illuminate\\Http\\Client\\PendingRequest->sendRequest()'),
      fr(V(IL + 'Support/helpers.php'), 260, 'Illuminate\\Http\\Client\\PendingRequest->Illuminate\\Http\\Client\\{closure}()'),
      fr(PR, 821, 'retry()'),
      fr(PR, 727, 'Illuminate\\Http\\Client\\PendingRequest->send()'),
      call(),
      ...shared,
    ],
  };
  const wrapper: Exc = {
    cls: 'Illuminate\\Http\\Client\\ConnectionException', msg, file: PR, line: 855,
    frames: [
      fr(V(IL + 'Support/helpers.php'), 260, 'Illuminate\\Http\\Client\\PendingRequest->Illuminate\\Http\\Client\\{closure}()'),
      fr(PR, 821, 'retry()'),
      fr(PR, 727, 'Illuminate\\Http\\Client\\PendingRequest->send()'),
      call(),
      ...shared,
    ],
  };
  return entryA(ts, 'ERROR', [root, wrapper]);
}
function e2(ts: string): string {
  return entryA(ts, 'ERROR', [
    {
      cls: 'Exception', msg: 'Failed to Print Data', file: SVC_F, line: 1347,
      frames: [fr(SVC_F, 1399, `${SVC}->generatePdfServer()`), fr(CTL_F, 54, `${SVC}->previewResultMedicalRecord()`), ...httpUp(CTL)],
    },
  ]);
}
const JOB = 'App\\Jobs\\BulkProcesses\\GenerateCriticalCases\\GenerateCriticalCaseJob';
function e3(ts: string, a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002', c = '00000000-0000-4000-8000-000000000003'): string {
  const C = 'Illuminate\\Database\\Connection';
  const EB = 'Illuminate\\Database\\Eloquent\\Builder';
  const EM = 'Illuminate\\Database\\Eloquent\\Model';
  const D = V(IL + 'Database/');
  const msg = `SQLSTATE[23505]: Unique violation: 7 ERROR:  duplicate key value violates unique constraint "critical_parameter_results_registration_product_id_examination_"\nDETAIL:  Key (registration_product_id, examination_item_id, description_detail_id, critical_category)=(${a}, ${b}, ${c}, URGENT) already exists.`;
  return entryA(ts, 'ERROR', [
    {
      cls: 'PDOException', msg, file: D + 'Connection.php', line: 545,
      frames: [
        fr(D + 'Connection.php', 545, 'PDOStatement->execute()'),
        fr(D + 'Connection.php', 753, `${C}->Illuminate\\Database\\{closure}()`),
        fr(D + 'Connection.php', 720, `${C}->runQueryCallback()`),
        fr(D + 'Connection.php', 534, `${C}->run()`),
        fr(D + 'Connection.php', 498, `${C}->statement()`),
        fr(D + 'Query/Builder.php', 3272, `${C}->insert()`),
        fr(D + 'Eloquent/Builder.php', 1869, 'Illuminate\\Database\\Query\\Builder->insert()'),
        fr(D + 'Eloquent/Model.php', 1306, `${EB}->__call()`),
        fr(D + 'Eloquent/Model.php', 1138, `${EM}->performInsert()`),
        fr(D + 'Eloquent/Builder.php', 986, `${EM}->save()`),
        fr(V(IL + 'Support/helpers.php'), 319, `${EB}->Illuminate\\Database\\Eloquent\\{closure}()`),
        fr(D + 'Eloquent/Builder.php', 985, 'tap()'),
        fr(V(IL + 'Support/Traits/ForwardsCalls.php'), 23, `${EB}->create()`),
        fr(D + 'Eloquent/Model.php', 2330, `${EM}->forwardCallTo()`),
        fr(D + 'Eloquent/Model.php', 2342, `${EM}->__call()`),
        fr(A('app/Repositories/CriticalParameters/CriticalParameterResultRepository.php'), 29, `${EM}::__callStatic()`),
        fr(A('app/Services/MedicalRecords/BulkProcess/GenerateCriticalCases/CriticalParameterResultService.php'), 123, 'App\\Repositories\\CriticalParameters\\CriticalParameterResultRepository->createCriticalParameterResult()'),
        fr(A('app/Services/MedicalRecords/BulkProcess/GenerateCriticalCases/GenerateCriticalCaseService.php'), 245, 'App\\Services\\MedicalRecords\\BulkProcess\\GenerateCriticalCases\\CriticalParameterResultService->storeCriticalParameterResult()'),
        fr(A('app/Jobs/BulkProcesses/GenerateCriticalCases/GenerateCriticalCaseJob.php'), 69, 'App\\Services\\MedicalRecords\\BulkProcess\\GenerateCriticalCases\\GenerateCriticalCaseService->generateCriticalCase()'),
        ...queueUp(JOB),
      ],
    },
  ]);
}
/** Format B (default Laravel/Monolog), error non-fatal di service lain */
function eB(ts: string, key = 'patient_id'): string {
  const RS = 'App\\Services\\MedicalRecords\\Mcu\\McuResultService';
  const RSF = A('app/Services/MedicalRecords/Mcu/McuResultService.php');
  const RC = 'App\\Http\\Controllers\\Api\\MedicalRecords\\Mcu\\McuResultController';
  return entryB(ts, 'ERROR', `Undefined array key "${key}"`, '{"userId":12} ', {
    cls: 'ErrorException', msg: `Undefined array key \\"${key}\\"`.replace(/\\"/g, '"'), file: RSF, line: 212,
    frames: [
      fr(RSF, 212, `Illuminate\\Foundation\\Bootstrap\\HandleExceptions->handleError(2, 'Undefined arra...', '${RSF}', 212)`),
      fr(A('app/Http/Controllers/Api/MedicalRecords/Mcu/McuResultController.php'), 41, `${RS}->buildResultPayload()`),
      ...httpUp(RC),
    ],
  });
}
const warn = (ts: string, ms: number) => `[${ts}] production.WARNING: Slow query detected {"time":${ms},"sql":"select * from registrations where id = ?"} []\n`;
const info = (ts: string, i: number) => `[${ts}] production.INFO: Report generated {"user_id":${i % 90},"duration_ms":${100 + (i % 900)}} []\n`;

/* ---- daftar group acak untuk log besar ---- */
const extra: Array<(ts: string) => string> = [];
for (let i = 1; i <= 25; i++) {
  const svc = `App\\Services\\Module${i}\\Module${i}Service`;
  const file = A(`app/Services/Module${i}/Module${i}Service.php`);
  const ctl = `App\\Http\\Controllers\\Api\\Module${i}\\Module${i}Controller`;
  const ctlF = A(`app/Http/Controllers/Api/Module${i}/Module${i}Controller.php`);
  extra.push((ts: string) =>
    entryA(ts, 'ERROR', [
      {
        cls: i % 3 ? 'RuntimeException' : 'InvalidArgumentException', msg: `Gagal memproses data nomor ${1000 + Math.floor(Math.random() * 9000)} pada modul ${i}`,
        file, line: 100 + i,
        frames: [fr(ctlF, 30 + i, `${svc}->process()`), ...httpUp(ctl)],
      },
    ])
  );
}

/* ---- tulis ---- */
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (sec: number) => `2026-09-21 ${pad((sec / 3600) | 0)}:${pad(((sec % 3600) / 60) | 0)}:${pad(sec % 60)}`;
const out = fs.createWriteStream(OUT);
let bytes = 0;
const w = (s: string): void => {
  bytes += Buffer.byteLength(s);
  out.write(s);
};

if (!TARGET) {
  w(e1('2026-09-21 11:11:32'));
  w(e2('2026-09-21 11:11:32'));
  w(e3('2026-09-21 11:16:05'));
  w(eB('2026-09-21 11:20:10'));
  w(warn('2026-09-21 11:30:00', 1523));
  w(info('2026-09-21 11:31:00', 1));
} else {
  const est = TARGET / 1800;
  const step = 86399 / est;
  let i = 0;
  let t = 0;
  while (bytes < TARGET) {
    const ts = stamp(Math.min(86399, Math.floor(t)));
    t += step;
    const r = Math.random();
    if (r < 0.7) w(info(ts, i));
    else if (r < 0.76) w(warn(ts, 1000 + (i % 3000)));
    else if (r < 0.82) w(e1(ts, `192.0.2.${1 + (i % 100)}`, 50000 + (i % 100)));
    else if (r < 0.86) w(e2(ts));
    else if (r < 0.92) w(e3(ts, `${(i * 7919).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`));
    else if (r < 0.95) w(eB(ts, ['patient_id', 'doctor_id', 'result_id'][i % 3]));
    else w(extra[i % extra.length](ts));
    i++;
  }
}
out.end(() => console.error(`Dibuat ${OUT} (${(bytes / 1048576).toFixed(1)} MB)`));
