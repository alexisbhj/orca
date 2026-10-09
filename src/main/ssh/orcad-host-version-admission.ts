/**
 * The downgrade rule every orcad activation on a shared host applies: a build may not start over
 * state a newer Orca's orcad may already have migrated.
 */
import { compareAppVersions } from '../../shared/app-version'
import type { OrcadActivationRecord } from './orcad-activation-record'

export type OrcadHostVersionRefusal =
  | 'host-newer'
  /** Another desktop stopped a build whose Orca version the host does not name. */
  | 'stopped-version-unknown'

export function refuseOrcadHostDowngrade(
  record: OrcadActivationRecord,
  candidateVersion: string,
  appVersion: string
): OrcadHostVersionRefusal | null {
  const stopped = record.active === null && record.previous !== null
  // Restarting the very build that was stopped cannot downgrade anything.
  if (stopped && record.previous === candidateVersion) {
    return null
  }
  if (!record.activeAppVersion) {
    // Why absent differs: a running record omits it only from builds that predate the field, which
    // are older; a stop committed by such a build omits it too, so its version is unknown.
    return stopped ? 'stopped-version-unknown' : null
  }
  return compareAppVersions(record.activeAppVersion, appVersion) > 0 ? 'host-newer' : null
}
