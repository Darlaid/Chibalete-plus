"""Preflight S3 autenticado y fail-closed (CHP-BACKUP-01B-1-R3).

Motivo (diagnostico CHP-BACKUP-01B-2-R1): `restic cat config` contra un backend
remoto no distingue "prefijo vacio" de "acceso denegado", "bucket inexistente",
"endpoint equivocado" o "objetos ajenos". Con esa ambiguedad el codigo anterior
devolvia `unknown` y bloqueaba SIEMPRE el primer `restic init`.

Este modulo resuelve la ambiguedad con evidencia positiva: una peticion
**ListObjectsV2 firmada con AWS Signature V4** contra el prefijo aprobado. Solo
un `KeyCount == 0` verificado por esa via puede clasificarse como
`EMPTY_APPROVED_PREFIX`. Ningun texto de stderr de restic puede producir esa
clasificacion.

Restricciones vinculantes implementadas aqui:

  - solo stdlib de Python (hashlib, hmac, http.client, ssl, urllib, xml);
    sin boto3, awscli, rclone, s3cmd, mc ni ningun SDK externo;
  - las credenciales viajan unicamente en la cabecera `Authorization` de la
    peticion; jamas en argv, jamas en archivos temporales, jamas en logs;
  - el resultado que sale del modulo es una estructura sanitizada: estado,
    codigo HTTP y, como mucho, un codigo de error S3 con forma validada;
    nunca el cuerpo de la respuesta;
  - toda anomalia (autorizacion, bucket, endpoint, red, TLS, XML, 5xx,
    redireccion) se clasifica como bloqueante, NUNCA como prefijo vacio.
"""

import enum
import hashlib
import hmac
import http.client
import re
import socket
import ssl
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from .errors import ConfigError

# Prefijo exclusivo aprobado para Chibalete+ (DEST_DECISION.md decision 2).
APPROVED_PREFIX = "restic-prod"

# Endpoint aprobado: S3-compatible de Backblaze B2, con la region explicita en
# el propio host. Cualquier otro destino es configuracion invalida.
APPROVED_ENDPOINT_RE = re.compile(r"^s3\.([a-z0-9][a-z0-9-]{0,30})\.backblazeb2\.com$")

# Prefijo de control para la verificacion de alcance de la clave (fase 3). No
# existe y NO se crea: la sonda es un listado, nunca una escritura.
SCOPE_PROBE_PREFIX = "chp-scope-probe-must-not-exist"

# Transporte en claro admitido EXCLUSIVAMENTE contra loopback literal, para el
# servidor S3 sintetico de las pruebas. Cualquier host real exige HTTPS.
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1"})

DEFAULT_TIMEOUT = 20.0
MAX_BODY_BYTES = 262144
LIST_MAX_KEYS = 2
EMPTY_PAYLOAD_SHA256 = hashlib.sha256(b"").hexdigest()

_ERROR_CODE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,63}$")
_UNRESERVED = "-_.~"

_ACCESS_DENIED_CODES = frozenset({
    "AccessDenied",
    "InvalidAccessKeyId",
    "SignatureDoesNotMatch",
    "UnauthorizedAccess",
    "InvalidSecurity",
    "AccountProblem",
    "ExpiredToken",
    "TokenRefreshRequired",
})

_BUCKET_NOT_FOUND_CODES = frozenset({"NoSuchBucket", "InvalidBucketName"})

_ENDPOINT_MISMATCH_CODES = frozenset({
    "PermanentRedirect",
    "TemporaryRedirect",
    "AuthorizationHeaderMalformed",
    "IllegalLocationConstraintException",
    "InvalidLocationConstraint",
    "InvalidRegion",
    "CredentialsNotSupported",
})


class RemoteState(str, enum.Enum):
    """Contrato de estados del destino de backup.

    Solo `EXISTING_REPOSITORY` y `EMPTY_APPROVED_PREFIX` permiten continuar; y
    el segundo, ademas, exige autorizacion manual de provision.
    """

    EXISTING_REPOSITORY = "EXISTING_REPOSITORY"
    EMPTY_APPROVED_PREFIX = "EMPTY_APPROVED_PREFIX"
    FOREIGN_OBJECTS_PRESENT = "FOREIGN_OBJECTS_PRESENT"
    ACCESS_DENIED = "ACCESS_DENIED"
    BUCKET_NOT_FOUND = "BUCKET_NOT_FOUND"
    ENDPOINT_OR_REGION_MISMATCH = "ENDPOINT_OR_REGION_MISMATCH"
    NETWORK_OR_TLS_ERROR = "NETWORK_OR_TLS_ERROR"
    INVALID_LOCAL_CONFIGURATION = "INVALID_LOCAL_CONFIGURATION"
    UNKNOWN_REMOTE_STATE = "UNKNOWN_REMOTE_STATE"
    # Backend NO remoto (ruta de filesystem). Solo se alcanza en el toolchain de
    # pruebas y en desarrollo: en produccion RESTIC_REPOSITORY es `s3:`.
    EMPTY_LOCAL_DIRECTORY = "EMPTY_LOCAL_DIRECTORY"


