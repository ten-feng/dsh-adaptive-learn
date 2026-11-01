/**
 * dsh-adaptive-learn — 设置页「自学」面板（客户端半）。
 *
 * 只做最必要的四件事：看状态、改云端视觉/音频配置、保存、重新探测。
 * 所有数据都通过 `/plugins/dsh-adaptive-learn/api` 读写，密钥永远只显示掩码。
 */
window.__ModuleLoader__.load({
  id: 'dsh-adaptive-learn',
  factory: (require) => {
    const React = require('react')
    const API = '/plugins/dsh-adaptive-learn/api'

    async function call(path, options) {
      const response = await fetch(`${API}/${path}`, {
        method: options && options.body ? 'POST' : 'GET',
        headers: options && options.body ? { 'content-type': 'application/json' } : undefined,
        body: options && options.body ? JSON.stringify(options.body) : undefined,
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (!payload.ok) throw new Error(payload.error || `HTTP ${response.status}`)
      return payload
    }

    const el = React.createElement
    const box = { padding: '4px 0' }
    const label = { display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }
    const input = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '6px 8px',
      borderRadius: 6,
      border: '1px solid rgba(128,128,128,0.35)',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
    }
    const button = {
      padding: '6px 14px',
      borderRadius: 6,
      border: '1px solid rgba(128,128,128,0.35)',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit',
    }

    function field(name, text, value, onChange, type) {
      return el(
        'div',
        { style: { marginBottom: 10 } },
        el('label', { style: label }, text),
        el('input', {
          style: input,
          type: type || 'text',
          value: value == null ? '' : value,
          placeholder: type === 'password' ? '留空表示不修改' : '',
          onChange: (event) => onChange(name, event.target.value),
        }),
      )
    }

    function SettingsSection() {
      const [data, setData] = React.useState(null)
      const [draft, setDraft] = React.useState({})
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        try {
          const payload = await call('settings')
          setData(payload)
          setDraft({})
          setStatus('')
        } catch (error) {
          setStatus(`读取失败：${error.message}`)
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const change = (name, value) => setDraft((prev) => ({ ...prev, [name]: value }))

      const save = async () => {
        const body = {}
        const numeric = ['maxFetchChars', 'maxAudioChars']
        for (const key of Object.keys(draft)) {
          const raw = draft[key]
          if (raw === '' || raw === undefined) continue
          body[key] = numeric.includes(key) ? Number(String(raw).trim()) : raw
        }
        if (Object.keys(body).length === 0) {
          setStatus('没有改动')
          return
        }
        setBusy(true)
        try {
          const payload = await call('settings', { body })
          setData((prev) => ({ ...prev, settings: payload.settings }))
          setDraft({})
          setStatus(`已保存：${payload.applied.join(', ')}`)
        } catch (error) {
          setStatus(`保存失败：${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      const probe = async () => {
        setBusy(true)
        try {
          const payload = await call('probe', { body: {} })
          setData((prev) => ({ ...prev, capability: payload.capability }))
          setStatus('已重新探测硬件')
        } catch (error) {
          setStatus(`探测失败：${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      if (!data) {
        return el('div', { style: box }, status || '读取中…')
      }

      const settings = data.settings || {}
      const capability = data.capability || {}
      const engines = data.engines || {}
      const gpu = capability.gpu || {}
      const value = (key) => (key in draft ? draft[key] : settings[key] || '')
      const yes = (flag) => (flag ? '可用' : '未就绪')

      return el(
        'div',
        { style: box },
        el(
          'div',
          { style: { marginBottom: 14, lineHeight: 1.7 } },
          el('div', null, `GPU：${gpu.available ? `${gpu.name}（空闲 ${gpu.vramFreeMB}MB / 共 ${gpu.vramTotalMB}MB）` : '未检测到'}`),
          el('div', null, `本地 OCR：${yes(capability.localOcrReady)}　本地转写：${yes(capability.localAsrReady)}`),
          el(
            'div',
            null,
            `本地引擎：PaddleOCR ${engines.paddle ? '✓' : '—'}　HunyuanOCR ${engines.hunyuan ? '✓' : '—'}　faster-whisper ${engines.whisper ? '✓' : '—'}`,
          ),
          el('div', { style: { fontSize: 12, opacity: 0.6 } }, `配置文件：${settings.source || ''}`),
        ),
        field('visionBaseUrl', '视觉 Base URL', value('visionBaseUrl'), change),
        field('visionModel', '视觉模型', value('visionModel'), change),
        field(
          'visionApiKey',
          `视觉 API Key${settings.visionApiKeySet ? `（当前 ${settings.visionApiKey}）` : '（未设置）'}`,
          value('visionApiKey'),
          change,
          'password',
        ),
        field('audioBaseUrl', '音频 Base URL', value('audioBaseUrl'), change),
        field('audioModel', '音频模型', value('audioModel'), change),
        field(
          'audioApiKey',
          `音频 API Key${settings.audioApiKeySet ? `（当前 ${settings.audioApiKey}）` : '（未设置）'}`,
          value('audioApiKey'),
          change,
          'password',
        ),
        field('maxFetchChars', '网页正文上限（字）', value('maxFetchChars'), change, 'number'),
        field('maxAudioChars', '转写文本上限（字）', value('maxAudioChars'), change, 'number'),
        el(
          'div',
          { style: { display: 'flex', gap: 8, marginTop: 12 } },
          el('button', { style: button, disabled: busy, onClick: save }, busy ? '处理中…' : '保存'),
          el('button', { style: button, disabled: busy, onClick: probe }, '重新探测'),
          el('button', { style: button, disabled: busy, onClick: load }, '刷新'),
        ),
        status ? el('div', { style: { marginTop: 10, fontSize: 12, opacity: 0.8 } }, status) : null,
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'adaptive-learn',
            order: 15,
            label: () => '自学',
          },
          SettingsSection,
        ),
      )
    }

    return { name: 'dsh-adaptive-learn', inject, apply }
  },
})
