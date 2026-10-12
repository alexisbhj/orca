import { z } from 'zod'

// Leave room for the correlation id and transport envelope in the 64 KiB frame.
export const PLUGIN_COMMAND_JSON_MAX_BYTES = 60 * 1024

function isBoundedJson(value: unknown): boolean {
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  let characters = 0
  while (pending.length) {
    const current = pending.pop()!
    if (++nodes > 10_000 || current.depth > 100) {
      return false
    }
    const item = current.value
    if (typeof item === 'string') {
      characters += item.length
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item)) {
        return false
      }
    } else if (item !== null && typeof item === 'object') {
      if (Array.isArray(item) && item.length > 10_000) {
        return false
      }
      if (
        !Array.isArray(item) &&
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      ) {
        return false
      }
      const entries = Object.entries(item)
      if (entries.length + pending.length > 10_000) {
        return false
      }
      for (const [key, child] of entries) {
        characters += key.length
        pending.push({ value: child, depth: current.depth + 1 })
      }
    } else if (item !== null && typeof item !== 'boolean') {
      return false
    }
    if (characters > PLUGIN_COMMAND_JSON_MAX_BYTES) {
      return false
    }
  }
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= PLUGIN_COMMAND_JSON_MAX_BYTES
    )
  } catch {
    return false
  }
}

export const pluginCommandJsonSchema = z
  .unknown()
  .refine(isBoundedJson, 'expected bounded JSON')
  .pipe(z.json())
