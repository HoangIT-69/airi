/** A folder the user granted to the assistant. The host app owns the list and the folder access. */
export interface ChatWorkspace {
  id: string
  name: string
  /** Absolute folder path on the user's machine. */
  path: string
  addedAt: number
}
