import { useState, type ReactNode } from 'react'
import { useAppStore } from '@/store'
import { usePluginPanels } from '@/store/plugin-panels'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import PluginPanel from '../right-sidebar/PluginPanel'

/** Left contributions reuse the sandbox and leave native navigation one tab away. */
export function SidebarPanelTabs({ open, children }: { open: boolean; children: ReactNode }) {
  const enabled = useAppStore((state) => state.settings?.pluginSystemEnabled === true)
  const panels = usePluginPanels().filter((panel) => enabled && panel.placement === 'left')
  const [selectedTab, setSelectedTab] = useState('navigation')
  const activeTab = panels.some((panel) => panel.tabKey === selectedTab)
    ? selectedTab
    : 'navigation'

  if (!open) {
    return null
  }
  if (panels.length === 0) {
    return <>{children}</>
  }

  return (
    <Tabs value={activeTab} onValueChange={setSelectedTab} className="min-h-0 flex-1">
      <div className="shrink-0 overflow-x-auto scrollbar-sleek">
        <TabsList variant="line" aria-label={translate('sidebar.panels.label', 'Sidebar panels')}>
          <TabsTrigger value="navigation">
            {translate('sidebar.panels.navigation', 'Navigation')}
          </TabsTrigger>
          {panels.map((panel) => (
            <TabsTrigger key={panel.tabKey} value={panel.tabKey}>
              {panel.title}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent key={activeTab} value={activeTab} className="flex min-h-0 flex-col">
        {activeTab === 'navigation' ? children : <PluginPanel tabKey={activeTab} />}
      </TabsContent>
    </Tabs>
  )
}
