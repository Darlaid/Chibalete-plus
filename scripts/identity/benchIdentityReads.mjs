#!/usr/bin/env node
/**
 * benchIdentityReads.mjs — CHP-IDDB-02C-A, Fase 15.
 *
 * Mide lecturas JSON vs SQLite sobre COPIAS (jamás producción). El backend
 * JSON reproduce el patrón real del runtime: `readJSON` cachea el array
 * parseado y cada solicitud hace `.find(...)` sobre él; se mide por tanto el
 * lookup sobre el array cacheado (caso caliente) y el parse completo (caso
 * frío). El backend SQLite usa el identityRepo real en readonly.
 *
 * READ-ONLY, sin PII en stdout (solo métricas agregadas).
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveLiveSources } from './identityLiveSources.mjs';
import { makeIdentityRepo } from '../../server/repositories/identityRepo.js';

const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (ns) => ({
    n: ns.length,
    p50_us: Math.round(pct(ns, 50) / 1e3 * 10) / 10,
    p95_us: Math.round(pct(ns, 95) / 1e3 * 10) / 10,
    p99_us: Math.round(pct(ns, 99) / 1e3 * 10) / 10,
    ops_per_s: Math.round(ns.length / (ns.reduce((a, b) => a + b, 0) / 1e9)),
});
function bench(fn, iters) {
    const ns = [];
    for (let i = 0; i < Math.min(200, iters); i++) fn(i);          // calentamiento
    for (let i = 0; i < iters; i++) {
        const t0 = process.hrtime.bigint();
        fn(i);
        ns.push(Number(process.hrtime.bigint() - t0));
    }
    return stats(ns);
}

function parseArgs(argv) {
    const a = { iters: 2000 };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--sources-root') a.sourcesRoot = argv[++i];
        else if (argv[i] === '--identity-db') a.identityDbPath = argv[++i];
        else if (argv[i] === '--iters') a.iters = Number(argv[++i]);
    }
    return a;
}

const { sourcesRoot, identityDbPath, iters } = parseArgs(process.argv.slice(2));
const { sources } = resolveLiveSources({ sourcesRoot });
const db = new Database(path.resolve(identityDbPath), { readonly: true });
const repo = makeIdentityRepo(db);

const users = sources.users;                       // array cacheado (caso caliente JSON)
const groups = sources.groups;
const canonicalIds = repo.users.all().map(u => String(u.id));
const canonicalGroupIds = repo.groups.all().map(g => String(g.id));
const uid = (i) => canonicalIds[i % canonicalIds.length];
const gid = (i) => canonicalGroupIds[i % canonicalGroupIds.length];
const usersFile = path.resolve(sourcesRoot, 'data-critical', 'usuarios_colegios_oro.json');

const out = { tool: 'benchIdentityReads', iters, corpus: {
    users_json: users.length, users_sqlite: canonicalIds.length,
    groups_json: groups.length, groups_sqlite: canonicalGroupIds.length } };

out.point_user_lookup = {
    json_hot_find: bench((i) => users.find(u => String(u.id) === uid(i)), iters),
    sqlite_byId: bench((i) => repo.users.byId(uid(i)), iters),
};
out.user_by_email = {
    json_hot_find: bench((i) => {
        const em = String(users[i % users.length].email ?? '').toLowerCase();
        return users.find(u => String(u.email ?? '').toLowerCase() === em);
    }, iters),
    sqlite_byEmail: bench((i) => repo.users.byEmail(String(users[i % users.length].email ?? '')), iters),
};
out.group_lookup = {
    json_hot_find: bench((i) => groups.find(g => String(g.id) === gid(i)), iters),
    sqlite_byId: bench((i) => repo.groupsV2.byId(gid(i)), iters),
};
out.memberships_of_user = {
    json_hot_scan: bench((i) => {
        const id = uid(i); const res = [];
        for (const g of groups) {
            for (const [f, role] of [['studentIds', 'member'], ['memberIds', 'member'],
                                     ['mediatorIds', 'mediator'], ['teacherId', 'mediator']]) {
                const v = g[f];
                const list = Array.isArray(v) ? v : (v ? [v] : []);
                if (list.some(x => String(x) === id)) res.push(`${g.id}|${role}`);
            }
        }
        return res;
    }, iters),
    sqlite_ofUser: bench((i) => repo.memberships.ofUser(uid(i)), iters),
};
out.list_all_users = {
    json_cold_parse: bench(() => JSON.parse(fs.readFileSync(usersFile, 'utf8')), Math.min(iters, 300)),
    sqlite_all: bench(() => repo.users.all(), Math.min(iters, 300)),
};
out.members_of_group = {
    json_hot: bench((i) => {
        const g = groups.find(x => String(x.id) === gid(i));
        return [...(g.studentIds ?? []), ...(g.memberIds ?? []), ...(g.mediatorIds ?? [])];
    }, iters),
    sqlite_membersOf: bench((i) => repo.groupsV2.membersOf(gid(i)), iters),
};

db.close();
console.log(JSON.stringify(out, null, 1));
