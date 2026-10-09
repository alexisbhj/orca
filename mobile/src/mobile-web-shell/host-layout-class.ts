import { createContext, useEffect } from 'react'

/** What `app/h/_layout.tsx` tells the shell screens under it: whether it is wide, and a way to say a
 *  host-area page is serving so the native sidebar steps aside on the host route. */
export type HostLayoutClass = {
  wide: boolean
  reportHostArea: (hostId: string | null) => void
}

export const HostLayoutClassContext = createContext<HostLayoutClass>({
  wide: false,
  reportHostArea: () => {}
})

/** Inert unless `serving`, so a phone never writes the layout's state. */
export function useReportedHostArea(
  report: HostLayoutClass['reportHostArea'],
  hostId: string,
  serving: boolean
): void {
  useEffect(() => {
    if (!serving) {
      return
    }
    report(hostId)
    return () => report(null)
  }, [report, hostId, serving])
}
