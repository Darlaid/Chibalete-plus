/**
 * strictXml.js — CHP-CONTENT-CANONICAL-2026-01 PARTE 3A.
 *
 * Parser XML mínimo y ESTRICTO para el paquete EPUB (container.xml, OPF,
 * XHTML). Función pura: string → árbol. Sin red, sin filesystem, sin DTD.
 *
 * Contrato de seguridad:
 *   - DOCTYPE sin subconjunto interno: se ignora y NUNCA se resuelve (los
 *     XHTML de EPUB 2 declaran el DTD de XHTML 1.1).
 *   - DOCTYPE con subconjunto interno ([...]), <!ENTITY>, <!ELEMENT>, etc.:
 *     RECHAZO. Sin DTD no hay XXE ni expansión de entidades (billion laughs).
 *   - Entidades: las 5 de XML, referencias numéricas válidas y, solo para
 *     XHTML, una tabla FIJA de entidades HTML (Latin-1 + tipográficas).
 *     Cualquier otra → rechazo (fail-closed, determinista).
 *   - Declaración XML con encoding distinto de UTF-8 → rechazo.
 *   - Bien formado: etiquetas balanceadas, un solo elemento raíz, sin texto
 *     fuera de él, atributos sin duplicar, caracteres XML válidos.
 *   - Límites de profundidad y de nodos.
 *
 * Árbol: { type: 'element', name (local, sin prefijo), qname, attrs, children }
 *        { type: 'text', value }
 */
import { CanonicalBookError } from './canonicalBook.js';

export const XML_LIMITS = Object.freeze({ maxDepth: 256, maxNodes: 500_000 });

