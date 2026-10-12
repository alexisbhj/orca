import { describe, expect, it } from 'vitest'
import { PLUGIN_EXTERNAL_URL_MAX_LENGTH, parsePluginExternalUrl } from './plugin-external-url'

describe('parsePluginExternalUrl', () => {
  it.each([
    ['https://github.com/alexisbhj/orca/issues/8', 'https://github.com/alexisbhj/orca/issues/8'],
    ['https://example.com', 'https://example.com/'],
    ['https://Example.COM/x', 'https://example.com/x'],
    ['https://[::1]:8443/', 'https://[::1]:8443/'],
    ['https://xn--bcher-kva.example/', 'https://xn--bcher-kva.example/'],
    ['https://example.com:8443/a?b=c#d', 'https://example.com:8443/a?b=c#d'],
    ['https://example.com/a%20b', 'https://example.com/a%20b']
  ])('accepts %s', (raw, normalized) => {
    expect(parsePluginExternalUrl(raw)).toEqual({ ok: true, url: normalized })
  })

  it.each([
    ['http://example.com', 'only https: URLs are allowed'],
    ['file:///etc/passwd', 'only https: URLs are allowed'],
    ['javascript:alert(1)', 'only https: URLs are allowed'],
    ['data:text/html,hi', 'only https: URLs are allowed'],
    ['HTTPS://example.com', 'only https: URLs are allowed'],
    ['https:example.com', 'only https: URLs are allowed'],
    ['https:/example.com', 'only https: URLs are allowed'],
    ['https:///example.com', 'URL must name a host'],
    ['https://user:pw@example.com', 'URL must not contain credentials'],
    ['https://user@example.com', 'URL must not contain credentials'],
    ['https://@example.com', 'URL must not contain credentials'],
    ['https://example.com@evil.com/', 'URL must not contain credentials'],
    ['https://%65xample.com/', 'URL host must not be percent-encoded'],
    ['https:\\\\example.com', 'URL must not contain backslashes, spaces or control characters'],
    [
      'https://example.com\\@evil.com',
      'URL must not contain backslashes, spaces or control characters'
    ],
    [' https://example.com', 'URL must not contain backslashes, spaces or control characters'],
    ['https://exa mple.com', 'URL must not contain backslashes, spaces or control characters'],
    ['https://example.com/\n', 'URL must not contain backslashes, spaces or control characters'],
    ['https://exa\u200bmple.com', 'URL must not contain backslashes, spaces or control characters'],
    ['https://', 'URL must name a host'],
    ['https://2130706433/', 'URL host must be in canonical form'],
    ['https://0x7f.1/', 'URL host must be in canonical form'],
    ['https://example.com:443/', 'URL host must be in canonical form'],
    ['https://bücher.example/', 'URL host must be in canonical form'],
    ['https://[::1', 'URL is not well-formed'],
    ['/relative/path', 'only https: URLs are allowed'],
    ['', 'URL must not be empty']
  ])('refuses %j', (raw, error) => {
    expect(parsePluginExternalUrl(raw)).toEqual({ ok: false, error })
  })

  it('bounds the URL length', () => {
    const raw = `https://example.com/${'a'.repeat(PLUGIN_EXTERNAL_URL_MAX_LENGTH)}`
    expect(parsePluginExternalUrl(raw)).toEqual({
      ok: false,
      error: `URL exceeds ${PLUGIN_EXTERNAL_URL_MAX_LENGTH} characters`
    })
  })

  it('bounds the normalized length, which percent-encoding can expand', () => {
    const raw = `https://example.com/${'"'.repeat(1000)}`
    expect(raw.length).toBeLessThanOrEqual(PLUGIN_EXTERNAL_URL_MAX_LENGTH)
    expect(parsePluginExternalUrl(raw)).toEqual({
      ok: false,
      error: `URL exceeds ${PLUGIN_EXTERNAL_URL_MAX_LENGTH} characters once normalized`
    })
  })
})
