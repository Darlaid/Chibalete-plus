/**
 * personalReading.mjs — CHP V9 Bloque III · F5-DP2. Lectura personal fuera de los indicadores institucionales.
 *
 * Los indicadores derivados de Aula Viva (perfil, señales, riesgo, recomendaciones, vector de rasgos, series, cohortes,
 * impacto) se calculan a partir de las filas de `events.db` de cada lector. Esas filas incluyen la lectura PERSONAL: la
 * de una cuenta personal (compra B2C, sin institución) y la de las obras que un lector de colegio tiene solo por una
 * compra propia. Son instrumentos institucionales: la lectura personal no entra en ellos.
 *
 * Aquí no hay un clasificador nuevo. `server.js` registra el suyo (`personalReadingBoundary`, el de F5-DP: el mismo que
 * decide qué progreso ve la administración) y los motores que leen eventos crudos lo aplican a sus filas antes de
 * calcular nada. Lo que ve el titular no pasa por aquí: su progreso, su biblioteca y sus métricas propias siguen completos.
 *
 * Sin clasificador registrado (pruebas unitarias de un motor aislado) las filas pasan sin cambios. Si el clasificador
 * falla para una cuenta, sus filas NO entran (fallo cerrado): un motor calcula después, nunca con lectura sin clasificar.
 */

/** @type {null | ((userId: string) => (contentId: unknown) => boolean)} */
let resolver = null;

/** Registra (o retira, con null) el clasificador: `(userId) => (contentId) => esPersonal`. */
export function setPersonalReadingResolver(fn) {
    resolver = typeof fn === 'function' ? fn : null;
}

/** Clasificador de UNA cuenta por petición o corrida (memoizado por quien lo pide). */
export function personalWorkPredicate(userId) {
    if (!resolver) return () => false;
    try {
        const work = resolver(String(userId ?? ''));
        return typeof work === 'function' ? work : () => true;
    } catch {
        return () => true;
    }
}

/**
 * Prueba por fila para UNA corrida de un motor: `(fila) => esLecturaPersonalDeSuSujeto`. Clasifica cada cuenta una sola
 * vez. Una fila sin sujeto no se clasifica (no es de nadie): quien llama decide qué hace con ella.
 * @returns {(row: {user_id?: unknown, content_id?: unknown} | null | undefined) => boolean}
 */
export function personalRowTest() {
    const memo = new Map();
    return (row) => {
        if (!resolver || !row || !row.user_id) return false;
        const uid = String(row.user_id);
        if (!memo.has(uid)) memo.set(uid, personalWorkPredicate(uid));
        return memo.get(uid)(row.content_id) === true;
    };
}

/**
 * Filas institucionales: las de `rows` que no son lectura personal de su propio sujeto. Conserva el orden y la marca
 * `truncated` de la lista. `isPersonal`: la prueba de la corrida, para compartir la clasificación entre llamadas.
 * @template T
 * @param {T[]} rows  filas con `user_id` y `content_id` (events.db)
 * @param {(row: T) => boolean} [isPersonal]
 * @returns {T[]}
 */
export function institutionalRows(rows, isPersonal = personalRowTest()) {
    if (!resolver || !Array.isArray(rows)) return rows;
    const out = rows.filter((row) => !isPersonal(row));
    if (rows.truncated === true) out.truncated = true;
    return out;
}
