/**
 * ttsManifest.mjs — G4-PILOT-UX-03B-FIX.
 *
 * Qué tiene un manifiesto TTS (`/uploads/audio/<id>/manifest.json`). Módulo puro.
 *
 * El manifiesto v2 guarda `_meta` junto a los fragmentos indexados por número
 * ("0", "1", …), cada uno con su `file`. Un manifiesto que solo trae `_meta`
 * (TTS declarado pero sin fragmentos generados) NO tiene audio: contar sus
 * claves daba 1 y el visor creía tener «libro completo» y no reproducía nada.
 */

/** Índices numéricos con un `file` reproducible, en orden. */
export function playableChunkIndexes(manifest) {
    if (!manifest || typeof manifest !== 'object') return [];
    return Object.keys(manifest)
        .filter((k) => /^\d+$/.test(k) && typeof manifest[k]?.file === 'string' && manifest[k].file.length > 0)
        .map(Number)
        .sort((a, b) => a - b);
}

/** Número de fragmentos reproducibles. */
export const playableChunkCount = (manifest) => playableChunkIndexes(manifest).length;

/**
 * Estado del audio pre-generado:
 *  - 'none'        no hay manifiesto (el visor usa la vista previa bajo demanda, como siempre);
 *  - 'unavailable' hay manifiesto pero ningún fragmento reproducible: no se simula nada;
 *  - 'ready'       hay fragmentos.
 */
export function manifestAudioState(manifest) {
    if (!manifest) return 'none';
    return playableChunkCount(manifest) > 0 ? 'ready' : 'unavailable';
}
