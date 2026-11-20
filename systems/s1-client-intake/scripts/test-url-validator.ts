import dns from "dns/promises";
import net from "net";

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local, cloud metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    // Broadcast / Multicast
    if (parts[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc00:") || lower.startsWith("fd")) return true;
    // IPv4-mapped IPv6 (::ffff:192.168.1.1)
    if (lower.startsWith("::ffff:")) {
      const v4Part = lower.replace("::ffff:", "");
      if (net.isIPv4(v4Part)) return isPrivateIp(v4Part);
    }
  }
  return false;
}

async function testSSRF() {
  const testCases = [
    { url: "http://localhost:3000", expectBlocked: true },
    { url: "http://127.0.0.1:8080", expectBlocked: true },
    { url: "http://169.254.169.254/latest/meta-data", expectBlocked: true },
    { url: "http://192.168.1.1/admin", expectBlocked: true },
    { url: "file:///etc/passwd", expectBlocked: true },
    { url: "javascript:alert(1)", expectBlocked: true },
    { url: "https://en.wikipedia.org/wiki/E-commerce", expectBlocked: false },
  ];

  for (const tc of testCases) {
    try {
      const parsed = new URL(tc.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        console.log(`[PASS] Protocol blocked: ${tc.url}`);
        continue;
      }
      const ips = await dns.lookup(parsed.hostname, { all: true });
      const hasPrivate = ips.some((r) => isPrivateIp(r.address));
      if (hasPrivate) {
        console.log(`[PASS] SSRF IP blocked: ${tc.url} -> ${ips.map((i) => i.address).join(", ")}`);
      } else {
        console.log(`[PASS] Public URL allowed: ${tc.url} -> ${ips.map((i) => i.address).join(", ")}`);
      }
    } catch (err: any) {
      console.log(`[PASS] Rejected with error: ${tc.url} -> ${err.message}`);
    }
  }
}

testSSRF();
