import { describe, it, expect } from 'vitest'
import { assertPublicUrl } from '@/lib/security/ssrf'

// SSRF guard for user-supplied fetch URLs. A regression that lets a private/
// metadata address through re-opens internal-network access from the scrapers.
describe('assertPublicUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow('unsafe_url')
    await expect(assertPublicUrl('ftp://example.com')).rejects.toThrow('unsafe_url')
    await expect(assertPublicUrl('gopher://x')).rejects.toThrow('unsafe_url')
  })

  it('rejects localhost and cloud metadata by name', async () => {
    await expect(assertPublicUrl('http://localhost/')).rejects.toThrow('unsafe_url')
    await expect(assertPublicUrl('http://metadata.google.internal/')).rejects.toThrow('unsafe_url')
  })

  it('rejects literal private / loopback / link-local IPs', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toThrow('unsafe_url')
    await expect(assertPublicUrl('http://10.0.0.5/')).rejects.toThrow('unsafe_url')
    await expect(assertPublicUrl('http://172.16.3.4/')).rejects.toThrow('unsafe_url')
    await expect(assertPublicUrl('http://192.168.1.1/')).rejects.toThrow('unsafe_url')
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('unsafe_url')
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow('unsafe_url')
  })

  it('rejects credentials in the URL', async () => {
    await expect(assertPublicUrl('http://user:pass@1.2.3.4/')).rejects.toThrow('unsafe_url')
  })

  it('rejects garbage', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toThrow('unsafe_url')
  })

  it('accepts a public literal IP', async () => {
    const u = await assertPublicUrl('https://1.1.1.1/')
    expect(u.hostname).toBe('1.1.1.1')
  })
})
