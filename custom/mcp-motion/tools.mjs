// Tool definitions of the motion server. They create .vrma files in one folder, which the
// server also serves over HTTP so AIRI can play them with <|ACT:{"motion":"<name>"}|>.

import { Buffer } from 'node:buffer'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// eslint-disable-next-line no-restricted-syntax -- Plain Node.js ESM needs the file extension.
import { BONE_NAMES, buildVRMA, EXPRESSION_PRESETS } from './vendor/vrma-builder.mjs'

const NAME_PATTERN = /^[a-z0-9][\w-]{0,63}$/
const MAX_PROMPT_CHARS = 2000
const MAX_DURATION = 15
const MAX_KEYS_PER_TRACK = 200
const GENERATE_TIMEOUT_MS = 300_000

export function isMotionName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name)
}

function requireName(name) {
  if (!isMotionName(name))
    throw new Error('Tên motion chỉ gồm a-z, 0-9, "-" hoặc "_", tối đa 64 ký tự, ví dụ "wave-hello".')
  return name
}

async function saveMotion(dir, name, bytes, overwrite) {
  const file = join(dir, `${name}.vrma`)
  try {
    await writeFile(file, bytes, { flag: overwrite ? 'w' : 'wx' })
  }
  catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(`Đã có motion "${name}". Đổi tên, hoặc gọi lại với overwrite=true.`)
    throw error
  }
  return file
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${label} phải là số.`)
  return value
}

/** Checks a motion spec from the model before it reaches the builder. */
export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object')
    throw new Error('spec phải là object.')
  const duration = finite(spec.duration, 'duration')
  if (duration <= 0 || duration > MAX_DURATION)
    throw new Error(`duration phải trong khoảng 0–${MAX_DURATION} giây.`)
  const tracks = spec.tracks ?? {}
  if (typeof tracks !== 'object')
    throw new Error('tracks phải là object.')
  for (const [bone, keys] of Object.entries(tracks)) {
    if (!BONE_NAMES.includes(bone))
      throw new Error(`Bone "${bone}" không hợp lệ. Dùng: ${BONE_NAMES.join(', ')}.`)
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS_PER_TRACK)
      throw new Error(`tracks.${bone} phải có 1–${MAX_KEYS_PER_TRACK} key.`)
    for (const key of keys) {
      finite(key?.t, `tracks.${bone}[].t`)
      if (!Array.isArray(key.r) || key.r.length !== 3)
        throw new Error(`tracks.${bone}[].r phải là [x, y, z] (độ).`)
      key.r.forEach(v => finite(v, `tracks.${bone}[].r`))
    }
  }
  for (const key of spec.hips ?? []) {
    finite(key?.t, 'hips[].t')
    if (!Array.isArray(key.p) || key.p.length !== 3)
      throw new Error('hips[].p phải là [dx, dy, dz] (mét).')
  }
  for (const name of Object.keys(spec.expressions ?? {})) {
    if (!EXPRESSION_PRESETS.includes(name))
      throw new Error(`Biểu cảm "${name}" không hợp lệ. Dùng: ${EXPRESSION_PRESETS.join(', ')}.`)
  }
  return spec
}

/**
 * Creates the motion tools.
 * @param {{ motionsDir: string, publicBaseUrl: string, textToVrmaUrl: string, textToVrmaToken?: string, defaultEngine: string }} config
 */
export function createMotionTools(config) {
  const { motionsDir, publicBaseUrl, textToVrmaUrl, textToVrmaToken, defaultEngine } = config

  function playHint(name) {
    return `Phát bằng <|ACT:{"motion":"${name}"}|>. URL: ${publicBaseUrl}/${name}.vrma`
  }

  return {
    generate_motion: {
      description: 'Sinh một chuyển động VRMA từ mô tả bằng chữ qua Text-To-VRMA (chạy riêng, mặc định http://127.0.0.1:8787). Mất từ vài giây đến vài phút. Lưu thành <name>.vrma để phát lại bằng ACT motion.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tên file, chỉ a-z 0-9 - _, ví dụ "wave-hello"' },
          prompt: { type: 'string', description: 'Mô tả chuyển động. Tiếng Anh hoặc tiếng Nhật cho kết quả tốt nhất, ví dụ "wave the right hand happily twice"' },
          duration: { type: 'number', description: 'Độ dài (giây, 1–15). Bỏ trống để tự chọn' },
          engine: { type: 'string', enum: ['claude', 'openai', 'codex', 'ardy'], description: `Engine của Text-To-VRMA. Mặc định ${defaultEngine}` },
          overwrite: { type: 'boolean', description: 'Ghi đè motion cùng tên' },
        },
        required: ['name', 'prompt'],
      },
      async run({ name, prompt, duration, engine = defaultEngine, overwrite = false }) {
        requireName(name)
        const text = String(prompt ?? '').trim()
        if (!text || text.length > MAX_PROMPT_CHARS)
          throw new Error(`prompt phải có 1–${MAX_PROMPT_CHARS} ký tự.`)
        const body = { engine, prompt: text, format: 'vrma' }
        if (duration !== undefined) {
          const seconds = finite(duration, 'duration')
          if (seconds <= 0 || seconds > MAX_DURATION)
            throw new Error(`duration phải trong khoảng 0–${MAX_DURATION} giây.`)
          body.duration = seconds
        }
        let response
        try {
          response = await fetch(`${textToVrmaUrl}/v1/motions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(textToVrmaToken ? { Authorization: `Bearer ${textToVrmaToken}` } : {}),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
          })
        }
        catch (error) {
          throw new Error(`Không gọi được Text-To-VRMA ở ${textToVrmaUrl} (${error.message}). Hãy chạy "npm run api" trong thư mục text-to-vrma.`)
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          throw new Error(`Text-To-VRMA trả lỗi HTTP ${response.status}: ${detail.slice(0, 500)}`)
        }
        const bytes = Buffer.from(await response.arrayBuffer())
        const file = await saveMotion(motionsDir, name, bytes, overwrite)
        return `Đã tạo ${file} (${bytes.length} byte). ${playHint(name)}`
      },
    },
    create_motion: {
      description: [
        'Tự soạn chuyển động hoặc pose rồi lưu thành <name>.vrma, không cần Text-To-VRMA.',
        'Góc là Euler [x, y, z] độ so với T-pose, model nhìn +Z, +X là bên trái model.',
        'Ví dụ: head [10,0,0] cúi đầu, head [0,20,0] quay sang trái; leftUpperArm [0,0,-70] và rightUpperArm [0,0,70] hạ tay;',
        'rightUpperArm [0,0,-60] giơ tay phải lên; rightLowerArm [0,0,-90] dựng cẳng tay phải.',
        'Pose tĩnh: hai key giống nhau ở t=0 và t=duration. Bone bỏ trống thì giữ chuyển động idle.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tên file, chỉ a-z 0-9 - _' },
          spec: {
            type: 'object',
            description: `{ duration: số giây, tracks: { <bone>: [{ t, r: [x,y,z] }] }, hips?: [{ t, p: [dx,dy,dz] }], expressions?: { <preset>: [{ t, w }] } }. Bone: ${BONE_NAMES.join(', ')}`,
          },
          overwrite: { type: 'boolean', description: 'Ghi đè motion cùng tên' },
        },
        required: ['name', 'spec'],
      },
      async run({ name, spec, overwrite = false }) {
        requireName(name)
        const parsed = typeof spec === 'string' ? JSON.parse(spec) : spec
        const bytes = Buffer.from(buildVRMA({ ...validateSpec(parsed), name }))
        const file = await saveMotion(motionsDir, name, bytes, overwrite)
        return `Đã tạo ${file}. ${playHint(name)}`
      },
    },
    list_motions: {
      description: 'Liệt kê các motion .vrma đã có (mới nhất trước) và các cử chỉ dựng sẵn.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const names = await readdir(motionsDir).catch(() => [])
        const motions = await Promise.all(names.filter(n => n.endsWith('.vrma')).map(async n => ({ n, mtime: (await stat(join(motionsDir, n))).mtimeMs })))
        const files = motions.sort((a, b) => b.mtime - a.mtime).map(m => m.n.slice(0, -'.vrma'.length))
        return [
          'Cử chỉ dựng sẵn (không cần file): nod, shake, wave, bow, think, cheer, tilt',
          `Motion đã tạo: ${files.length > 0 ? files.join(', ') : '(chưa có)'}`,
        ].join('\n')
      },
    },
  }
}
