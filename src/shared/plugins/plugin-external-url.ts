import { z } from 'zod'

export const PLUGIN_EXTERNAL_URL_MAX_LENGTH = 2048
/** Per-plugin opening budget, inside the general 30 messages/10 s panel budget. */
export const PLUGIN_EXTERNAL_OPEN_RATE_LIMIT = {
  maxMessages: 3,
  perMs: 10_000
}

export type PluginExternalUrlParseResult = { ok: true; url: string } | { ok: false; error: string }

// Whitespace, controls, invisible/bidi formatting and backslashes are refused outright
// instead of being normalized: each one makes what the plugin shows differ from what opens.
const AMBIGUOUS_CHARACTER = /[\s\\\p{Cc}\p{Cf}]/u

/** Strict, browser-independent gate for plugin-requested external links. */
export function parsePluginExternalUrl(raw: string): PluginExternalUrlParseResult {
  if (raw.length === 0) {
    return { ok: false, error: 'URL must not be empty' }
  }
  if (raw.length > PLUGIN_EXTERNAL_URL_MAX_LENGTH) {
    return {
      ok: false,
      error: `URL exceeds ${PLUGIN_EXTERNAL_URL_MAX_LENGTH} characters`
    }
  }
  if (AMBIGUOUS_CHARACTER.test(raw)) {
    return {
      ok: false,
      error: 'URL must not contain backslashes, spaces or control characters'
    }
  }
  // Case-sensitive literal prefix: rejects other schemes and scheme-relative/slash-less forms.
  if (!raw.startsWith('https://')) {
    return { ok: false, error: 'only https: URLs are allowed' }
  }
  const authority = raw.slice('https://'.length).split(/[/?#]/, 1)[0]
  if (authority.includes('@')) {
    return { ok: false, error: 'URL must not contain credentials' }
  }
  if (authority.length === 0) {
    return { ok: false, error: 'URL must name a host' }
  }
  if (authority.includes('%')) {
    return { ok: false, error: 'URL host must not be percent-encoded' }
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: 'URL is not well-formed' }
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.length === 0) {
    return { ok: false, error: 'URL is not well-formed' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL must not contain credentials' }
  }
  // Why: numeric/hex IPv4, IDN, default ports and similar rewrites make the opened
  // host differ from the one the plugin showed.
  if (parsed.host !== authority.toLowerCase()) {
    return { ok: false, error: 'URL host must be in canonical form' }
  }
  return { ok: true, url: parsed.href }
}

export const openExternalParamsSchema = z
  .object({
    url: z.string().transform((raw, ctx) => {
      const result = parsePluginExternalUrl(raw)
      if (!result.ok) {
        ctx.addIssue({ code: 'custom', message: result.error })
        return z.NEVER
      }
      return result.url
    })
  })
  .strict()

export const openExternalResultSchema = z.object({ opened: z.literal(true) }).strict()
