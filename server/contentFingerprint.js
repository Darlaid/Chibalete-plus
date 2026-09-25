/**
 * contentFingerprint.js — CHP-CONTENT-CANONICAL-2026-01 PARTE 1B.
 *
 * Identidad de la VERSIÓN TEXTUAL de un Content, calculada solo en el servidor.
 *
 *   contentFingerprint = 'sha256:' + sha256(UTF-8 del texto normalizado)
 *   contentVersion     = contador monotónico por Content id: sube en 1 cada vez
 *                        que el fingerprint cambia y nunca retrocede.
 *
 * El fingerprint NO depende de URL, nombre de archivo, MIME, formato de origen
 * ni fechas: dos fuentes que producen el mismo texto dan la misma identidad.
 * Es distinto del hash de chunk del TTS (md5 por chunk + motor, ttsService.js):
 * ese identifica audio; este identifica el texto completo.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const CONTENT_FINGERPRINT_PREFIX = 'sha256:';

/**
 * Normalización explícita y conservadora. Solo elimina diferencias que ningún
 * modo de lectura distingue:
 *   - BOM UTF-8 inicial (U+FEFF);
 *   - finales de línea CRLF y CR sueltos → LF;
 *   - espacios y tabuladores al final de cada línea;
 *   - saltos de línea al final del archivo.
 * NO toca palabras, puntuación, líneas en blanco intermedias (separan párrafos)
 * ni la forma Unicode: NFC y NFD se leen igual pero el parser del Modo Accesible
 * los trata distinto (p. ej. «capítulo»), así que no son la misma versión.
 */
export function normalizeTextForContentFingerprint(text) {
    return String(text)
        .replace(/^﻿/, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n+$/, '');
}

export function computeContentFingerprint(text) {
    const normalized = normalizeTextForContentFingerprint(text);
    return CONTENT_FINGERPRINT_PREFIX + crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

const isVersion = (v) => Number.isInteger(v) && v >= 1;

/**
 * Siguiente par {contentFingerprint, contentVersion} para un fingerprint recién
 * calculado. Mismo fingerprint → misma versión; distinto → versión + 1. Volver a
 * un texto anterior NO reutiliza su versión: el contador solo avanza.
 */
export function nextContentTextVersion(previous, fingerprint) {
    const prevVersion = isVersion(previous?.contentVersion) ? previous.contentVersion : 0;
    if (previous?.contentFingerprint && previous.contentFingerprint === fingerprint) {
        return { contentFingerprint: fingerprint, contentVersion: prevVersion || 1 };
    }
    return { contentFingerprint: fingerprint, contentVersion: prevVersion + 1 };
}

// Tope de lectura: el texto más grande del corpus ronda 600 KB.
export const MAX_FINGERPRINT_SOURCE_BYTES = 20 * 1024 * 1024;

/**
 * Lee el texto de una URL `/uploads/...` confinada a `uploadDir`. Devuelve
 * `null` (sin lanzar) si la URL no es de uploads, escapa del directorio, no
 * existe, excede el tope o no es un archivo regular.
 */
export function readUploadTextForFingerprint(uploadDir, url) {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
    const root = path.resolve(uploadDir);
    const target = path.resolve(root, url.slice('/uploads/'.length));
    if (!target.startsWith(root + path.sep)) return null;
    try {
        const stat = fs.statSync(target);
        if (!stat.isFile() || stat.size > MAX_FINGERPRINT_SOURCE_BYTES) return null;
        return fs.readFileSync(target, 'utf8');
    } catch {
        return null;
    }
}
