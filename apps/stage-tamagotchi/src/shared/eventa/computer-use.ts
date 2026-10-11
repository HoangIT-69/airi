import { defineInvokeEventa } from '@moeru/eventa'

/** AUV invocation result. A zero exit code does not verify the requested UI effect. */
export interface ComputerUseResult {
  argv: string[]
  exitCode: number
  output: unknown
  stderr: string
}

export const computerUseRun = defineInvokeEventa<ComputerUseResult, { argv: string[] }>('eventa:invoke:computer-use:run')
export const computerUseReadImage = defineInvokeEventa<string, { path: string }>('eventa:invoke:computer-use:read-image')
/** Opens an http(s) URL in the default browser after the user confirms. */
export const computerUseOpenUrl = defineInvokeEventa<{ url: string }, { url: string }>('eventa:invoke:computer-use:open-url')
