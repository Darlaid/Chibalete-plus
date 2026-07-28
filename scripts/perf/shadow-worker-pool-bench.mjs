/** Variante D2-pool: worker persistente. Mide el coste en el HILO PRINCIPAL,
 *  que es lo que determina el p95 publico. */
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
const S=JSON.parse(fs.readFileSync('/app/data/schools_db.json','utf8'));
const now=Date.now(), P30={fromTs:now-30*86400000,toTs:now,days:30};
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*p))];};
const hr=()=>Number(process.hrtime.bigint())/1e6;
function lagMeter(){const s=[];let last=hr();const t=setInterval(()=>{const n=hr();s.push(n-last-10);last=n;},10);if(t.unref)t.unref();return{stop(){clearInterval(t);return s.filter(x=>x>0);}};}

// pool de 1 worker persistente
const w = new Worker('/tmp/perf_pool_worker.mjs');
let seq=0; const pend=new Map();
w.on('message', m=>{ const r=pend.get(m.id); if(r){pend.delete(m.id); r(m);} });
const ready = new Promise(r=>w.once('online', r));
await ready;
const call = (organizationId) => new Promise(res=>{ const id=++seq; pend.set(id,res); w.postMessage({id,organizationId,period:P30,now}); });
await call(S[0].id); // warm: el worker carga modulos UNA vez

const ITER=Number(process.env.ITER||15);
console.log(`=== VARIANTE D2-POOL (worker persistente, iter=${ITER}) ===`);

// 1) coste en el HILO PRINCIPAL: solo postMessage + recepcion
{
  const main=[]; const lm=lagMeter(); const m0=process.memoryUsage().rss;
  const total=[];
  for(let i=0;i<ITER;i++){
    const t0=hr();
    const p=call(S[0].id);           // postMessage: coste del hilo principal
    const tMain=hr()-t0;             // lo que el hilo principal realmente gasta
    await p;
    total.push(hr()-t0); main.push(tMain);
  }
  const lags=lm.stop(); const m1=process.memoryUsage().rss;
  console.log(`  coste_hilo_principal   p50=${q(main,.5).toFixed(2)}ms p95=${q(main,.95).toFixed(2)}ms`);
  console.log(`  latencia_canonica_total p50=${q(total,.5).toFixed(0)}ms p95=${q(total,.95).toFixed(0)}ms`);
  console.log(`  event_loop_lag_p95=${(lags.length?q(lags,.95):0).toFixed(1)}ms  rss_delta=${Math.round((m1-m0)/1048576)}MB`);
}

// 2) simulacion: peticiones legacy concurrentes mientras el worker trabaja
{
  const lm=lagMeter();
  const legacyLat=[];
  const busy=[]; for(let i=0;i<6;i++) busy.push(call(S[0].id));   // 6 trabajos canonicos en vuelo
  for(let i=0;i<30;i++){ const t=hr(); await new Promise(r=>setImmediate(r)); legacyLat.push(hr()-t); }
  await Promise.all(busy);
  const lags=lm.stop();
  console.log(`  con 6 canonicos en vuelo: turno_loop p95=${q(legacyLat,.95).toFixed(2)}ms  lag_p95=${(lags.length?q(lags,.95):0).toFixed(1)}ms`);
}
await w.terminate();
console.log('  worker_terminado_limpio=true');
