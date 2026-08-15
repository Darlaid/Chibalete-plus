/**
 * sessionIdentity.test.mjs — CHP-IDDB-M1-A-SESSION-IDENTITY-01.
 * Unidades base: token HMAC, store de revocación, servicio central y modos.
 * Hermético cross-plataforma: sessions.db en temp + keyProvider inyectado.
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

import {
    generateSid, hashSid, signSessionToken, verifySessionToken,
} from '../lib/sessionToken.js';
import { closeSessionsDb } from '../db/sessionsDb.js';
import {
    persistSession, getSessionState, revokeSession, revokeAllUserSessions, cleanupExpiredSessions,
} from '../db/sessionStore.js';
import {
    createSessionAuth, credentialVersionOf, bumpCredentialVersion,
    parseCookies, csrfCheck, SESSION_COOKIE,
} from '../lib/sessionAuth.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_sess_'));
process.env.SESSIONS_DB = path.join(tmp, 'sessions.db');
const KEY = crypto.randomBytes(32).toString('hex');
const KEY2 = crypto.randomBytes(32).toString('hex');
const keyProvider = { readCurrent: async () => KEY, readVerification: async () => [KEY, KEY2] };

const nowSec = () => Math.floor(Date.now() / 1000);

async function main() {
    console.log('\n[1] TOKEN: firma/verificación, tamper, expiración');
    const sid = generateSid();
    const tok = signSessionToken({ sub: 'u1', sid, iat: nowSec(), exp: nowSec() + 100, cv: 0 }, KEY);
    ok('token bien formado (body.sig)', tok.split('.').length === 2);
    ok('verify válido', verifySessionToken(tok, [KEY]).ok === true);
    ok('verify con clave equivocada → bad_signature', verifySessionToken(tok, [KEY2]).reason === 'bad_signature');
    ok('verify multi-clave (previous) acepta', verifySessionToken(tok, [KEY2, KEY]).ok === true);
    const tampered = tok.slice(0, -2) + (tok.endsWith('AA') ? 'BB' : 'AA');
    ok('tamper de firma → rechazo', verifySessionToken(tampered, [KEY]).ok === false);
    const expired = signSessionToken({ sub: 'u1', sid, iat: nowSec() - 200, exp: nowSec() - 100, cv: 0 }, KEY);
    ok('token expirado → expired', verifySessionToken(expired, [KEY]).reason === 'expired');
    ok('payload sin campos → malformed', verifySessionToken('x.y', [KEY]).reason !== undefined);
    ok('hashSid no revela el sid', hashSid(sid) !== sid && /^[0-9a-f]{64}$/.test(hashSid(sid)));
    // El token no lleva roles/email/password.
    const decoded = JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString());
    ok('payload mínimo (solo sub,sid,iat,exp,cv)',
        Object.keys(decoded).sort().join(',') === 'cv,exp,iat,sid,sub');

    console.log('\n[2] STORE: persistencia y revocación');
    const s1 = generateSid();
    persistSession({ sid: s1, userId: 'u1', issuedAtSec: nowSec(), expiresAtSec: nowSec() + 100, credentialVersion: 0 });
    ok('estado inicial vivo', getSessionState(s1) && !getSessionState(s1).revoked && !getSessionState(s1).expired);
    ok('revokeSession revoca', revokeSession(s1) === true && getSessionState(s1).revoked === true);
    ok('revoke idempotente', revokeSession(s1) === false);
    ok('sid desconocido → null', getSessionState(generateSid()) === null);
    // Expirada.
    const s2 = generateSid();
    persistSession({ sid: s2, userId: 'u1', issuedAtSec: nowSec() - 200, expiresAtSec: nowSec() - 100, credentialVersion: 0 });
    ok('sesión expirada detectada', getSessionState(s2).expired === true);
    // Revoke-all.
    const a = generateSid(), b = generateSid();
    persistSession({ sid: a, userId: 'u2', issuedAtSec: nowSec(), expiresAtSec: nowSec() + 100, credentialVersion: 0 });
    persistSession({ sid: b, userId: 'u2', issuedAtSec: nowSec(), expiresAtSec: nowSec() + 100, credentialVersion: 0 });
    ok('revokeAllUserSessions revoca 2', revokeAllUserSessions('u2') === 2);
    ok('cleanupExpired borra la expirada', cleanupExpiredSessions() >= 1);

    console.log('\n[3] credentialVersion helpers');
    ok('ausente ⇒ 0', credentialVersionOf({}) === 0 && credentialVersionOf(null) === 0);
    ok('valor válido', credentialVersionOf({ credentialVersion: 3 }) === 3);
    ok('negativo/invalid ⇒ 0', credentialVersionOf({ credentialVersion: -1 }) === 0);
    const u = { id: 'x' }; ok('bump 0→1', bumpCredentialVersion(u) === 1 && u.credentialVersion === 1);

    console.log('\n[4] parseCookies + CSRF');
    ok('parse cookie', parseCookies(`a=1; ${SESSION_COOKIE}=tok; b=2`)[SESSION_COOKIE] === 'tok');
    ok('GET exento', csrfCheck({ method: 'GET', headers: {} }).ok === true);
    ok('máquina admin exenta', csrfCheck({ method: 'POST', headers: {} }, { isMachine: true }).ok === true);
    ok('POST sin cookie de sesión → no aplica CSRF', csrfCheck({ method: 'POST', headers: {} }).ok === true);
    const withCookie = { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=x` } };
    ok('POST cookie + origin permitido', csrfCheck(withCookie, { allowedOrigins: ['https://app'] }) &&
        csrfCheck({ ...withCookie, headers: { ...withCookie.headers, origin: 'https://app' } }, { allowedOrigins: ['https://app'] }).ok === true);
    ok('POST cookie + origin ajeno → deny', csrfCheck({ ...withCookie, headers: { ...withCookie.headers, origin: 'https://evil' } }, { allowedOrigins: ['https://app'] }).ok === false);
    ok('POST cookie + Sec-Fetch-Site same-origin → ok', csrfCheck({ ...withCookie, headers: { ...withCookie.headers, 'sec-fetch-site': 'same-origin' } }).ok === true);

    console.log('\n[5] SERVICE: modos off/compat/enforce, mismatch, revocación, active, cv');
    const USERS = [
        { id: 'real1', accountStatus: 'active', credentialVersion: 0 },
        { id: 'disabled1', accountStatus: 'disabled', credentialVersion: 0 },
    ];
    const isUserActive = (usr) => !usr?.accountStatus || usr.accountStatus === 'active';
    const auth = createSessionAuth({ readUsersPhysical: () => USERS, isUserActive, keyProvider });

    // Emitir sesión para real1.
    const issued = await auth.issueSession(USERS[0]);
    const cookieHeader = `${SESSION_COOKIE}=${issued.token}`;

    // off: solo x-user-id.
    process.env.SESSION_AUTH_MODE = 'off';
    ok('off: x-user-id activo → ok', (await auth.authenticate({ headers: { 'x-user-id': 'real1' } })).ok === true);
    ok('off: x-user-id disabled → 401', (await auth.authenticate({ headers: { 'x-user-id': 'disabled1' } })).status === 401);
    ok('off: ignora cookie', (await auth.authenticate({ headers: { cookie: cookieHeader } })).ok === false);

    // compat: sesión autoritativa.
    process.env.SESSION_AUTH_MODE = 'compat';
    const d1 = await auth.authenticate({ headers: { cookie: cookieHeader } });
    ok('compat: sesión válida → ok, authMethod session', d1.ok === true && d1.authMethod === 'session' && d1.userId === 'real1');
    ok('compat: sesión + x-user-id igual → ok', (await auth.authenticate({ headers: { cookie: cookieHeader, 'x-user-id': 'real1' } })).ok === true);
    ok('compat: sesión + x-user-id distinto → subject_mismatch',
        (await auth.authenticate({ headers: { cookie: cookieHeader, 'x-user-id': 'real2' } })).reason === 'subject_mismatch');
    ok('compat: solo x-user-id legacy aún válido', (await auth.authenticate({ headers: { 'x-user-id': 'real1' } })).authMethod === 'legacy_x_user_id');

    // enforce: sesión requerida.
    process.env.SESSION_AUTH_MODE = 'enforce';
    ok('enforce: sin sesión y x-user-id externo → session_required',
        (await auth.authenticate({ headers: { 'x-user-id': 'real1' } })).reason === 'session_required');
    ok('enforce: sesión válida → ok', (await auth.authenticate({ headers: { cookie: cookieHeader } })).ok === true);
    process.env.SESSION_LEGACY_ALLOW = '1';
    ok('enforce+allowlist: x-user-id interno permitido', (await auth.authenticate({ headers: { 'x-user-id': 'real1' } })).ok === true);
    delete process.env.SESSION_LEGACY_ALLOW;

    // Revocación por logout normal.
    process.env.SESSION_AUTH_MODE = 'compat';
    ok('logout normal revoca ese sid', auth.revokeSession(issued.sid) === true);
    ok('sesión revocada → 401 revoked', (await auth.authenticate({ headers: { cookie: cookieHeader } })).reason === 'revoked');

    // Disable con sesión viva: cv bump invalida.
    const issued2 = await auth.issueSession(USERS[0]);
    const ch2 = `${SESSION_COOKIE}=${issued2.token}`;
    ok('nueva sesión válida', (await auth.authenticate({ headers: { cookie: ch2 } })).ok === true);
    USERS[0].accountStatus = 'disabled';
    ok('disable → 401 disabled', (await auth.authenticate({ headers: { cookie: ch2 } })).reason === 'disabled');
    USERS[0].accountStatus = 'active';
    bumpCredentialVersion(USERS[0]); // reset/forced revoke
    ok('credentialVersion++ → 401 credential_version_mismatch',
        (await auth.authenticate({ headers: { cookie: ch2 } })).reason === 'credential_version_mismatch');

    console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
}

main().then(() => { closeSessionsDb(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); closeSessionsDb(); process.exit(1); });