const XML_ENTITIES = Object.freeze({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" });

// Entidades HTML aceptadas en XHTML: Latin-1 (U+00A0–U+00FF) + especiales y
// tipográficas de HTML 4. Tabla fija; no se amplía por fixture.
const LATIN1 = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr '
    + 'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest '
    + 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml '
    + 'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig '
    + 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml '
    + 'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ');
if (LATIN1.length !== 96) throw new Error('strictXml: tabla Latin-1 incompleta');
const HTML_ENTITIES = Object.freeze({
    ...Object.fromEntries(LATIN1.map((n, i) => [n, String.fromCodePoint(0xA0 + i)])),
    OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜',
    ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
    dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′', Prime: '″',
    lsaquo: '‹', rsaquo: '›', oline: '‾', euro: '€', trade: '™', larr: '←', rarr: '→',
});

const NAME_RX = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const fail = (code, message) => { throw new CanonicalBookError(code, message); };

const isXmlChar = (cp) => cp === 0x9 || cp === 0xA || cp === 0xD
    || (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0x10FFFF);

function assertXmlChars(s) {
    for (const ch of s) {
        if (!isXmlChar(ch.codePointAt(0))) fail('XML_INVALID_CHAR', 'carácter no válido en XML');
    }
}

function decodeEntities(raw, htmlEntities) {
    if (!raw.includes('&')) return raw;
    let out = '';
    let i = 0;
    while (i < raw.length) {
        const amp = raw.indexOf('&', i);
        if (amp < 0) { out += raw.slice(i); break; }
        out += raw.slice(i, amp);
        const semi = raw.indexOf(';', amp);
        if (semi < 0 || semi - amp > 32) fail('XML_BAD_ENTITY', 'referencia de entidad mal formada');
        const ref = raw.slice(amp + 1, semi);
        let value;
        if (/^#x[0-9A-Fa-f]{1,6}$/.test(ref) || /^#[0-9]{1,7}$/.test(ref)) {
            const cp = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            if (!isXmlChar(cp)) fail('XML_BAD_ENTITY', 'referencia numérica fuera de rango');
            value = String.fromCodePoint(cp);
        } else if (Object.hasOwn(XML_ENTITIES, ref)) {
            value = XML_ENTITIES[ref];
        } else if (htmlEntities && Object.hasOwn(HTML_ENTITIES, ref)) {
            value = HTML_ENTITIES[ref];
        } else {
            fail('XML_UNKNOWN_ENTITY', 'entidad no soportada');
        }
        out += value;
        i = semi + 1;
    }
    return out;
}

const localName = (qname) => { const c = qname.indexOf(':'); return c < 0 ? qname : qname.slice(c + 1); };

/**
 * @param {string} text  documento ya decodificado (UTF-8)
 * @param {{ htmlEntities?: boolean, limits?: object }} [opts]
 * @returns {{ type: 'element', name: string, qname: string, attrs: Record<string,string>, children: any[] }}
 */
export function parseStrictXml(text, { htmlEntities = false, limits = {} } = {}) {
    if (typeof text !== 'string') fail('XML_INVALID_INPUT', 'se esperaba texto');
    const L = { ...XML_LIMITS, ...limits };
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    assertXmlChars(text);

    let i = 0;
    let root = null;
    let seenDoctype = false;
    let nodes = 0;
    const stack = [];
    const n = text.length;
    const top = () => stack[stack.length - 1];
    const addNode = (node) => {
        if (++nodes > L.maxNodes) fail('XML_TOO_MANY_NODES', 'demasiados nodos');
        top().children.push(node);
    };

    while (i < n) {
        if (text[i] !== '<') {
            const next = text.indexOf('<', i);
            const end = next < 0 ? n : next;
            const raw = text.slice(i, end);
            if (stack.length === 0) {
                if (raw.trim()) fail('XML_TEXT_OUTSIDE_ROOT', 'texto fuera del elemento raíz');
            } else {
                addNode({ type: 'text', value: decodeEntities(raw, htmlEntities) });
            }
            i = end;
            continue;
        }
        if (text.startsWith('<!--', i)) {
            const end = text.indexOf('-->', i + 4);
            if (end < 0) fail('XML_UNCLOSED', 'comentario sin cerrar');
            i = end + 3;
            continue;
        }
        if (text.startsWith('<![CDATA[', i)) {
            const end = text.indexOf(']]>', i + 9);
            if (end < 0) fail('XML_UNCLOSED', 'CDATA sin cerrar');
            if (stack.length === 0) fail('XML_TEXT_OUTSIDE_ROOT', 'CDATA fuera del elemento raíz');
            addNode({ type: 'text', value: text.slice(i + 9, end) });
            i = end + 3;
            continue;
        }
        if (text.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
            if (seenDoctype || root || stack.length) fail('XML_DOCTYPE_POSITION', 'DOCTYPE fuera de lugar');
            // Se busca el cierre respetando comillas; un '[' = subconjunto interno.
            let j = i + 9;
            let quote = null;
            for (; j < n; j++) {
                const ch = text[j];
                if (quote) { if (ch === quote) quote = null; continue; }
                if (ch === '"' || ch === "'") { quote = ch; continue; }
                if (ch === '[') fail('XML_DTD_FORBIDDEN', 'DOCTYPE con subconjunto interno no permitido');
                if (ch === '>') break;
            }
            if (j >= n) fail('XML_UNCLOSED', 'DOCTYPE sin cerrar');
            seenDoctype = true;
            i = j + 1;
            continue;
        }
        if (text.startsWith('<!', i)) fail('XML_DTD_FORBIDDEN', 'declaración de marcado no permitida');
        if (text.startsWith('<?', i)) {
            const end = text.indexOf('?>', i + 2);
            if (end < 0) fail('XML_UNCLOSED', 'instrucción de procesamiento sin cerrar');
            const body = text.slice(i + 2, end);
            const target = (body.match(NAME_RX) || [''])[0];
            if (target.toLowerCase() === 'xml') {
                if (i !== 0) fail('XML_DECL_POSITION', 'declaración XML fuera del inicio');
                const enc = body.match(/\bencoding\s*=\s*["']([^"']+)["']/);
                if (enc && !/^utf-?8$/i.test(enc[1])) fail('XML_ENCODING', 'solo se admite UTF-8');
            }
            i = end + 2;
            continue;
        }
        if (text.startsWith('</', i)) {
            const m = text.slice(i + 2).match(NAME_RX);
            if (!m) fail('XML_MALFORMED', 'etiqueta de cierre mal formada');
            let j = i + 2 + m[0].length;
            while (j < n && /\s/.test(text[j])) j++;
            if (text[j] !== '>') fail('XML_MALFORMED', 'etiqueta de cierre mal formada');
            const open = stack.pop();
            if (!open || open.qname !== m[0]) fail('XML_MISMATCHED_TAG', 'etiquetas no balanceadas');
            i = j + 1;
            continue;
        }
        // Etiqueta de apertura.
        const m = text.slice(i + 1).match(NAME_RX);
        if (!m) fail('XML_MALFORMED', 'etiqueta mal formada');
        const qname = m[0];
        let j = i + 1 + qname.length;
        const attrs = {};
        let selfClosing = false;
        for (;;) {
            const ws = j;
            while (j < n && /\s/.test(text[j])) j++;
            if (j >= n) fail('XML_UNCLOSED', 'etiqueta sin cerrar');
            if (text[j] === '>') { j++; break; }
            if (text.startsWith('/>', j)) { j += 2; selfClosing = true; break; }
            if (j === ws) fail('XML_MALFORMED', 'falta espacio entre atributos');
            const am = text.slice(j).match(NAME_RX);
            if (!am) fail('XML_MALFORMED', 'atributo mal formado');
            const aname = am[0];
            j += aname.length;
            while (j < n && /\s/.test(text[j])) j++;
            if (text[j] !== '=') fail('XML_MALFORMED', 'atributo sin valor');
            j++;
            while (j < n && /\s/.test(text[j])) j++;
            const q = text[j];
            if (q !== '"' && q !== "'") fail('XML_MALFORMED', 'valor de atributo sin comillas');
            const close = text.indexOf(q, j + 1);
            if (close < 0) fail('XML_UNCLOSED', 'valor de atributo sin cerrar');
            const rawValue = text.slice(j + 1, close);
            if (rawValue.includes('<')) fail('XML_MALFORMED', '"<" en valor de atributo');
            if (Object.hasOwn(attrs, aname)) fail('XML_DUPLICATE_ATTRIBUTE', 'atributo duplicado');
            attrs[aname] = decodeEntities(rawValue, htmlEntities);
            j = close + 1;
        }
        const el = { type: 'element', name: localName(qname), qname, attrs, children: [] };
        if (stack.length === 0) {
            if (root) fail('XML_MULTIPLE_ROOTS', 'más de un elemento raíz');
            root = el;
            nodes++;
        } else {
            addNode(el);
        }
        if (!selfClosing) {
            stack.push(el);
            if (stack.length > L.maxDepth) fail('XML_TOO_DEEP', 'anidamiento excesivo');
        }
        i = j;
    }
    if (stack.length) fail('XML_UNCLOSED', 'elementos sin cerrar');
    if (!root) fail('XML_NO_ROOT', 'documento sin elemento raíz');
    return root;
}

/** Hijos elemento con nombre local `name`. */
export const childElements = (el, name) => el.children.filter(c => c.type === 'element' && (!name || c.name === name));

/** Texto concatenado de un subárbol. */
export function textContent(el) {
    if (el.type === 'text') return el.value;
    return el.children.map(textContent).join('');
}