class ScopeVerdict(str, enum.Enum):
    """Resultado de la verificacion de alcance de la credencial."""

    RESTRICTED = "RESTRICTED"      # no puede listar fuera del prefijo -> PASS
    OVERBROAD = "OVERBROAD"        # lista fuera del prefijo -> BLOCK
    AMBIGUOUS = "AMBIGUOUS"        # cualquier otra cosa -> BLOCK


class ProbeResult:
    """Salida sanitizada del preflight. No contiene cuerpo ni credenciales."""

    __slots__ = ("state", "object_count", "http_status", "error_code", "detail")

    def __init__(self, state, object_count=None, http_status=None, error_code=None, detail=""):
        self.state = state
        self.object_count = object_count
        self.http_status = http_status
        self.error_code = error_code
        self.detail = detail

    def as_log_fields(self) -> dict:
        fields = {"s3_state": self.state.value}
        if self.http_status is not None:
            fields["s3_http_status"] = self.http_status
        if self.error_code:
            fields["s3_error_code"] = self.error_code
        if self.object_count is not None:
            fields["s3_object_count"] = self.object_count
        return fields

    def __repr__(self) -> str:  # pragma: no cover - defensivo
        return f"<ProbeResult {self.state.value} http={self.http_status} code={self.error_code}>"


class S3Target:
    """Destino S3 ya validado. Nunca expone las credenciales en repr()."""

    __slots__ = ("scheme", "host", "port", "bucket", "prefix", "region",
                 "_access_key", "_secret_key")

    def __init__(self, scheme, host, port, bucket, prefix, region, access_key, secret_key):
        self.scheme = scheme
        self.host = host
        self.port = port
        self.bucket = bucket
        self.prefix = prefix
        self.region = region
        self._access_key = access_key
        self._secret_key = secret_key

    @property
    def host_header(self) -> str:
        default = 443 if self.scheme == "https" else 80
        if self.port is None or self.port == default:
            return self.host
        return f"{self.host}:{self.port}"

    def redacted_summary(self) -> dict:
        return {
            "s3_scheme": self.scheme,
            "s3_host": self.host,
            "s3_bucket_set": "yes" if self.bucket else "no",
            "s3_prefix": self.prefix,
            "s3_region_set": "yes" if self.region else "no",
        }

    def __repr__(self) -> str:  # pragma: no cover - defensivo
        return f"<S3Target {self.scheme}://{self.host}/{self.bucket}/{self.prefix} creds=[REDACTED]>"


# ---------------------------------------------------------------------------
# Validacion local (antes de tocar la red)
# ---------------------------------------------------------------------------

def is_remote_s3(repository: str) -> bool:
    return repository.startswith("s3:")


