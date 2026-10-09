import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionModelCatalogResult } from '../../../shared/agent-session-wire'
import type { AgentModelCatalogService } from './agent-model-catalog-service'
import {
  nearestAgentEffort,
  unlistedAgentModelReplacement
} from '../../../shared/agent-session-model-fallback'

/** The saved options a chat runs, judged against the host's catalog answer: a model a current list
 *  no longer offers gives way to the host's replacement, its effort carried to the nearest level
 *  that model offers. Any doubt keeps the selection as saved. */
export function settledAgentModelSelection(
  catalog: AgentSessionModelCatalogResult,
  saved: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  if (catalog.origin === 'unknown') {
    return saved
  }
  const replacement = unlistedAgentModelReplacement(
    catalog.models,
    saved.model,
    catalog.unlistedModelReplacement
  )
  if (!replacement) {
    return saved
  }
  const { effort, ...rest } = saved
  const offered = catalog.models.find((model) => model.id === replacement)?.efforts ?? []
  const carried = nearestAgentEffort(
    effort,
    offered.map((choice) => choice.value)
  )
  return { ...rest, model: replacement, ...(carried ? { effort: carried } : {}) }
}

/** The saved options a start launches with, decided as an at-rest read is. The catalog never gates
 *  a start: no catalog, a failed read, or a re-listing slower than the start's short wait launches
 *  the selection as saved. */
export async function agentModelLaunchOptions(
  catalog: Pick<AgentModelCatalogService, 'read'> | undefined,
  record: Pick<AgentSessionRecord, 'provider' | 'sessionId' | 'options'>
): Promise<Readonly<Record<string, string>> | undefined> {
  const saved = record.options
  if (!catalog || !saved?.model) {
    return saved
  }
  const answer = await catalog
    .read({ agent: record.provider, sessionId: record.sessionId, forStart: true })
    .catch(() => null)
  return answer ? settledAgentModelSelection(answer, saved) : saved
}
