/**
 * Commands that only read the desktop. Everything else in the allowed `invoke` surface clicks,
 * types, focuses an app, or changes media playback, so the user confirms it first.
 */
const READ_ONLY_COMMANDS = new Set([
  'display.capture',
  'display.list',
  'screen.captureRegion',
  'screen.findText',
  'screen.waitForText',
  'window.list',
  'window.capture',
  'window.findText',
  'window.waitForText',
  'app.probePermissions',
  'mediaControl.nowPlaying',
])

/**
 * Returns true when an AUV invocation can change something on the desktop.
 *
 * @example
 * requiresConfirmation(['invoke', 'input.typeText', '--text', 'hi']) // => true
 * requiresConfirmation(['invoke', 'display.capture']) // => false
 */
export function requiresConfirmation(argv: string[]): boolean {
  const command = argv[1] ?? ''
  if (argv.includes('--help') || argv.includes('-h') || command === 'help')
    return false
  if (argv.includes('--dry-run'))
    return false
  return !READ_ONLY_COMMANDS.has(command)
}

/** One line for the confirmation dialog, with long arguments cut so the dialog stays readable. */
export function describeInvocation(argv: string[]): string {
  return argv.slice(1).map(arg => (arg.length > 120 ? `${arg.slice(0, 120)}…` : arg)).join(' ')
}

export type ConfirmationAnswer = 'once' | 'session' | 'deny'

/**
 * Remembers a time-boxed "allow for a while" answer, so a multi-step task such as
 * "open YouTube" does not ask before every keystroke.
 */
export function createConfirmationGate(options: {
  ask: (summary: string) => Promise<ConfirmationAnswer>
  trustMs: number
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let trustedUntil = 0
  // One dialog at a time. A call waiting here sees the answer of the dialog before it.
  let pending: Promise<unknown> = Promise.resolve()

  async function ask(summary: string) {
    if (now() < trustedUntil)
      return
    const answer = await options.ask(summary)
    if (answer === 'deny')
      throw new Error('The user declined this desktop action. Do not retry it unless the user asks again.')
    if (answer === 'session')
      trustedUntil = now() + options.trustMs
  }

  function enqueueAsk(summary: string): Promise<void> {
    const next = pending.then(() => ask(summary))
    pending = next.catch(() => undefined)
    return next
  }

  /** Confirms an AUV invocation. Read-only commands pass without a dialog. */
  function check(argv: string[]): Promise<void> {
    return requiresConfirmation(argv) ? enqueueAsk(describeInvocation(argv)) : Promise.resolve()
  }

  /** Confirms a host action that is not an AUV command, for example opening a URL. */
  function checkAction(summary: string): Promise<void> {
    return enqueueAsk(summary)
  }

  function revoke() {
    trustedUntil = 0
  }

  return { check, checkAction, revoke }
}

/**
 * Parses a URL the assistant may open. Only http and https reach the browser,
 * so `file:`, `javascript:` and custom protocol handlers cannot start local programs.
 */
export function parseOpenableUrl(input: string): URL {
  const text = input.trim()
  const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`)
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Only http and https links can be opened.')
  return url
}
