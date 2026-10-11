import { describe, expect, it, vi } from 'vitest'

import { createConfirmationGate, describeInvocation, parseOpenableUrl, requiresConfirmation } from './confirmation'

describe('requiresConfirmation', () => {
  it('lets read-only commands, help, and dry runs through', () => {
    expect(requiresConfirmation(['invoke', 'display.capture'])).toBe(false)
    expect(requiresConfirmation(['invoke', 'window.findText', '--text', 'YouTube'])).toBe(false)
    expect(requiresConfirmation(['invoke', '--help'])).toBe(false)
    expect(requiresConfirmation(['invoke', 'input.clickPoint', '--help'])).toBe(false)
    expect(requiresConfirmation(['invoke', 'input.typeText', '--text', 'x', '--dry-run'])).toBe(false)
  })

  it('asks before input, clicks, app focus, and media changes', () => {
    expect(requiresConfirmation(['invoke', 'input.typeText', '--text', 'youtube.com'])).toBe(true)
    expect(requiresConfirmation(['invoke', 'screen.clickText', '--text', 'OK'])).toBe(true)
    expect(requiresConfirmation(['invoke', 'app.activate'])).toBe(true)
    expect(requiresConfirmation(['invoke', 'mediaControl.pause'])).toBe(true)
  })
})

describe('describeInvocation', () => {
  it('drops the invoke verb and cuts long arguments', () => {
    expect(describeInvocation(['invoke', 'input.typeText', '--text', 'a'.repeat(200)])).toBe(`input.typeText --text ${'a'.repeat(120)}…`)
  })
})

describe('createConfirmationGate', () => {
  it('throws when the user declines', async () => {
    const gate = createConfirmationGate({ ask: async () => 'deny', trustMs: 1000 })
    await expect(gate.check(['invoke', 'input.key', '--key', 'Enter'])).rejects.toThrow('declined')
  })

  it('asks every time after an answer for one action', async () => {
    const ask = vi.fn(async () => 'once' as const)
    const gate = createConfirmationGate({ ask, trustMs: 1000 })
    await gate.check(['invoke', 'input.key', '--key', 'Enter'])
    await gate.check(['invoke', 'input.key', '--key', 'Enter'])
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('stops asking for a while after "allow for a while", then asks again', async () => {
    let time = 0
    const ask = vi.fn(async () => 'session' as const)
    const gate = createConfirmationGate({ ask, trustMs: 1000, now: () => time })
    await gate.check(['invoke', 'input.key', '--key', 'Enter'])
    time = 999
    await gate.check(['invoke', 'input.typeText', '--text', 'hi'])
    expect(ask).toHaveBeenCalledTimes(1)
    time = 1001
    await gate.check(['invoke', 'input.typeText', '--text', 'hi'])
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('shows one dialog at a time and lets the waiting call reuse the trust', async () => {
    const ask = vi.fn(async () => 'session' as const)
    const gate = createConfirmationGate({ ask, trustMs: 60_000 })
    await Promise.all([
      gate.check(['invoke', 'input.key', '--key', 'a']),
      gate.check(['invoke', 'input.key', '--key', 'b']),
    ])
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('never asks for read-only commands', async () => {
    const ask = vi.fn(async () => 'deny' as const)
    const gate = createConfirmationGate({ ask, trustMs: 1000 })
    await gate.check(['invoke', 'display.capture'])
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('parseOpenableUrl', () => {
  it('adds https to a bare domain', () => {
    expect(parseOpenableUrl('youtube.com').href).toBe('https://youtube.com/')
    expect(parseOpenableUrl(' http://example.com/a ').href).toBe('http://example.com/a')
  })

  it('refuses protocols that can start local programs', () => {
    expect(() => parseOpenableUrl('file:///C:/Windows/System32/calc.exe')).toThrow('http')
    expect(() => parseOpenableUrl('javascript:alert(1)')).toThrow('http')
    expect(() => parseOpenableUrl('ms-settings:privacy')).toThrow('http')
  })
})

describe('checkAction', () => {
  it('always asks for host actions', async () => {
    const ask = vi.fn(async () => 'once' as const)
    const gate = createConfirmationGate({ ask, trustMs: 1000 })
    await gate.checkAction('open https://youtube.com/')
    expect(ask).toHaveBeenCalledWith('open https://youtube.com/')
  })
})
