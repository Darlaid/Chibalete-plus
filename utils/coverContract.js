/**
 * coverContract.js — CHP-MOOK-COVER-UPLOAD-01A
 *
 * Los NÚMEROS del contrato de cubierta, y nada más.
 *
 * Vive separado de `coverPolicy.js` por una razón concreta: la política lee
 * cabeceras binarias y depende de `Buffer`, que es de Node. Este archivo no
 * depende de nada, así que el bundle del navegador puede importarlo y el
 * Studio valida contra los MISMOS valores que aplica el backend.
 *
 * Si estos números se duplicaran en el frontend, tarde o temprano divergirían y
 * el operador vería aceptada en pantalla una imagen que el servidor rechaza.
 *
 * **Por qué en `utils/` y no en `server/lib/`.** Nació en `server/lib/` y el
 * frontend lo importaba cruzando carpetas. Funcionaba en local y en CI —ambos
 * construyen sobre el árbol completo— pero **`Dockerfile.front` NO copia
 * `server/`**, así que la imagen productiva de frontend no compilaba:
 *
 *     Could not resolve "../../server/lib/coverContract.js"
 *
 * `utils/` lo copian **las dos** imágenes, y es el sitio honesto para algo que
 * de verdad comparten cliente y servidor. Lo destapó el build de la imagen real,
 * no el build local: un contrato compartido tiene que vivir donde ambos empaquetados lo vean.
 */

/** Tamaño recomendado, el que anuncia la ayuda del formulario. */
export const COVER_RECOMMENDED = { width: 1600, height: 900 };

/** Mínimo aceptado. Por debajo se ve pobre en el hero de Biblioteca. */
export const COVER_MIN = { width: 1280, height: 720 };

/** 16:9 exacto. */
export const COVER_RATIO = 16 / 9;

/**
 * Tolerancia técnica mínima sobre el ratio.
 *
 * No es holgura editorial: es el margen para que un redimensionado legítimo a
 * enteros no sea rechazado. 1280×720 y 1600×900 dan 16:9 exacto, pero 1366×768
 * —una resolución de pantalla muy común— da 1.7786, que se desvía 0.0011 del
 * ideal. Con 0.01 esa imagen entra, y una 4:3 (1.333) o una 2:1 no se acercan.
 */
export const COVER_RATIO_TOLERANCE = 0.01;

/**
 * Dos límites distintos, y la distinción es el corazón de esta unidad.
 *
 * `COVER_SOURCE_MAX_BYTES` es lo que el operador puede SELECCIONAR: un original
 * editorial pesa lo que pesa, y rechazarlo obligaba a que alguien lo
 * recomprimiera a mano fuera del sistema.
 *
 * `COVER_UPLOAD_MAX_BYTES` es lo que viaja por la red y se sirve a los lectores.
 * No sube: el Studio deriva una versión optimizada y solo esa se transmite. El
 * backend sigue aplicando este tope como defensa, porque un cliente puede
 * mentir y el servidor no delega su frontera a nadie.
 */
// R2: el tope de selección subió de 20 a 50 MiB porque el arte definitivo de
// «¿Estás aquí?» son 32,7 MiB a 6667 × 3750. Es un límite de COMODIDAD: solo
// gobierna qué puede elegir el operador. El que protege a la red y a los
// lectores —y al servidor— es el de transmisión, y NO se ha movido.
// El tope real contra abuso sigue siendo `COVER_MAX_PIXELS` (40 MP), que es
// lo que acota la memoria del canvas al decodificar.
export const COVER_SOURCE_MAX_BYTES = 50 * 1024 * 1024;  // 50 MiB — selección
export const COVER_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;   //  5 MiB — transmisión

/** Medidas de la derivación que produce el Studio. */
export const COVER_TARGET = { width: 1600, height: 900 };

/**
 * Objetivo de peso de la derivación. No es un límite: es la meta razonable para
 * no servir cabeceras pesadas. El límite duro es `COVER_UPLOAD_MAX_BYTES`.
 */
export const COVER_TARGET_BYTES = 2 * 1024 * 1024;

/**
 * Escalera de calidad, recorrida en orden y SIN búsqueda binaria: el resultado
 * debe ser reproducible. La misma imagen produce siempre el mismo archivo.
 */
export const COVER_QUALITY_LADDER = Object.freeze([0.90, 0.85, 0.80]);

/**
 * Tope de píxeles: frena la "bomba de descompresión", una imagen de pocos KB
 * que declara dimensiones enormes. 40 MP deja pasar cualquier cubierta real
 * (una 16:9 de 8K son 33 MP) y corta lo absurdo.
 */
export const COVER_MAX_PIXELS = 40_000_000;

/** MIME reales aceptados. En backend se comprueban por magic bytes. */
export const COVER_ALLOWED_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/** Texto de ayuda del formulario. Fuente única para UI y documentación. */
export const COVER_HELP_TEXT =
    'JPG, PNG o WebP de hasta 50 MB. La imagen se optimizará '
    + 'automáticamente a 1600 × 900 px antes de subirla.';

/**
 * Reglas de dimensión compartidas por cliente y servidor.
 *
 * El cliente las aplica como cortesía —evita subir 5 MB para nada— y el
 * servidor como autoridad. Al ser la misma función, el mensaje que ve el
 * operador es idéntico venga de donde venga.
 *
 * @returns {{ok:true} | {ok:false, code:string, error:string}}
 */
export function checkCoverDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        return {
            ok: false,
            code: 'UNREADABLE',
            error: 'No se pudieron leer las dimensiones de la imagen. Puede estar corrupta o incompleta.',
        };
    }
    if (width * height > COVER_MAX_PIXELS) {
        return {
            ok: false,
            code: 'TOO_MANY_PIXELS',
            error: 'La imagen tiene demasiados píxeles. Redúcela antes de subirla.',
        };
    }
    if (width < COVER_MIN.width || height < COVER_MIN.height) {
        return {
            ok: false,
            code: 'TOO_SMALL',
            error: `La imagen mide ${width} × ${height} px y el mínimo es `
                + `${COVER_MIN.width} × ${COVER_MIN.height} px. `
                + `Lo recomendado son ${COVER_RECOMMENDED.width} × ${COVER_RECOMMENDED.height} px.`,
        };
    }
    if (Math.abs(width / height - COVER_RATIO) > COVER_RATIO_TOLERANCE) {
        return {
            ok: false,
            code: 'BAD_RATIO',
            error: `La imagen mide ${width} × ${height} px, que no es proporción 16:9. `
                + `Recórtala a 16:9 (por ejemplo ${COVER_RECOMMENDED.width} × ${COVER_RECOMMENDED.height} px).`,
        };
    }
    return { ok: true };
}
