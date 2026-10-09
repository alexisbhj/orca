import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionModelCatalogResult } from '../../../shared/agent-session-wire'
import type { AgentModelCatalogService } from './agent-model-catalog-service'
import { verifiedListModelReplacement } from '../../../shared/agent-session-model-fallback'

/** The saved options a chat runs, judged against the host's catalog answer: a model a verified list
 *  no longer offers gives way to its replacement, keeping an effort only where that model lists it.
 *  Any doubt keeps the selection as saved. */
export function settledAgentModelSelection(
  catalog: AgentSessionModelCatalogResult,
  saved: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  if (catalog.origin === 'unknown' || catalog.verified !== true) {
    return saved
  }
  const replacement = verifiedListModelReplacement(catalog.models, saved.model)
  if (!replacement) {
    return saved
  }
  const { effort, ...rest } = saved
  const efforts = catalog.models.find((model) => model.id === replacement)?.efforts ?? []
  return {
    ...rest,
    model: replacement,
    ...(effort && efforts.some((choice) => choice.value === effort) ? { effort } : {})
  }
}

/** The saved options a start launches with, decided as an at-rest read is. The catalog never gates
 *  a start: no catalog, or a failed read, launches the selection as saved. */
export async function agentModelLaunchOptions(
  catalog: Pick<AgentModelCatalogService, 'read'> | undefined,
  record: Pick<AgentSessionRecord, 'provider' | 'sessionId' | 'options'>
): Promise<Readonly<Record<string, string>> | undefined> {
  const saved = record.options
  if (!catalog || !saved?.model) {
    return saved
  }
  const answer = await catalog
    .read({
      agent: record.provider,
      sessionId: record.sessionId,
      settleRequiredModel: true,
      forStart: true
    })
    .catch(() => null)
  return answer ? settledAgentModelSelection(answer, saved) : saved
}
