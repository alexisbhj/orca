import { z } from 'zod'
import { findCatalogOption } from './agent-session-option-catalog'
import type { CatalogOption } from './agent-session-option-catalog-types'
import { getAgentSessionOptionLaunchCatalog } from './agent-session-option-launch'
import { MAX_LAUNCH_PREFERENCE_LENGTH } from './rpc-contract/agent-session-params'
import { TerminalTypedCreate } from './rpc-contract/terminal-typed-create-params'

/**
 * Read-only projection of the native launch catalog that `terminal.createTyped`
 * validates against. It describes what Orca can pass to an agent CLI, never
 * what the signed-in account may actually run.
 */

export const TYPED_AGENT_LAUNCH_CATALOG_VERSION = 1
export const TYPED_AGENT_LAUNCH_CATALOG_AGENT_LIMIT = 16
export const TYPED_AGENT_LAUNCH_CATALOG_MODEL_LIMIT = 64
export const TYPED_AGENT_LAUNCH_CATALOG_EFFORT_LIMIT = 16
const ID_MAX = MAX_LAUNCH_PREFERENCE_LENGTH
const LABEL_MAX = 256

/** Exactly the agent/model/effort fields `terminal.createTyped` accepts. */
export const TypedAgentLaunchChoice = TerminalTypedCreate.pick({
  agent: true,
  model: true,
  effort: true
}).strict()
export type TypedAgentLaunchChoice = z.infer<typeof TypedAgentLaunchChoice>

const effortSchema = z.object({
  id: z.string().min(1).max(ID_MAX),
  label: z.string().max(LABEL_MAX)
})

const effortMenuSchema = z.object({
  efforts: z.array(effortSchema).max(TYPED_AGENT_LAUNCH_CATALOG_EFFORT_LIMIT),
  /** Preselected value; omitting effort sends no flag and the agent CLI decides. */
  defaultEffort: z.string().max(ID_MAX).nullable(),
  /** True only when the provider states `defaultEffort` is what its CLI runs. */
  defaultEffortIsCliDefault: z.boolean()
})

export const typedAgentLaunchCatalogSchema = z.object({
  version: z.literal(TYPED_AGENT_LAUNCH_CATALOG_VERSION),
  /** The catalog lists launchable values only; account access is never verified. */
  accountAccessVerified: z.literal(false),
  agents: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        /** False: the agent launches only with its own configured model. */
        modelSelection: z.boolean(),
        /** `--effort` is refused unless a model is chosen too. */
        effortRequiresModel: z.literal(true),
        /** Model run when none is chosen: the CLI default if known, else the agent's own config. */
        defaultModel: z.object({
          id: z.string().max(ID_MAX).nullable(),
          source: z.enum(['cli-default', 'agent-config'])
        }),
        models: z
          .array(
            effortMenuSchema.extend({
              id: z.string().min(1).max(ID_MAX),
              label: z.string().max(LABEL_MAX)
            })
          )
          .max(TYPED_AGENT_LAUNCH_CATALOG_MODEL_LIMIT),
        /** Model ids absent from `models` the agent still accepts verbatim (e.g. Codex). */
        customModels: z.discriminatedUnion('accepted', [
          z.object({ accepted: z.literal(false) }),
          effortMenuSchema.extend({
            accepted: z.literal(true),
            maxLength: z.number().int().positive()
          })
        ])
      })
    )
    .max(TYPED_AGENT_LAUNCH_CATALOG_AGENT_LIMIT)
})
export type TypedAgentLaunchCatalog = z.infer<typeof typedAgentLaunchCatalogSchema>

export const typedAgentLaunchCheckResultSchema = z.discriminatedUnion('valid', [
  z.object({
    valid: z.literal(true),
    choice: z.object({
      agent: z.string().max(64),
      model: z.string().max(ID_MAX).nullable(),
      effort: z.string().max(ID_MAX).nullable()
    })
  }),
  z.object({
    valid: z.literal(false),
    code: z.string().max(64),
    message: z.string().max(1024)
  })
])
export type TypedAgentLaunchCheckResult = z.infer<typeof typedAgentLaunchCheckResultSchema>

function projectEffortMenu(option: CatalogOption | undefined): z.infer<typeof effortMenuSchema> {
  if (option?.kind.type !== 'select') {
    return { efforts: [], defaultEffort: null, defaultEffortIsCliDefault: false }
  }
  return {
    efforts: option.kind.choices
      .slice(0, TYPED_AGENT_LAUNCH_CATALOG_EFFORT_LIMIT)
      .map((choice) => ({ id: choice.value, label: choice.label.slice(0, LABEL_MAX) })),
    defaultEffort: option.kind.defaultValue,
    defaultEffortIsCliDefault: option.kind.defaultIsCliDefault === true
  }
}

export function buildTypedAgentLaunchCatalog(): TypedAgentLaunchCatalog {
  const agents = TerminalTypedCreate.shape.agent.options.map((agent) => {
    const catalog = getAgentSessionOptionLaunchCatalog(agent)
    // Why: mirrors the gate `terminal.createTyped` applies before accepting --model.
    const modelSelection = Boolean(
      catalog?.supportsWorkerLaunchPreferences && catalog.modelApply.launchArgs
    )
    const cliDefault = catalog?.defaultModelIsCliDefault
      ? catalog.models.find((model) => model.isDefault)
      : undefined
    const unknownEffort = catalog?.unknownModelOptions?.find((option) => option.id === 'effort')
    return {
      id: agent,
      modelSelection,
      effortRequiresModel: true as const,
      defaultModel: cliDefault
        ? { id: cliDefault.id, source: 'cli-default' as const }
        : { id: null, source: 'agent-config' as const },
      models:
        modelSelection && catalog
          ? catalog.models.slice(0, TYPED_AGENT_LAUNCH_CATALOG_MODEL_LIMIT).map((model) => ({
              id: model.id,
              label: model.label.slice(0, LABEL_MAX),
              ...projectEffortMenu(findCatalogOption(model, 'effort'))
            }))
          : [],
      // Why: createTyped passes any well-formed model id through; only effort needs a menu.
      customModels: modelSelection
        ? {
            accepted: true as const,
            maxLength: MAX_LAUNCH_PREFERENCE_LENGTH,
            ...projectEffortMenu(unknownEffort)
          }
        : { accepted: false as const }
    }
  })
  return {
    version: TYPED_AGENT_LAUNCH_CATALOG_VERSION,
    accountAccessVerified: false,
    agents: agents.slice(0, TYPED_AGENT_LAUNCH_CATALOG_AGENT_LIMIT)
  }
}
