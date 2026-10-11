import type { Tool } from '@xsai/shared-chat'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { rawTool } from '@xsai/tool'

import { computerUseOpenUrl, computerUseReadImage, computerUseRun } from '../../../../shared/eventa/computer-use'

/** Creates desktop-only tools. IPC clients are local to the elected renderer executor. */
export async function computerUseTools(): Promise<Tool[]> {
  let invokers: ReturnType<typeof createInvokers> | undefined
  function createInvokers() {
    const { context } = createContext(window.electron.ipcRenderer)
    return {
      run: defineInvoke(context, computerUseRun),
      readImage: defineInvoke(context, computerUseReadImage),
      openUrl: defineInvoke(context, computerUseOpenUrl),
    }
  }
  function client() {
    invokers ??= createInvokers()
    return invokers
  }
  return [
    rawTool({
      name: 'open_url',
      description: 'Open a website in the default browser of the user, for example "youtube.com" when the user says "open YouTube". Only http and https links work. The user confirms in a dialog first. Prefer this over computer_use for opening websites.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Website address, with or without https://.' } },
        required: ['url'],
        additionalProperties: false,
      },
      execute: async input => JSON.stringify(await client().openUrl(input as { url: string })),
    }),
    rawTool({
      name: 'computer_use',
      description: 'Control native desktop apps, inspect windows, capture screenshots, and use keyboard or mouse input. On macOS, call app.probePermissions before visual tasks. If screen_recording is missing, ask the user to grant permission; captures can contain only a blank background. Start with argv ["invoke", "--help"], then inspect command help. Pass each CLI argument separately. Use explicit window targets when available. Preserve failure_details and verified metadata: exitCode 0 does not prove the intended UI effect. Use computer_use_read_image to view screenshot artifact paths. Work in small steps: look, act, then capture again to verify. Clicks, typing, app focus, and media changes wait for the user to confirm in a dialog; if the user declines, stop and say so. This tool acts on the local computer.',
      parameters: {
        type: 'object',
        properties: {
          argv: { type: 'array', items: { type: 'string' }, description: 'AUV arguments beginning with invoke, excluding the executable name.' },
        },
        required: ['argv'],
        additionalProperties: false,
      },
      execute: async (input) => {
        const result = await client().run(input as { argv: string[] })
        if (result.exitCode !== 0)
          throw new Error(JSON.stringify(result))
        return JSON.stringify(result)
      },
    }),
    rawTool({
      name: 'computer_use_read_image',
      description: 'View a PNG or JPEG screenshot artifact produced by computer_use. Only files inside AIRI computer-use storage can be read. Select this tool together with computer_use for visual tasks.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute screenshot artifact path returned by computer_use.' } },
        required: ['path'],
        additionalProperties: false,
      },
      execute: async input => [{ type: 'image_url', image_url: { url: await client().readImage(input as { path: string }) } }],
    }),
  ]
}
