import { parentPort } from 'node:worker_threads';
const { createMetricsProvider } = await import('/app/server/metrics/metricsProvider.mjs');
const { computeCanonicalMetrics } = await import('/app/server/metrics/canonicalMetricsService.mjs');
const provider = createMetricsProvider();          // se crea UNA vez
parentPort.on('message', async ({id, organizationId, period, now}) => {
  try {
    const r = await computeCanonicalMetrics({ scopeKind:'organization', organizationId, period,
      idleMs:900000, includeQuality:true, provider, clock:()=>now });
    parentPort.postMessage({ id, ok:true, metrics:r.body.metrics, population:r.body.population });
  } catch(e){ parentPort.postMessage({ id, ok:false, code:e?.code||'ERR' }); }
});
