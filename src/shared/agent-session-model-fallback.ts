// What a chat runs when the account's verified model list no longer offers its selected model.
// Shared by the host (at rest and at start) and the picker, so both move to the same model.

import type { AgentSessionOptionCatalog } from './agent-session-option-catalog'
import {
  cloneNativeChatSessionOptionRecord,
  type NativeChatSessionOptionRecord
} from './native-chat-session-option-state'

/** The model that replaces `selected`: the list's default, else its first. Null keeps the selection:
 *  nothing selected, the list offers it, or there is no list to judge it by. */
export function verifiedListModelReplacement(
  models: readonly { id: string; isDefault?: boolean }[],
  selected: string | null | undefined
): string | null {
  if (!selected || models.length === 0 || models.some((model) => model.id === selected)) {
    return null
  }
  return (models.find((model) => model.isDefault === true) ?? models[0]!).id
}

/** `record` with a selection the verified `catalog` lacks moved to its replacement, shown as a
 *  `default` and keeping its effort where the replacement lists it; `record` itself otherwise. */
export function verifiedListReplacementRecord(
  catalog: AgentSessionOptionCatalog,
  record: NativeChatSessionOptionRecord
): NativeChatSessionOptionRecord {
  const selected = typeof record.model?.value === 'string' ? record.model.value : null
  const replacement = verifiedListModelReplacement(catalog.models, selected)
  if (!selected || !replacement) {
    return record
  }
  const next = cloneNativeChatSessionOptionRecord(record)
  next.model = { value: replacement, source: 'default' }
  const effort = next.valuesByModel[selected]?.effort
  const effortOption = catalog.models
    .find((model) => model.id === replacement)
    ?.options.find((option) => option.id === 'effort')
  if (
    effort &&
    effortOption?.kind.type === 'select' &&
    effortOption.kind.choices.some((choice) => choice.value === effort.value)
  ) {
    next.valuesByModel[replacement] = { ...next.valuesByModel[replacement], effort }
  }
  return next
}
