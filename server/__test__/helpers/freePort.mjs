/**
 * freePort.mjs — CHP-TECH-STABILITY-01.
 *
 * Puertos libres asignados por el sistema operativo, para arrancar `server.js`
 * en pruebas. Sustituye a `base + (process.pid % N)`: esos rangos pueden caer en
 * puertos que `fetch` rechaza con `bad port` (5060, 6000, 6665–6669…) aunque el
 * servidor esté sano. El rango efímero queda por encima de todos ellos.
 *
 * Mantiene abiertos los puertos pedidos hasta tenerlos todos, para que dos
 * llamadas de un mismo lote no reciban el mismo.
 */
import net from 'node:net';

export function freePorts(count) {
    const open = Array.from({ length: count }, () => new Promise((resolve, reject) => {
        const s = net.createServer();
        s.unref();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => resolve(s));
    }));
    return Promise.all(open).then((servers) => {
        const ports = servers.map((s) => s.address().port);
        return Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve)))).then(() => ports);
    });
}

export const freePort = async () => (await freePorts(1))[0];
