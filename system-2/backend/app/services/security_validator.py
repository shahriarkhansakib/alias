import socket
import ipaddress
import urllib.parse
from typing import Tuple, List, Optional
from app.core.logging import logger

BLOCKED_HOSTNAMES = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "metadata.google.internal",
    "instance-data",
    "169.254.169.254",
}


class SSRFValidationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def validate_url_safety(url_str: str, allow_local_demo: bool = False) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Validates target URL against SSRF vulnerabilities, DNS rebinding, and private address access.

    Returns:
        (is_safe, error_code, error_message)
    """
    try:
        parsed = urllib.parse.urlsplit(url_str)
    except Exception as e:
        return False, "INVALID_URL_SYNTAX", f"Failed to parse URL syntax: {str(e)}"

    if not parsed.scheme or not parsed.netloc:
        return False, "INVALID_URL_STRUCTURE", "URL must include a valid scheme and host network location."

    # In strict mode, enforce HTTPS
    scheme = parsed.scheme.lower()
    if scheme not in ("https", "http"):
        return False, "UNSUPPORTED_SCHEME", f"Unsupported URL scheme '{scheme}'. Only HTTPS is permitted."

    hostname = (parsed.hostname or "").lower().strip()
    if not hostname:
        return False, "EMPTY_HOSTNAME", "URL does not contain a valid hostname."

    # Handle local demo bypass if explicitly enabled for local test fixtures
    if allow_local_demo and (hostname in ("127.0.0.1", "localhost") and "/storage/demo" in parsed.path):
        return True, None, None

    # Enforce HTTPS for external remote targets
    if scheme != "https":
        return False, "INSECURE_SCHEME", "External assets must use secure HTTPS protocol."

    # Check blacklist of known dangerous hostnames
    if hostname in BLOCKED_HOSTNAMES or hostname.endswith(".internal") or hostname.endswith(".local"):
        return False, "SSRF_PROHIBITED_HOST", f"Access to hostname '{hostname}' is prohibited for security."

    # Resolve hostname via DNS and inspect resolved IP addresses
    try:
        # socket.getaddrinfo returns a list of 5-tuples: (family, type, proto, canonname, sockaddr)
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        return False, "DNS_RESOLUTION_FAILED", f"Could not resolve host '{hostname}': {str(e)}"
    except Exception as e:
        return False, "DNS_LOOKUP_ERROR", f"DNS lookup error for host '{hostname}': {str(e)}"

    if not addr_infos:
        return False, "DNS_NO_RECORDS", f"No DNS records found for host '{hostname}'."

    resolved_ips: List[str] = []
    for info in addr_infos:
        sockaddr = info[4]
        ip_str = sockaddr[0]
        resolved_ips.append(ip_str)

        try:
            ip_obj = ipaddress.ip_address(ip_str)
        except ValueError:
            return False, "INVALID_IP_RESOLVED", f"Resolved invalid IP address format: {ip_str}"

        # Strict checks against private/link-local/loopback addresses
        if ip_obj.is_loopback:
            return False, "SSRF_LOOPBACK_BLOCKED", f"Host '{hostname}' resolved to loopback address ({ip_str})."

        if ip_obj.is_private:
            return False, "SSRF_PRIVATE_IP_BLOCKED", f"Host '{hostname}' resolved to private network range ({ip_str})."

        if ip_obj.is_link_local:
            return False, "SSRF_LINK_LOCAL_BLOCKED", f"Host '{hostname}' resolved to link-local / cloud metadata range ({ip_str})."

        if ip_obj.is_multicast:
            return False, "SSRF_MULTICAST_BLOCKED", f"Host '{hostname}' resolved to multicast address ({ip_str})."

        if ip_obj.is_reserved:
            return False, "SSRF_RESERVED_IP_BLOCKED", f"Host '{hostname}' resolved to reserved IP address ({ip_str})."

        if ip_obj.is_unspecified:
            return False, "SSRF_UNSPECIFIED_IP_BLOCKED", f"Host '{hostname}' resolved to unspecified address ({ip_str})."

    return True, None, None