def parse_target(env: dict) -> S3Target:
    """Valida el destino ANTES de cualquier E/S de red.

    Comprueba esquema, host, region, bucket y prefijo exactos. Cualquier
    desviacion es `ConfigError`: el runner no puede adivinar el destino.
    """
    repository = env.get("RESTIC_REPOSITORY", "")
    region = (env.get("AWS_DEFAULT_REGION") or "").strip()
    access_key = env.get("AWS_ACCESS_KEY_ID") or ""
    secret_key = env.get("AWS_SECRET_ACCESS_KEY") or ""

    if not is_remote_s3(repository):
        raise ConfigError("RESTIC_REPOSITORY no declara el backend s3:")
    if not access_key.strip() or not secret_key.strip():
        raise ConfigError("credenciales S3 ausentes o vacias para el preflight")
    if not region:
        raise ConfigError("AWS_DEFAULT_REGION ausente o vacia")

    remainder = repository[len("s3:"):]
    if "://" not in remainder:
        raise ConfigError(
            "RESTIC_REPOSITORY debe declarar el endpoint completo con esquema "
            "(se espera s3:https://<endpoint>/<bucket>/<prefijo>)"
        )
    scheme, _, rest = remainder.partition("://")
    scheme = scheme.lower()
    if scheme not in ("https", "http"):
        raise ConfigError(f"esquema no admitido en RESTIC_REPOSITORY: {scheme}")

    netloc, _, path = rest.partition("/")
    if "@" in netloc:
        raise ConfigError("RESTIC_REPOSITORY no puede incluir credenciales en el endpoint")
    if "?" in path or "#" in path:
        raise ConfigError("RESTIC_REPOSITORY no admite query ni fragmento")

    host, port = _split_host_port(netloc)
    if not host:
        raise ConfigError("endpoint sin host en RESTIC_REPOSITORY")

    is_loopback = host in LOOPBACK_HOSTS
    if scheme == "http" and not is_loopback:
        raise ConfigError(
            "el endpoint S3 exige HTTPS; el transporte en claro solo se admite "
            "contra loopback literal (servidor sintetico de pruebas)"
        )

    segments = [seg for seg in path.split("/") if seg]
    if len(segments) != 2:
        raise ConfigError(
            "RESTIC_REPOSITORY debe tener la forma "
            "s3:https://<endpoint>/<bucket>/<prefijo> (bucket y prefijo exactos)"
        )
    bucket, prefix = segments
    if prefix != APPROVED_PREFIX:
        raise ConfigError(
            f"prefijo no aprobado en RESTIC_REPOSITORY (se exige {APPROVED_PREFIX!r})"
        )

    if not is_loopback:
        match = APPROVED_ENDPOINT_RE.match(host)
        if not match:
            raise ConfigError("endpoint S3 fuera del destino aprobado")
        if match.group(1) != region:
            raise ConfigError(
                "la region del endpoint no coincide con AWS_DEFAULT_REGION"
            )

    return S3Target(scheme, host, port, bucket, prefix, region, access_key, secret_key)


def _split_host_port(netloc: str) -> tuple[str, int | None]:
    if netloc.startswith("["):  # IPv6 literal
        close = netloc.find("]")
        if close < 0:
            raise ConfigError("endpoint IPv6 mal formado en RESTIC_REPOSITORY")
        host = netloc[1:close]
        tail = netloc[close + 1:]
        if not tail:
            return host, None
        if not tail.startswith(":"):
            raise ConfigError("endpoint IPv6 mal formado en RESTIC_REPOSITORY")
        return host, _parse_port(tail[1:])
    if netloc.count(":") > 1:
        raise ConfigError("endpoint mal formado en RESTIC_REPOSITORY")
    host, sep, raw_port = netloc.partition(":")
    return host.lower(), (_parse_port(raw_port) if sep else None)


def _parse_port(raw: str) -> int:
    if not raw.isdigit():
        raise ConfigError("puerto no numerico en RESTIC_REPOSITORY")
    port = int(raw)
    if not 1 <= port <= 65535:
        raise ConfigError("puerto fuera de rango en RESTIC_REPOSITORY")
    return port


# ---------------------------------------------------------------------------
# AWS Signature V4 (stdlib pura)
# ---------------------------------------------------------------------------

def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe=_UNRESERVED)


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def signing_key(secret: str, datestamp: str, region: str, service: str = "s3") -> bytes:
    key = _sign(("AWS4" + secret).encode("utf-8"), datestamp)
    key = _sign(key, region)
    key = _sign(key, service)
    return _sign(key, "aws4_request")


