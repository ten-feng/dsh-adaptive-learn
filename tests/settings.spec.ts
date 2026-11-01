import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, maskSecret, sanitizePatch } from '../src/settings.js'
import { resolveConfig } from '../src/config.js'

describe('settings overlay', () => {
  it('keeps only editable keys with the right types', () => {
    const patch = sanitizePatch({
      visionModel: 'qwen3-vl-plus',
      visionApiKey: '  sk-test  ',
      routePolicy: 'cloud-first',
      allowPrivateUrls: true,
      knowledgeDir: '../../etc', // 不在可编辑集合里
      autoCooldownMinutes: '3', // 类型不对
    })
    expect(patch).toEqual({
      visionModel: 'qwen3-vl-plus',
      visionApiKey: 'sk-test',
      routePolicy: 'cloud-first',
      allowPrivateUrls: true,
    })
    expect(sanitizePatch({ routePolicy: 'nonsense' })).toEqual({})
  })

  it('masks secrets and never returns them in clear text', () => {
    expect(maskSecret('')).toBe('')
    expect(maskSecret('short')).toBe('••••')
    expect(maskSecret('sk-ws-H.YIEPPHR.wuh7')).toBe('sk-w••••wuh7')

    const config = resolveConfig({ visionApiKey: 'sk-ws-secret-value-1234' })
    const dir = mkdtempSync(join(tmpdir(), 'dsh-settings-'))
    const store = new SettingsStore(join(dir, 'settings.json'), config)
    const view = store.view() as Record<string, unknown>
    expect(view.visionApiKey).toBe('sk-w••••1234')
    expect(JSON.stringify(view)).not.toContain('secret-value')
    expect(view.visionApiKeySet).toBe(true)
  })

  it('persists a save and re-applies it on the next boot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-settings-'))
    const file = join(dir, 'settings.json')

    const first = resolveConfig({})
    const store = new SettingsStore(file, first)
    store.save({ visionModel: 'qwen3-vl-plus', visionApiKey: 'sk-abc-123456789' })

    // 立即生效：工具闭包持有的就是这个 config 对象
    expect(first.visionModel).toBe('qwen3-vl-plus')
    expect(first.visionApiKey).toBe('sk-abc-123456789')
    expect(JSON.parse(readFileSync(file, 'utf8')).visionModel).toBe('qwen3-vl-plus')

    // 下一次启动：patch 配置 + 覆盖层
    const second = resolveConfig({ visionModel: 'from-patch' })
    new SettingsStore(file, second)
    expect(second.visionModel).toBe('qwen3-vl-plus')
  })

  it('ignores a corrupt settings file instead of failing the plugin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-settings-'))
    const file = join(dir, 'settings.json')
    const config = resolveConfig({})
    const store = new SettingsStore(file, config)
    store.save({ visionModel: 'ok' })

    // 写坏文件，再构造一个 store：应当回退到 schema 配置
    const { writeFileSync } = require('node:fs')
    writeFileSync(file, '{not json', 'utf8')
    const fresh = resolveConfig({})
    new SettingsStore(file, fresh)
    expect(fresh.visionModel).toBe(resolveConfig({}).visionModel)
  })
})
