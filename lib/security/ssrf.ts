// Server-only SSRF guard for endpoints that fetch a URL supplied by the user
// (product-page scraper, social scraper, brand-kit sample fetch). Without this a
// user can point the server at internal addresses (cloud metadata, private
// services) and — for scrape-product — read the response back.
//
// Threat model: block http(s) requests whose hostname resolves into a private /
// loopback / link-local / cloud-metadata range. Not a hardened proxy (no defence
// against DNS-rebinding mid-connection), but it closes the trivial SSRF vectors
// for our set of trusted users.
import { lookup } from 'node:dns/promises'
import net from 'node:net'

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true // malformed → treat as unsafe
  const [a, b] = p
  return (
    a === 0 ||                                  // 0.0.0.0/8
    a === 10 ||                                 // 10.0.0.0/8 private
    a === 127 ||                                // 127.0.0.0/8 loopback
    (a === 169 && b === 254) ||                 // 169.254.0.0/16 link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||        // 172.16.0.0/12 private
    (a === 192 && b === 168) ||                 // 192.168.0.0/16 private
    (a === 100 && b >= 64 && b <= 127) ||       // 100.64.0.0/10 CGNAT
    a >= 224                                    // 224+ multicast / reserved
  )
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase()
  if (s === '::1' || s === '::') return true                 // loopback / unspecified
  if (s.startsWith('fe80')) return true                      // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true  // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4.
  const m = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (m) return isPrivateIPv4(m[1])
  return false
}

function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip)
  if (v === 4) return isPrivateIPv4(ip)
  if (v === 6) return isPrivateIPv6(ip)
  return true // not a recognisable IP → unsafe
}

// Throws Error('unsafe_url') if the URL is not a public http(s) address.
// Returns the parsed URL on success.
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error('unsafe_url')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('unsafe_url')
  // Reject credentials in the URL and obvious localhost spellings early.
  if (u.username || u.password) throw new Error('unsafe_url')
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    throw new Error('unsafe_url')
  }
  // If the host is already a literal IP, check it directly; else resolve it.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('unsafe_url')
    return u
  }
  let records: { address: string }[]
  try {
    records = await lookup(host, { all: true })
  } catch {
    throw new Error('unsafe_url') // unresolvable → don't fetch
  }
  if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
    throw new Error('unsafe_url')
  }
  return u
}
