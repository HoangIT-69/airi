import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { I18n } from '../../../libs/i18n'
import type { ConfirmationAnswer } from './confirmation'

import { join, sep } from 'node:path'

import { binaryPath } from '@auv-js/cli/binary'
import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow, dialog, shell } from 'electron'

import * as v from 'valibot'

import { computerUseOpenUrl, computerUseReadImage, computerUseRun } from '../../../../shared/eventa/computer-use'
import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'
import { createConfirmationGate, parseOpenableUrl } from './confirmation'
import { createComputerUseRuntime } from './runtime'

/** How long "allow for a while" lasts. */
const TRUST_MS = 5 * 60_000

/** Asks the user in a native dialog, which the model cannot answer for them. */
async function askUser(i18n: I18n, summary: string): Promise<ConfirmationAnswer> {
  const t = (key: string) => i18n.t(`tamagotchi.electron.computer-use.confirm.${key}`)
  const options = {
    type: 'question' as const,
    title: t('title'),
    message: t('message'),
    detail: summary,
    buttons: [t('deny'), t('once'), t('session')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const owner = BrowserWindow.getFocusedWindow()
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  return response === 1 ? 'once' : response === 2 ? 'session' : 'deny'
}

/**
 * Registers host-owned computer use. The executable is resolved only on the first call.
 * Clicks, typing, app focus, and media changes wait for the user's answer in a native dialog.
 */
export function setupComputerUse(context: ReturnType<typeof createContext>['context'], i18n: I18n) {
  const gate = createConfirmationGate({ ask: summary => askUser(i18n, summary), trustMs: TRUST_MS })
  let runtime: ReturnType<typeof createComputerUseRuntime> | undefined
  let stopped = false
  function getRuntime() {
    if (stopped)
      throw new Error('Computer use has stopped.')
    if (!runtime) {
      const executable = binaryPath()
      runtime = createComputerUseRuntime({
        // Native executables cannot run inside Electron's archive.
        binaryPath: app.isPackaged ? executable.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`) : executable,
        storeRoot: join(app.getPath('userData'), 'computer-use'),
        confirm: argv => gate.check(argv),
      })
    }
    return runtime
  }
  defineInvokeHandler(context, computerUseRun, input => getRuntime().run(input))
  defineInvokeHandler(context, computerUseReadImage, input => getRuntime().readImage(input))
  defineInvokeHandler(context, computerUseOpenUrl, async (input) => {
    const url = parseOpenableUrl(v.parse(v.object({ url: v.pipe(v.string(), v.maxLength(2048)) }), input).url)
    await gate.checkAction(`open ${url.href}`)
    await shell.openExternal(url.href)
    return { url: url.href }
  })
  onAppBeforeQuit(async () => {
    stopped = true
    await runtime?.dispose()
  })
}
