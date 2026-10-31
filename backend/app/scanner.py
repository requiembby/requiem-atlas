"""Bounded, non-intrusive asset discovery. Never crawls arbitrary ports/ranges.

Passive DNS, RDAP and certificate transparency work without probing the target.
An explicit authorization checkbox is required for direct HTTPS/HTTP HEAD probes.
Probes are pinned to a pre-validated public IP to prevent basic SSRF/DNS rebinding.
"""
import http.client
import ipaddress
import re
import socket
import ssl
from datetime import datetime, timezone
from typing import Any

import dns.exception
import dns.resolver
import httpx

DOMAIN_RE = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$")
BLOCKED_TLDS = {"local", "localhost", "internal", "test", "invalid", "example", "home", "lan"}
USER_AGENT = "RequiemAtlas/0.1 (Security asset inventory; local use)"
DNS_TYPES = ("A", "AAAA", "MX", "NS", "CNAME", "TXT", "CAA")


class TargetError(ValueError):
    pass


def normalize_target(raw: str) -> tuple[str, str]:
    value = raw.strip().lower().rstrip(".")
    if not value or len(value) > 253 or any(c in value for c in "/\\?#@ "):
        raise TargetError("Введите домен или публичный IP без пути, порта и параметров.")
    try:
        address = ipaddress.ip_address(value.strip("[]"))
        if not address.is_global:
            raise TargetError("Частные, локальные и зарезервированные IP запрещены.")
        return address.compressed, "ip"
    except ValueError as exc:
        if isinstance(exc, TargetError):
            raise
    try:
        ascii_domain = value.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise TargetError("Недопустимое доменное имя.") from exc
    if not DOMAIN_RE.fullmatch(ascii_domain) or ascii_domain.split(".")[-1] in BLOCKED_TLDS:
        raise TargetError("Укажите корректный публичный домен, например example.org.")
    return ascii_domain, "domain"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def resolve_dns(domain: str) -> tuple[list[dict[str, str]], list[str]]:
    resolver = dns.resolver.Resolver(configure=True)
    resolver.timeout = 1.7
    resolver.lifetime = 2.3
    records: list[dict[str, str]] = []
    errors: list[str] = []
    for record_type in DNS_TYPES:
        try:
            answer = resolver.resolve(domain, record_type, raise_on_no_answer=False)
            for answer_item in list(answer or [])[:16]:
                display = str(answer_item).strip('"')
                records.append({"type": record_type, "value": display[:600]})
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            if record_type == "A":
                errors.append("DNS: домен не найден или не имеет A-записи.")
        except (dns.exception.DNSException, OSError):
            if record_type in ("A", "AAAA"):
                errors.append(f"DNS: не удалось получить записи {record_type}.")
    return records[:70], errors


def fetch_rdap(target: str, kind: str) -> dict[str, Any]:
    # Fixed provider endpoint: target is URL-path-safe after strict normalization.
    url = f"https://rdap.org/{'domain' if kind == 'domain' else 'ip'}/{target}"
    try:
        with httpx.Client(timeout=5.5, follow_redirects=True, max_redirects=3, trust_env=False,
                          headers={"User-Agent": USER_AGENT, "Accept": "application/rdap+json"}) as client:
            response = client.get(url)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                return {}
            events = data.get("events") or []
            filtered_events = [{"action": e.get("eventAction"), "date": e.get("eventDate")}
                               for e in events[:12] if isinstance(e, dict)]
            return {"handle": str(data.get("handle", ""))[:200],
                    "name": str(data.get("ldhName", data.get("name", "")))[:200],
                    "status": [str(s)[:80] for s in (data.get("status") or [])[:12]],
                    "start_address": str(data.get("startAddress", ""))[:80],
                    "end_address": str(data.get("endAddress", ""))[:80],
                    "events": filtered_events,
                    "source": "rdap.org"}
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return {}


def certificate_transparency(domain: str) -> list[str]:
    try:
        with httpx.Client(timeout=7, trust_env=False, headers={"User-Agent": USER_AGENT}) as client:
            response = client.get("https://crt.sh/", params={"q": f"%.{domain}", "output": "json"})
            response.raise_for_status()
            names: set[str] = set()
            for item in response.json()[:1500]:
                for raw in str(item.get("name_value", "")).splitlines():
                    name = raw.strip().lower().removeprefix("*.").rstrip(".")
                    if name != domain and name.endswith("." + domain) and len(name) <= 253:
                        names.add(name)
            return sorted(names)[:60]
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return []


