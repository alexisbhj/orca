import { createContext, useEffect, type Dispatch, type SetStateAction } from 'react'

/** What `app/h/_layout.tsx` tells the shell screens under it: whether it is wide, and a way to say a
 *  host-area page is serving so the native sidebar steps aside on the host route. */
export type HostLayoutClass = {
  wide: boolean
  reportHostArea: Dispatch<SetStateAction<string | null>>
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
    // Only its own report: a session for another host may have taken over since.
    return () => report((current) => (current === hostId ? null : current))
  }, [report, hostId, serving])
}
