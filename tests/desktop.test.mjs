import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const pluginPath = new URL('../desktop/plugin.js', import.meta.url)
const source = fs.readFileSync(pluginPath, 'utf8')
  .replace(/^import .*$/gm, '')
  .replace('export default {', 'const pluginDefault = {')

function atom(initial) {
  let value = initial
  const listeners = new Set()
  return {
    get: () => value,
    set(next) {
      value = next
      listeners.forEach(listener => listener(value))
    },
    listen(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

let usageQuery = { data: null, isLoading: false, error: null }

const context = vm.createContext({
  console,
  Intl,
  Date,
  Math,
  Number,
  Object,
  Set,
  Map,
  String,
  RegExp,
  Promise,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  atom,
  COMPOSER_AREAS: {
    top: 'composer.top',
    underside: 'composer.underside'
  },
  PALETTE_AREA: 'palette',
  host: { state: { model: null, activeSessionId: null }, onEvent: () => () => {} },
  useEffect() {},
  useState: initial => [initial, () => {}],
  useValue: value => value && typeof value.get === 'function' ? value.get() : value,
  useQuery: () => usageQuery,
  Button: 'Button',
  GlyphSpinner: 'GlyphSpinner',
  SegmentedControl: 'SegmentedControl',
  Select: 'Select',
  SelectContent: 'SelectContent',
  SelectItem: 'SelectItem',
  SelectTrigger: 'SelectTrigger',
  SelectValue: 'SelectValue',
  Switch: 'Switch',
  Tip: 'Tip',
  haptic() {},
  jsx: (type, props, key) => ({ type, props, key }),
  jsxs: (type, props, key) => ({ type, props, key })
})

vm.runInContext(`${source}\n;globalThis.__statusBadgesTest = {
  DEFAULT_SETTINGS: typeof DEFAULT_SETTINGS === 'undefined' ? null : DEFAULT_SETTINGS,
  normalizeSettings: typeof normalizeSettings === 'undefined' ? null : normalizeSettings,
  isProviderEnabled: typeof isProviderEnabled === 'undefined' ? null : isProviderEnabled,
  visibleBadgeProviders: typeof visibleBadgeProviders === 'undefined' ? null : visibleBadgeProviders,
  buildStatusBadgeItems: typeof buildStatusBadgeItems === 'undefined' ? null : buildStatusBadgeItems,
  ProviderSettings: typeof ProviderSettings === 'undefined' ? null : ProviderSettings,
  orderedBadgeProviders: typeof orderedBadgeProviders === 'undefined' ? null : orderedBadgeProviders,
  badgeFillStyle: typeof badgeFillStyle === 'undefined' ? null : badgeFillStyle,
  displayStyleFlags: typeof displayStyleFlags === 'undefined' ? null : displayStyleFlags,
  alignmentClass: typeof alignmentClass === 'undefined' ? null : alignmentClass,
  slotIsActive: typeof slotIsActive === 'undefined' ? null : slotIsActive,
  ProviderMark: typeof ProviderMark === 'undefined' ? null : ProviderMark,
  FloatingUsageBadges: typeof FloatingUsageBadges === 'undefined' ? null : FloatingUsageBadges,
  pluginDefault
}`, context)

const api = context.__statusBadgesTest

test('settings normalize to the preserved current presentation defaults', () => {
  assert.equal(typeof api.normalizeSettings, 'function')
  assert.deepEqual(
    structuredClone(api.normalizeSettings(null)),
    {
      providerVisibility: {},
      drainFrom: 'right',
      position: 'bottom',
      alignment: 'center',
      displayStyle: 'both'
    }
  )
})

test('settings reject invalid options and preserve boolean provider overrides', () => {
  const settings = api.normalizeSettings({
    providerVisibility: { nous: false, openrouter: true, broken: 'no' },
    drainFrom: 'diagonal',
    position: 'floating',
    alignment: 'wide',
    displayStyle: 'value-only'
  })
  assert.deepEqual(structuredClone(settings), {
    providerVisibility: { nous: false, openrouter: true },
    drainFrom: 'right',
    position: 'bottom',
    alignment: 'center',
    displayStyle: 'both'
  })
})

test('display style controls icon and text independently', () => {
  assert.deepEqual(structuredClone(api.displayStyleFlags('both')), { icon: true, text: true })
  assert.deepEqual(structuredClone(api.displayStyleFlags('icon')), { icon: true, text: false })
  assert.deepEqual(structuredClone(api.displayStyleFlags('text')), { icon: false, text: true })
  assert.deepEqual(structuredClone(api.displayStyleFlags('invalid')), { icon: true, text: true })
})

test('DeepSeek whale mark follows Both, Icon, and Text display styles', () => {
  usageQuery = {
    data: {
      connected_providers: ['deepseek'],
      accounts: { deepseek: { meter: { mode: 'balance', balance_usd: 5.47, tone: 'ok' } } }
    },
    isLoading: false,
    error: null
  }
  const render = displayStyle => api.FloatingUsageBadges({
    ctx: {},
    $settings: atom(api.normalizeSettings({ displayStyle }))
  })
  const collect = (node, predicate, found = []) => {
    if (Array.isArray(node)) {
      node.forEach(child => collect(child, predicate, found))
    } else if (node != null && typeof node !== 'object') {
      if (predicate(node)) found.push(node)
    } else if (node && typeof node === 'object') {
      if (node.type === api.ProviderMark) {
        collect(api.ProviderMark(node.props), predicate, found)
      } else {
        if (predicate(node)) found.push(node)
        collect(node.props?.children, predicate, found)
      }
    }
    return found
  }
  const visibleText = tree => collect(tree, node => typeof node === 'string')
    .map(node => node).join(' ')
  const whaleMarks = tree => collect(tree, node => node.type === 'span' && node.props?.children === '🐋')

  for (const style of ['both', 'icon']) {
    const tree = render(style)
    assert.equal(whaleMarks(tree).length, 1, `${style} should render the DeepSeek whale mark`)
    assert.equal(visibleText(tree).includes('DeepSeek: $5.47'), style === 'both')
  }
  const textTree = render('text')
  assert.equal(whaleMarks(textTree).length, 0)
  assert.ok(visibleText(textTree).includes('DeepSeek: $5.47'))
})

test('provider visibility defaults on and can hide one eligible badge', () => {
  const settings = api.normalizeSettings({ providerVisibility: { openrouter: false } })
  assert.equal(api.isProviderEnabled(settings, 'nous'), true)
  assert.equal(api.isProviderEnabled(settings, 'openrouter'), false)
  assert.deepEqual(
    Array.from(api.visibleBadgeProviders(['nous', 'openai-codex', 'openrouter'], settings)),
    ['nous', 'openai-codex']
  )
})

test('usage accounts normalize into provider-agnostic status items', () => {
  assert.equal(typeof api.buildStatusBadgeItems, 'function')
  const data = {
    connected_providers: ['nous', 'openrouter'],
    accounts: {
      nous: {
        meter: {
          mode: 'credits',
          remaining_usd: 12.5,
          allowance_usd: 22,
          fill_percent: 57,
          tone: 'ok'
        }
      },
      openrouter: {
        meter: {
          mode: 'credits',
          remaining_usd: 4,
          allowance_usd: 10,
          fill_percent: 40,
          tone: 'low'
        }
      }
    }
  }
  const items = api.buildStatusBadgeItems(
    data,
    api.normalizeSettings({ providerVisibility: { openrouter: false } })
  )
  assert.equal(items.length, 1)
  assert.deepEqual(structuredClone(items[0]), {
    id: 'nous',
    provider: 'nous',
    type: 'usage',
    label: 'Nous',
    value: '$12.50',
    fillPercent: 57,
    tone: 'ok',
    tooltip: 'Nous · $12.50 of $22 left'
  })
})

test('drain direction anchors remaining fill on the opposite edge', () => {
  const current = api.badgeFillStyle(60, 'ok', 'right')
  assert.equal(current.left, 0)
  assert.equal(current.right, undefined)

  const reversed = api.badgeFillStyle(60, 'ok', 'left')
  assert.equal(reversed.right, 0)
  assert.equal(reversed.left, undefined)
})

test('alignment maps to stable strip layout classes', () => {
  assert.match(api.alignmentClass('left'), /justify-start/)
  assert.match(api.alignmentClass('center'), /justify-center/)
  assert.match(api.alignmentClass('right'), /justify-end/)
})

test('only the configured composer slot is active', () => {
  assert.equal(api.slotIsActive('top', { position: 'top' }), true)
  assert.equal(api.slotIsActive('bottom', { position: 'top' }), false)
  assert.equal(api.slotIsActive('top', { position: 'bottom' }), false)
  assert.equal(api.slotIsActive('bottom', { position: 'bottom' }), true)
})

test('plugin is presented as Status Badges with top and bottom badge slots', () => {
  const contributions = []
  const disposers = []
  const storage = new Map()
  api.pluginDefault.register({
    storage: {
      get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback,
      set: (key, value) => storage.set(key, value),
      remove: key => storage.delete(key)
    },
    onDispose: dispose => disposers.push(dispose),
    registerMany: rows => contributions.push(...rows)
  })

  assert.equal(api.pluginDefault.name, 'Status Badges')
  const pane = contributions.find(row => row.area === 'panes')
  assert.equal(pane.title, 'status badges')
  assert.ok(contributions.some(row => row.area === 'composer.top'))
  assert.ok(contributions.some(row => row.area === 'composer.underside'))
})

test('only valid backend meters drive badge faces and fills, including zero values', () => {
  const data = {
    connected_providers: ['nous', 'openrouter', 'opencode-go', 'deepseek', 'legacy-window', 'malformed'],
    accounts: {
      nous: { meter: { mode: 'credits', remaining_usd: 0, allowance_usd: 22, fill_percent: 0, tone: 'ok' }, windows: [{ used_percent: 99 }] },
      openrouter: { meter: { mode: 'credits', remaining_usd: 0, allowance_usd: 130, fill_percent: 0, tone: 'ok' }, windows: [{ used_percent: 99 }] },
      'opencode-go': { meter: { mode: 'usage', used_percent: 0, remaining_percent: 100, fill_percent: 100, tone: 'ok' } },
      deepseek: { meter: { mode: 'balance', balance_usd: 5.47, tone: 'ok' } },
      'legacy-window': { windows: [{ used_percent: 12 }] },
      malformed: { meter: { mode: 'usage', used_percent: '12' }, windows: [{ used_percent: 12 }] }
    }
  }

  const items = api.buildStatusBadgeItems(data, api.normalizeSettings(null))
  assert.deepEqual(Array.from(items, item => item.provider), ['nous', 'openrouter', 'opencode-go', 'deepseek'])
  assert.deepEqual(Array.from(items, item => item.value), ['$0', '$0', '0%', '$5.47'])
  assert.deepEqual(Array.from(items, item => item.fillPercent), [0, 0, 100, null])
  const hiddenDeepSeek = api.buildStatusBadgeItems(
    data,
    api.normalizeSettings({ providerVisibility: { deepseek: false } })
  )
  assert.ok(!Array.from(hiddenDeepSeek, item => item.provider).includes('deepseek'))
})

test('settings retain connected providers without meters and show their safe reason', () => {
  const data = {
    connected_providers: ['nous', 'openrouter', 'deepseek'],
    accounts: {
      nous: { unavailable_reason: 'Bearer placeholder-test-value', windows: [] },
      openrouter: { unavailable_reason: 'The OpenRouter credits API was unavailable.', windows: [{ used_percent: 50 }] },
      deepseek: { unavailable_reason: 'No DeepSeek API key is available.', windows: [] }
    }
  }
  const tree = api.ProviderSettings({
    $settings: atom(api.normalizeSettings(null)),
    settings: api.normalizeSettings(null),
    query: { data, isLoading: false, error: null }
  })
  const textContent = node => {
    if (node == null || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textContent).join(' ')
    return textContent(node.props?.children)
  }
  const text = textContent(tree)

  for (const expected of [
    'Nous Portal', 'OpenRouter', 'DeepSeek',
    'Usage meter unavailable.',
    'The OpenRouter credits API was unavailable.',
    'No DeepSeek API key is available.'
  ]) assert.ok(text.includes(expected), `settings should include ${expected}`)
  assert.ok(!text.includes('placeholder-test-value'))
  assert.deepEqual(
    Array.from(api.orderedBadgeProviders(data.connected_providers, data.accounts)),
    []
  )
})