def pinned_public_ip(target: str) -> str:
    """Refuse active connections if *any* resolved address is non-public."""
    kind = "ip" if _is_ip(target) else "domain"
    if kind == "ip":
        ip = ipaddress.ip_address(target)
        if not ip.is_global:
            raise TargetError("Активная проверка частного IP запрещена.")
        return ip.compressed
    try:
        infos = socket.getaddrinfo(target, 443, type=socket.SOCK_STREAM)
        ips = {ipaddress.ip_address(info[4][0]) for info in infos}
    except OSError as exc:
        raise TargetError("Не удалось определить публичный IP для HTTP-проверки.") from exc
    if not ips or any(not ip.is_global for ip in ips):
        raise TargetError("У цели есть непубличный адрес: активная проверка заблокирована.")
    return str(sorted(ips, key=lambda ip: (ip.version != 4, str(ip)))[0])


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def ssl_details(target: str, pinned_ip: str) -> dict[str, Any]:
    try:
        context = ssl.create_default_context()
        with socket.create_connection((pinned_ip, 443), timeout=3.5) as sock:
            with context.wrap_socket(sock, server_hostname=target) as tls:
                tls.settimeout(3.5)
                cert = tls.getpeercert()
                common_name = next((value for group in cert.get("subject", [])
                                    for label, value in group if label == "commonName"), "")
                issuer = next((value for group in cert.get("issuer", [])
                               for label, value in group if label == "commonName"), "")
                expiry = cert.get("notAfter", "")
                return {"common_name": common_name, "issuer": issuer,
                        "expires": expiry, "protocol": tls.version(),
                        "san": [name for type_, name in cert.get("subjectAltName", []) if type_ == "DNS"][:20],
                        "validated": True}
    except (OSError, ssl.SSLError, TimeoutError):
        return {"validated": False, "error": "TLS недоступен либо сертификат не прошёл проверку."}


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname: str, ip: str, **kwargs: Any):
        super().__init__(hostname, **kwargs)
        self._pinned_ip = ip

    def connect(self) -> None:
        self.sock = socket.create_connection((self._pinned_ip, self.port), timeout=self.timeout)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, hostname: str, ip: str, **kwargs: Any):
        super().__init__(hostname, **kwargs)
        self._pinned_ip = ip

    def connect(self) -> None:
        self.sock = socket.create_connection((self._pinned_ip, self.port), timeout=self.timeout)


def http_headers(target: str, pinned_ip: str) -> dict[str, Any]:
    """One HEAD request per scheme, / only, no redirects and no response bodies."""
    for secure in (True, False):
        client = (_PinnedHTTPSConnection(target, pinned_ip, timeout=3.5, context=ssl.create_default_context())
                  if secure else _PinnedHTTPConnection(target, pinned_ip, timeout=3.5))
        try:
            client.request("HEAD", "/", headers={"User-Agent": USER_AGENT,
                                                   "Host": target, "Connection": "close"})
            response = client.getresponse()
            wanted = {"server", "content-type", "strict-transport-security", "x-frame-options",
                      "x-content-type-options", "content-security-policy", "location", "x-powered-by"}
            headers = {name.lower(): value[:400] for name, value in response.getheaders()
                       if name.lower() in wanted}
            return {"url": f"{'https' if secure else 'http'}://{target}/", "status": response.status,
                    "headers": headers, "scheme": "https" if secure else "http"}
        except (OSError, TimeoutError, ssl.SSLError, http.client.HTTPException):
            continue
        finally:
            client.close()
    return {"error": "HTTP/HTTPS HEAD не ответил вовремя или сертификат недействителен."}


def build_graph(target: str, kind: str, dns_records: list[dict[str, str]], subdomains: list[str]) -> dict[str, Any]:
    nodes: list[dict[str, str]] = [{"id": target, "label": target, "type": kind}]
    links: list[dict[str, str]] = []
    seen = {target}
    for record in dns_records:
        if record["type"] not in ("A", "AAAA", "NS", "MX", "CNAME"):
            continue
        value = record["value"]
        if record["type"] == "MX":
            value = value.split(" ", 1)[-1].rstrip(".")
        value = value.rstrip(".")
        if value not in seen:
            seen.add(value)
            nodes.append({"id": value, "label": value, "type": "ip" if record["type"] in ("A", "AAAA") else "dns"})
        links.append({"source": target, "target": value, "type": record["type"]})
    for subdomain in subdomains[:16]:
        if subdomain not in seen:
            seen.add(subdomain)
            nodes.append({"id": subdomain, "label": subdomain, "type": "subdomain"})
        links.append({"source": target, "target": subdomain, "type": "CT"})
    return {"nodes": nodes[:60], "edges": links[:90]}


def analyze(raw: str, authorized: bool = False, include_ct: bool = False) -> dict[str, Any]:
    target, kind = normalize_target(raw)
    notes: list[str] = []
    if kind == "domain":
        records, dns_notes = resolve_dns(target)
        notes.extend(dns_notes)
    else:
        records = []
    rdap = fetch_rdap(target, kind)
    if not rdap:
        notes.append("RDAP не ответил: проверь интернет или повтори запрос позже.")
    subdomains = certificate_transparency(target) if include_ct and kind == "domain" else []
    tls: dict[str, Any] = {}
    http: dict[str, Any] = {}
    if authorized:
        try:
            ip = pinned_public_ip(target)
            tls = ssl_details(target, ip)
            http = http_headers(target, ip)
        except TargetError as exc:
            notes.append(str(exc))
    graph = build_graph(target, kind, records, subdomains)
    ips = sorted({rec["value"] for rec in records if rec["type"] in ("A", "AAAA")})
    security: list[dict[str, str]] = []
    if authorized and tls.get("validated") is False:
        security.append({"level": "warning", "title": "TLS не подтверждён", "detail": tls.get("error", "")})
    if authorized and http.get("scheme") == "http":
        security.append({"level": "info", "title": "Доступен HTTP", "detail": "Сайт ответил на HTTP HEAD, HTTPS не подтвердился."})
    if not security:
        security.append({"level": "neutral", "title": "Без автоматических выводов", "detail": "Это инвентаризация, не аудит уязвимостей."})
    return {"target": target, "kind": kind, "scanned_at": utc_now(),
            "authorized_probe": authorized, "ct_enabled": include_ct,
            "dns": records, "ip_addresses": ips, "rdap": rdap, "subdomains": subdomains,
            "tls": tls, "http": http, "graph": graph, "security": security, "notes": notes,
            "summary": {"dns_records": len(records), "ips": len(ips), "subdomains": len(subdomains),
                        "nodes": len(graph["nodes"]), "http_status": http.get("status")}}
