// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivePluginPanel } from '@/store/plugin-panels'

const state = vi.hoisted(() => {
  const panels: ActivePluginPanel[] = []
  return { panels, enabled: true }
})
vi.mock('@/store', () => ({
  useAppStore: (select: (value: { settings: { pluginSystemEnabled: boolean } }) => unknown) =>
    select({ settings: { pluginSystemEnabled: state.enabled } })
}))
vi.mock('@/store/plugin-panels', () => ({ usePluginPanels: () => state.panels }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('../right-sidebar/PluginPanel', () => ({
  default: ({ tabKey }: { tabKey: string }) => <iframe title={tabKey} />
}))
import { SidebarPanelTabs } from './SidebarPanelTabs'

let container: HTMLDivElement
let root: Root
const panel: ActivePluginPanel = {
  id: 'tree',
  title: 'Fixture tree',
  placement: 'left',
  tabKey: 'plugin:fixture.demo/tree',
  pluginKey: 'fixture.demo',
  pluginName: 'Fixture'
}
async function render(open = true) {
  await act(async () =>
    root.render(
      <SidebarPanelTabs open={open}>
        <button>Native workspaces</button>
      </SidebarPanelTabs>
    )
  )
}
async function selectTab(label: string) {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (item) => item.textContent === label
  )
  expect(tab).toBeDefined()
  await act(async () =>
    tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  )
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.panels = [panel]
  state.enabled = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
describe('SidebarPanelTabs', () => {
  it('falls back to navigation when a selected panel disappears or plugins are disabled', async () => {
    await render()
    await selectTab('Fixture tree')
    state.panels = []
    await render()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('Native workspaces')
    state.panels = [panel]
    state.enabled = false
    await render()
    expect(container.querySelector('[role="tab"]')).toBeNull()
    expect(container.textContent).toContain('Native workspaces')
  })

  it('preserves the original sidebar when all panels use the right default', async () => {
    state.panels = [{ ...panel, placement: undefined }]
    await render()
    expect(container.querySelector('[role="tab"]')).toBeNull()
    expect(container.textContent).toBe('Native workspaces')
  })

  it('keeps native navigation accessible and restores the selected panel after temporary collapse', async () => {
    await render()
    expect(container.textContent).toContain('Native workspaces')
    await selectTab('Fixture tree')
    expect(container.querySelector('iframe')?.title).toBe(panel.tabKey)
    expect(container.textContent).not.toContain('Native workspaces')
    await render(false)
    expect(container.querySelector('iframe')).toBeNull()
    await render()
    expect(container.querySelector('iframe')?.title).toBe(panel.tabKey)
    await selectTab('Navigation')
    expect(container.textContent).toContain('Native workspaces')
    expect(container.querySelector('iframe')).toBeNull()
  })
})