def build_signed_request(target: S3Target, query: dict, now: datetime) -> dict:
    """Construye la peticion GET firmada con SigV4.

    Devuelve tambien `canonical_request` y `string_to_sign` para poder validar
    la firma con vectores deterministicos. Ninguno de los dos contiene el
    secreto: la firma es un HMAC, no una transformacion reversible.
    """
    amzdate = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    scope = f"{datestamp}/{target.region}/s3/aws4_request"

    canonical_uri = "/" + _quote(target.bucket)
    canonical_query = "&".join(
        f"{_quote(k)}={_quote(v)}" for k, v in sorted(query.items())
    )
    canonical_headers = (
        f"host:{target.host_header}\n"
        f"x-amz-content-sha256:{EMPTY_PAYLOAD_SHA256}\n"
        f"x-amz-date:{amzdate}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([
        "GET",
        canonical_uri,
        canonical_query,
        canonical_headers,
        signed_headers,
        EMPTY_PAYLOAD_SHA256,
    ])
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amzdate,
        scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])
    signature = hmac.new(
        signing_key(target._secret_key, datestamp, target.region),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    authorization = (
        f"AWS4-HMAC-SHA256 Credential={target._access_key}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {
        "path": f"{canonical_uri}?{canonical_query}",
        "canonical_request": canonical_request,
        "string_to_sign": string_to_sign,
        "signature": signature,
        "headers": {
            "Host": target.host_header,
            "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
            "x-amz-date": amzdate,
            "Authorization": authorization,
        },
    }


# ---------------------------------------------------------------------------
# Transporte e interpretacion
# ---------------------------------------------------------------------------

def _open_connection(target: S3Target, timeout: float):
    if target.scheme == "https":
        return http.client.HTTPSConnection(
            target.host, target.port, timeout=timeout, context=ssl.create_default_context()
        )
    return http.client.HTTPConnection(target.host, target.port, timeout=timeout)


def _list_objects(target: S3Target, prefix: str, timeout: float, now=None):
    """GET ListObjectsV2 firmado. Devuelve (status, body_bytes) o lanza OSError."""
    query = {"list-type": "2", "max-keys": str(LIST_MAX_KEYS), "prefix": prefix}
    signed = build_signed_request(target, query, now or datetime.now(timezone.utc))
    conn = _open_connection(target, timeout)
    try:
        conn.request("GET", signed["path"], headers=signed["headers"])
        response = conn.getresponse()
        body = response.read(MAX_BODY_BYTES + 1)
        return response.status, body
    finally:
        conn.close()


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _extract_error_code(body: bytes) -> str | None:
    """Extrae SOLO el <Code> de un error S3, con forma validada.

    No se toca `Message`, `RequestId`, `HostId` ni ningun otro campo: pueden
    reflejar el endpoint, la clave o el nombre del bucket.
    """
    try:
        root = ET.fromstring(body.decode("utf-8", errors="replace"))
    except (ET.ParseError, ValueError):
        return None
    if _localname(root.tag) != "Error":
        return None
    for child in root:
        if _localname(child.tag) == "Code":
            code = (child.text or "").strip()
            return code if _ERROR_CODE_RE.match(code) else None
    return None


def _count_listed_objects(body: bytes) -> int | None:
    """Cuenta objetos de un ListBucketResult. `None` si la respuesta no lo es."""
    try:
        root = ET.fromstring(body.decode("utf-8", errors="replace"))
    except (ET.ParseError, ValueError):
        return None
    if _localname(root.tag) != "ListBucketResult":
        return None
    contents = sum(1 for child in root if _localname(child.tag) == "Contents")
    common = sum(1 for child in root if _localname(child.tag) == "CommonPrefixes")
    listed = contents + common
    for child in root:
        if _localname(child.tag) == "KeyCount":
            try:
                declared = int((child.text or "").strip())
            except ValueError:
                return None
            # Si el servidor declara claves y no las enumera (o al reves), la
            # respuesta es inconsistente: no se puede afirmar "vacio".
            if declared == 0 and listed != 0:
                return None
            if declared > 0 and listed == 0:
                return declared
    return listed


def classify_list_response(status: int, body: bytes) -> ProbeResult:
    """Traduce una respuesta S3 a un estado. Ninguna rama produce 'vacio' salvo
    un `ListBucketResult` valido con cero objetos."""
    if len(body) > MAX_BODY_BYTES:
        return ProbeResult(RemoteState.UNKNOWN_REMOTE_STATE, http_status=status,
                           detail="respuesta S3 excesivamente grande")

    code = _extract_error_code(body)

    if status == 200:
        count = _count_listed_objects(body)
        if count is None:
            return ProbeResult(RemoteState.UNKNOWN_REMOTE_STATE, http_status=status,
                               error_code=code, detail="ListObjectsV2 ilegible o inconsistente")
        if count == 0:
            return ProbeResult(RemoteState.EMPTY_APPROVED_PREFIX, object_count=0, http_status=status)
        return ProbeResult(RemoteState.FOREIGN_OBJECTS_PRESENT, object_count=count, http_status=status)

    if code in _ACCESS_DENIED_CODES:
        return ProbeResult(RemoteState.ACCESS_DENIED, http_status=status, error_code=code)
    if code in _BUCKET_NOT_FOUND_CODES:
        return ProbeResult(RemoteState.BUCKET_NOT_FOUND, http_status=status, error_code=code)
    if code in _ENDPOINT_MISMATCH_CODES:
        return ProbeResult(RemoteState.ENDPOINT_OR_REGION_MISMATCH, http_status=status, error_code=code)

    if status in (301, 302, 307, 308):
        return ProbeResult(RemoteState.ENDPOINT_OR_REGION_MISMATCH, http_status=status, error_code=code)
    if status in (401, 403):
        return ProbeResult(RemoteState.ACCESS_DENIED, http_status=status, error_code=code)
    if status == 404:
        return ProbeResult(RemoteState.BUCKET_NOT_FOUND, http_status=status, error_code=code)

    return ProbeResult(RemoteState.UNKNOWN_REMOTE_STATE, http_status=status, error_code=code,
                       detail="respuesta S3 no interpretable")


def probe_approved_prefix(target: S3Target, timeout: float = DEFAULT_TIMEOUT,
                          now=None) -> ProbeResult:
    """Determina si el prefijo aprobado esta EXACTAMENTE vacio.

    Cualquier fallo de red, TLS o protocolo se convierte en un estado
    bloqueante; nunca en `EMPTY_APPROVED_PREFIX`.
    """
    try:
        status, body = _list_objects(target, target.prefix + "/", timeout, now=now)
    except (ssl.SSLError, socket.timeout, TimeoutError, OSError,
            http.client.HTTPException) as exc:
        return ProbeResult(RemoteState.NETWORK_OR_TLS_ERROR,
                           detail=f"fallo de transporte S3 ({type(exc).__name__})")
    return classify_list_response(status, body)


def probe_scope_restriction(target: S3Target, timeout: float = DEFAULT_TIMEOUT,
                            now=None) -> ScopeVerdict:
    """Comprueba que la credencial NO pueda listar fuera del prefijo aprobado.

    Consulta inocua (solo listado) contra un prefijo de control inexistente y
    ajeno a `restic-prod/`. No crea objetos, no borra y no escribe nada.
    """
    try:
        status, body = _list_objects(target, SCOPE_PROBE_PREFIX + "/", timeout, now=now)
    except (ssl.SSLError, socket.timeout, TimeoutError, OSError,
            http.client.HTTPException):
        return ScopeVerdict.AMBIGUOUS
    if status in (401, 403):
        return ScopeVerdict.RESTRICTED
    code = _extract_error_code(body)
    if code in _ACCESS_DENIED_CODES:
        return ScopeVerdict.RESTRICTED
    if status == 200 and _count_listed_objects(body) is not None:
        # La clave puede listar un prefijo ajeno: alcance mas amplio del aprobado.
        return ScopeVerdict.OVERBROAD
    return ScopeVerdict.AMBIGUOUS


# ---------------------------------------------------------------------------
# Evidencia complementaria: stderr de `restic cat config`
# ---------------------------------------------------------------------------

# NUNCA determina EMPTY_APPROVED_PREFIX. Sirve para (a) enriquecer el log con
# una etiqueta corta y (b) contradecir un "vacio" sospechoso.
_RESTIC_HINTS = (
    ("wrong_password", ("wrong password", "invalid password", "decrypt", "authentication failed")),
    ("config_absent", ("config does not exist", "unable to open config", "no such file",
                       "repository does not exist", "specified repository location is not a")),
    ("access_denied", ("access denied", "accessdenied", "403", "invalidaccesskeyid",
                       "signaturedoesnotmatch", "unauthorized")),
    ("bucket_not_found", ("nosuchbucket", "bucket does not exist", "the specified bucket")),
    ("endpoint_mismatch", ("permanentredirect", "authorizationheadermalformed",
                           "region", "301 response")),
    ("network_error", ("no such host", "connection refused", "i/o timeout", "dial tcp",
                       "tls:", "certificate", "timeout", "temporary failure")),
    ("repository_corrupt", ("invalid data returned", "unexpected content", "corrupt",
                            "load(<config", "ciphertext verification failed")),
)


def classify_restic_stderr(stderr: str | None) -> str:
    """Etiqueta corta y sanitizada del fallo de `restic cat config`.

    Devuelve solo un identificador de un conjunto cerrado: el stderr crudo
    puede contener endpoint, bucket o keyID y NO debe salir de aqui.
    """
    text = (stderr or "").lower()
    if not text.strip():
        return "no_output"
    for label, needles in _RESTIC_HINTS:
        for needle in needles:
            if needle in text:
                return label
    return "unclassified"


# Etiquetas que CONTRADICEN un listado vacio: si restic dice que la passphrase
# es incorrecta o que el repositorio esta danado, "cero objetos" es incoherente
# y el destino pasa a desconocido en lugar de inicializable.
CONTRADICTS_EMPTY = frozenset({"wrong_password", "repository_corrupt"})
