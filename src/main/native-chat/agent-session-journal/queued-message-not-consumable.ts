/** A consume's compare-and-set lost: the card is no longer in the state the caller read, so the
 *  whole append it rode in rolls back. */
export class QueuedMessageNotConsumableError extends Error {
  constructor(
    readonly messageId: string,
    readonly expected: 'waiting' | 'returned'
  ) {
    super(`queued message ${messageId} is no longer ${expected}`)
    this.name = 'QueuedMessageNotConsumableError'
  }
}
