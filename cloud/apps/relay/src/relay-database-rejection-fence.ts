import pg from 'pg'
import {
  isPostgresPoolAcquireFailure,
  isPostgresPoolConnectFailure
} from './postgres-pool-pressure.js'

// A database fault reaching unhandledRejection must not kill the cell: on 09-28 one failover
// crashed 18 cells and dropped ~16k hosts. A rejection is fenced only when both hold:
//   path: the relay's database layer threw or rethrew it (marked below), and
//   type: a pool acquire failure, pg's read timeout, a dropped connection, or a server error
//         in a class that means "the database is unwell", not "this code is wrong".
// Everything else stays fatal: schema errors (42), data errors (22), TypeErrors from pg's
// parameter serialisation, and every bare socket errno from ws or fetch.
const databaseLayerErrors = new WeakSet<object>()

// Set by pg's query_timeout timer (pg@8.22 client.js).
export const POSTGRES_READ_TIMEOUT_MESSAGE = 'Query read timeout'
const CONNECTION_TERMINATED_PREFIX = 'Connection terminated'
const FENCED_SQLSTATE_CLASSES = new Set(['08', '23', '40', '53', '55', '57', '58'])

export function markRelayDatabaseError(error: unknown): void {
  if (typeof error === 'object' && error !== null) databaseLayerErrors.add(error)
}

export function isFencedRelayDatabaseRejection(reason: unknown): boolean {
  if (typeof reason !== 'object' || reason === null) return false
  // Any acquire failure, including a 28P01 at connect: no statement ran, so nothing is unknown.
  if (isPostgresPoolAcquireFailure(reason)) return true
  if (!databaseLayerErrors.has(reason)) return false
  if (isPostgresPoolConnectFailure(reason)) return true
  if (reason instanceof pg.DatabaseError) {
    return FENCED_SQLSTATE_CLASSES.has(String(reason.code).slice(0, 2))
  }
  if (!(reason instanceof Error) || reason instanceof TypeError) return false
  return (
    reason.message === POSTGRES_READ_TIMEOUT_MESSAGE ||
    reason.message.startsWith(CONNECTION_TERMINATED_PREFIX)
  )
}

function rejectionFields(reason: unknown): { code: string; message: string } {
  const error = typeof reason === 'object' && reason !== null ? reason : {}
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : String(reason)
  // Server messages can quote values; the code and the start of the message identify the fault.
  return { code, message: message.replace(/[^\x20-\x7e]/g, '').slice(0, 120) }
}

// Installed once by the process entry point. Fatal rejections are rethrown, which ends the
// process exactly as Node's default would, after one line that names them.
export function handleRelayUnhandledRejection(reason: unknown): void {
  if (isFencedRelayDatabaseRejection(reason)) {
    console.warn(
      JSON.stringify({ event: 'orca_relay_database_rejection_fenced', ...rejectionFields(reason) })
    )
    return
  }
  console.error(
    JSON.stringify({
      event: 'orca_relay_process_fatal',
      kind: 'unhandled-rejection',
      ...rejectionFields(reason)
    })
  )
  throw reason
}
