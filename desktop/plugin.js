import { Button, COMPOSER_AREAS, GlyphSpinner, PALETTE_AREA, SegmentedControl, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Tip, atom, haptic, host, useQuery, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-usage-pills'
// Ids this plugin shipped under before; their saved settings are adopted once.
const LEGACY_IDS = ['provider-usage']
const SETTINGS_KEY = 'settings.v1'
// One backend read is shared by the active strip and the configuration pane.
const USAGE_QUERY_KEY = [ID, 'usage']
const pctNum = value => value == null || Number.isNaN(Number(value)) ? null : Math.round(Number(value))

const DEFAULT_SETTINGS = Object.freeze({
  providerVisibility: {},
  drainFrom: 'right',
  position: 'bottom',
  alignment: 'center',
  displayStyle: 'both'
})

/** Provider metadata is presentation-only; usage behavior lives in BADGE_TYPES. */
const PROVIDER_DEFINITIONS = Object.freeze([
  { id: 'nous', label: 'Nous Portal', shortName: 'Nous', badgeType: 'usage' },
  { id: 'openai-codex', label: 'OpenAI Codex', shortName: 'Codex', badgeType: 'usage', model: 'gpt-5.6-sol' },
  { id: 'xai-oauth', label: 'xAI', shortName: '𝕏', badgeType: 'usage', model: 'grok-4.5' },
  { id: 'openrouter', label: 'OpenRouter', shortName: 'OR', badgeType: 'usage', model: 'anthropic/claude-sonnet-4.5' },
  { id: 'opencode-go', label: 'OpenCode Go', shortName: 'Go', badgeType: 'usage', model: 'glm-5.3' },
  { id: 'deepseek', label: 'DeepSeek', shortName: 'DeepSeek', badgeType: 'usage' }
])
const PROVIDER_BY_ID = Object.freeze(Object.fromEntries(PROVIDER_DEFINITIONS.map(item => [item.id, item])))
const BADGE_PROVIDER_ORDER = PROVIDER_DEFINITIONS.map(item => item.id)

function providerDefinition(provider) {
  const id = String(provider || 'unknown')
  if (PROVIDER_BY_ID[id]) return PROVIDER_BY_ID[id]
  const token = id.split('-')[0] || id
  const label = token.charAt(0).toUpperCase() + token.slice(1)
  return { id, label, shortName: label, badgeType: 'usage' }
}

function shortName(provider) {
  return providerDefinition(provider).shortName
}

function normalizeSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const sourceVisibility = value.providerVisibility && typeof value.providerVisibility === 'object'
    ? value.providerVisibility
    : {}
  const providerVisibility = Object.fromEntries(
    Object.entries(sourceVisibility).filter(([, enabled]) => typeof enabled === 'boolean')
  )
  return {
    providerVisibility,
    drainFrom: value.drainFrom === 'left' ? 'left' : DEFAULT_SETTINGS.drainFrom,
    position: value.position === 'top' ? 'top' : DEFAULT_SETTINGS.position,
    alignment: ['left', 'center', 'right'].includes(value.alignment) ? value.alignment : DEFAULT_SETTINGS.alignment,
    displayStyle: ['both', 'icon', 'text'].includes(value.displayStyle) ? value.displayStyle : DEFAULT_SETTINGS.displayStyle
  }
}

function updateSettings($settings, patch) {
  $settings.set(normalizeSettings({ ...$settings.get(), ...patch }))
}

function isProviderEnabled(settings, provider) {
  return settings?.providerVisibility?.[provider] !== false
}

function setProviderEnabled($settings, provider, enabled) {
  const current = normalizeSettings($settings.get())
  updateSettings($settings, {
    providerVisibility: { ...current.providerVisibility, [provider]: Boolean(enabled) }
  })
}

function visibleBadgeProviders(providers, settings) {
  return providers.filter(provider => isProviderEnabled(settings, provider))
}

function alignmentClass(alignment) {
  if (alignment === 'left') return 'justify-start'
  if (alignment === 'right') return 'justify-end'
  return 'justify-center'
}

function displayStyleFlags(displayStyle) {
  if (displayStyle === 'icon') return { icon: true, text: false }
  if (displayStyle === 'text') return { icon: false, text: true }
  return { icon: true, text: true }
}

function slotIsActive(slot, settings) {
  return settings?.position === slot
}

// Provider marks vendored from @lobehub/icons-static-svg@1.94.0 (MIT).
// Pinned local paths keep the widget deterministic, private, and available offline.
const PROVIDER_MARK_PATHS = Object.freeze({
  "nous": [{"d":"M5.938 12.835c.127-.039.285.02.373.143.028.038.036.092.046.14.003.014-.02.033-.04.05-.124-.098-.24-.194-.354-.291-.011-.01-.016-.027-.025-.042zM8.396 9.412c.195-.032.39-.06.588-.05a.54.54 0 01.148.026c.202.071.402.147.601.224.028.01.05.036.075.055l-.013.027a9.203 9.203 0 01-.26-.089c-.115-.038-.213-.077-.315-.098-.25-.05-.25-.046-.292-.014l.574.144c.275.139.55.276.823.417.042.022.09.057.107.098.026.06.063.076.117.072.066-.006.132-.017.213-.027l-.04.086c.051.08.142.02.216.064-.074.13-.247.09-.334.199l.061.074-.12.087c0 .106-.038.168-.306.243l.026.085-.196.042.07.124h-.25l-.007.137c-.081-.01-.161-.018-.244-.027l-.053.123c-.027-.008-.052-.011-.073-.023-.067-.038-.128-.056-.195.006-.019.017-.063.014-.093.008-.026-.006-.05-.029-.07-.042-.11.095-.11.095-.208.003-.057.046-.12.074-.186.011-.063.027-.123-.02-.178-.014-.07.007-.097-.035-.133-.07l-.13.033c-.013-.236-.194-.19-.34-.203.005-.072.05-.092.095-.094a.474.474 0 01.159.022c.164.05.32.12.496.138.203.021.405.029.601-.015.265-.059.52-.149.707-.365.049-.056.083-.127.117-.195.019-.038.02-.084-.02-.116a1.397 1.397 0 00-.382-.217c.024.12-.031.182-.115.221 0 .014-.004.025 0 .03.08.115.084.16-.007.267a1.39 1.39 0 01-.218.211.477.477 0 01-.641-.05 1.36 1.36 0 01-.133-.152c-.078-.107-.076-.108-.033-.236-.165-.08-.128-.226-.104-.364.008-.05.028-.096.049-.163-.04.014-.067.017-.087.032a.897.897 0 00-.316.357c-.007.016-.01.034-.02.047-.012.015-.034.038-.045.035-.02-.006-.037-.027-.05-.045-.008-.012-.007-.032-.012-.057h-.126l.053-.172a14.82 14.82 0 00-.039-.049l.11-.284c-.06.026-.091.044-.124.051-.03.007-.064 0-.095 0 0-.031-.01-.07.004-.092.149-.22.305-.428.593-.476z"},{"d":"M8.06 10.788c-.003-.038-.004-.075.037-.062.016.006.034.048.028.067-.01.04-.038.032-.064-.005z"},{"d":"M11.981.009c.226-.012.453-.011.679 0 .247.01.495.024.74.062.401.064.798.157 1.19.273.463.138.92.299 1.356.511a7.31 7.31 0 012.948 2.642c.292.469.536.963.739 1.479.219.556.446 1.11.623 1.683.204.654.329 1.326.458 1.997.097.504.182 1.01.29 1.511.156.722.329 1.44.494 2.16.186.812.4 1.615.63 2.415.102.355.193.713.282 1.072.11.436.202.876.254 1.323.031.278.066.557.073.837a7.56 7.56 0 01-.017.88c-.037.413-.1.818-.226 1.212a5.017 5.017 0 01-.915 1.649l-.13.156.018.023c.043-.023.088-.041.127-.068.2-.138.373-.307.531-.49.4-.46.721-.973.975-1.529a3.59 3.59 0 00.325-1.72c-.024-.424-.097-.834-.3-1.213-.013-.027-.015-.06-.03-.121.05.035.082.048.101.072.107.13.22.258.315.398.33.494.46 1.052.486 1.64a3.75 3.75 0 01-.47 1.97c-.36.655-.887 1.14-1.526 1.506-.193.111-.394.21-.595.308-.157.078-.248.211-.318.365a.522.522 0 00-.033.406.359.359 0 01.013.139c-.005.077-.077.155-.14.162-.054.006-.125-.043-.15-.116a1.206 1.206 0 01-.06-.233c-.04-.314-.155-.6-.308-.87a3.906 3.906 0 00-.73-.91 2.129 2.129 0 00-.897-.524 4.093 4.093 0 00-.692-.131c-.075-.008-.15-.04-.22.01.18.06.363.11.538.18.434.173.82.43 1.18.728.308.255.58.543.794.884.098.155.186.315.227.496.027.123.042.25.067.375.013.062-.002.109-.053.144-.047.033-.122.034-.163-.01a.455.455 0 01-.08-.14c-.03-.073-.038-.159-.078-.225a7.314 7.314 0 00-1.423-1.664c-.16-.137-.329-.26-.537-.323-.376-.114-.753-.203-1.15-.154-.213.025-.427.032-.64.053a1.6 1.6 0 00-.736.278 5.14 5.14 0 00-.834.72c-.329.342-.642.699-.955 1.055-.136.155-.264.319-.314.531a5.227 5.227 0 00-.012.051.096.096 0 01-.09.076h-.31c-.046 0-.082-.048-.072-.094.023-.108.045-.216.07-.324.075-.325.19-.635.368-.917.024-.039.04-.088.104-.08l.01.049.027.077c.28-.435.571-.834.996-1.135.283-.204.584-.378.89-.55a.196.196 0 00-.098-.002c-.162.043-.325.084-.485.134-.402.124-.764.33-1.11.566-.147.1-.298.193-.414.333a7.314 7.314 0 00-1.07 1.767.845.845 0 00-.04.12.075.075 0 01-.072.056h-.494c-.04 0-.062-.051-.036-.082.123-.14.246-.282.377-.415.275-.281.58-.532.777-.884.027-.048.063-.09.095-.135.238-.333.54-.607.818-.902.082-.086.175-.16.26-.24.029-.027.053-.057.079-.085l-.018-.025-.135.041c-.034.017-.07.031-.102.05-.248.144-.494.292-.743.433-.408.23-.825.439-1.209.711-.281.2-.591.358-.889.533-.02.012-.044.015-.08.028-.015-.135.143-.201.108-.336-.033.014-.064.02-.085.038-.111.096-.227.19-.328.296-.148.157-.284.325-.425.488-.125.143-.25.286-.373.431A.153.153 0 019.89 24H8.762a.316.316 0 00.016-.042c.028-.09.085-.172.083-.28-.091-.018-.162.001-.212.077a4.45 4.45 0 00-.136.215c-.01.016-.024.03-.042.03h-.093c-.019 0-.029-.022-.017-.037.071-.088.14-.178.209-.268.001-.002-.006-.012-.012-.024-.014.004-.03.006-.045.013-.176.09-.352.181-.527.274a.363.363 0 01-.168.042H5.202c-.026 0-.039-.036-.019-.053.21-.178.402-.374.558-.605.335-.496.538-1.047.667-1.629.004-.02-.003-.043-.006-.091-.037.048-.059.072-.076.1a1.943 1.943 0 01-.334.415c-.28.258-.59.448-.983.464-.297.012-.588 0-.865-.127-.46-.21-.722-.57-.794-1.072-.025-.17-.017-.171-.182-.219A3.513 3.513 0 011.97 20.6a2.286 2.286 0 01-.808-1.13 3.569 3.569 0 01-.16-1.245c.002-.034.016-.067.024-.1.032.023.046.043.05.066.033.153.059.308.096.46.086.355.257.664.516.92.258.256.571.419.91.532.358.118.717.138 1.07-.016a1.89 1.89 0 00.621-.452c.328-.348.533-.76.648-1.223.009-.034.005-.071.007-.11-.015.006-.026.006-.03.011-.031.05-.064.1-.093.152-.284.502-.679.887-1.196 1.135-.351.17-.718.255-1.11.159a1.607 1.607 0 01-.971-.64 2.006 2.006 0 01-.368-.924 2.903 2.903 0 01.02-.886c.05-.439.466-1.17.742-1.271-.02.063-.035.112-.053.16-.043.116-.097.227-.13.345a1.901 1.901 0 00-.05.82c.033.212.09.416.204.6.147.236.346.407.62.465.11.023.225.014.338.018a.576.576 0 00.386-.131c.164-.128.282-.292.366-.481.168-.375.24-.777.309-1.179.05-.296.093-.594.133-.893.039-.281.071-.563.104-.845.026-.232.048-.464.074-.696.024-.228.052-.455.076-.683.024-.227.047-.455.069-.683.013-.14.022-.28.034-.42l.037-.417c.022-.25.041-.5.065-.748.008-.082-.02-.132-.09-.177a2.46 2.46 0 01-.492-.418c-.1-.109-.188-.228-.282-.342-.035-.042-.056-.097-.116-.118a2.084 2.084 0 00.275.597c.06.092.131.176.196.265.063.086.182.115.234.226-.028.003-.046.01-.06.006a4.74 4.74 0 01-.22-.057 2.71 2.71 0 01-1.287-.819c-.435-.487-.656-1.076-.71-1.723a5.206 5.206 0 01.014-1.06c.072-.602.22-1.186.45-1.745.155-.376.338-.741.526-1.102.205-.393.466-.75.765-1.076.512-.559 1.104-1.024 1.726-1.448.717-.49 1.478-.898 2.277-1.233C8.244.828 8.767.632 9.31.494c.655-.166 1.31-.33 1.982-.415.229-.03.458-.058.688-.07zm-1.847 22.82c-.07.06-.147.111-.207.18-.238.27-.464.549-.668.869l-.044.108a.177.177 0 00.093-.057c.174-.19.351-.378.519-.574.104-.122.195-.255.288-.386.024-.034.03-.08.046-.12l-.027-.02zm1.65-3.695a5.51 5.51 0 00-.653.593l-.37.386a.963.963 0 01-.377.25 1.372 1.372 0 01-.467.09c-.044 0-.087.006-.151.012.028.058.043.097.064.131.15.242.301.482.45.724.136.22.276.438.399.666.068.125.105.267.156.404.077.027.14-.018.202-.048.29-.135.579-.274.867-.412.213-.101.437-.186.636-.31.347-.215.68-.455 1.018-.685.015-.01.026-.028.042-.046-.023-.019-.038-.037-.056-.044-.287-.111-.527-.3-.77-.482a5.319 5.319 0 01-.506-.42 1.757 1.757 0 01-.41-.653c-.019-.049-.045-.095-.075-.156zm-5.847.264c-.06.096-.097.194-.132.293a3.38 3.38 0 01-.555 1.01c-.2.25-.455.412-.762.493-.23.06-.464.076-.7.07-.048-.002-.097.002-.158.005.016.04.021.066.035.085.1.145.23.246.4.295.157.046.316.034.498.023.181-.037.343-.115.485-.234.238-.199.402-.454.536-.732.175-.363.264-.751.342-1.144.01-.053.008-.11.011-.164zm14.945-4.586c.008.029.016.057.027.107.024.155.051.31.072.464.03.219.067.437.078.657.017.344.027.689-.014 1.033-.037.315-.063.633-.116.946a6.153 6.153 0 01-.46 1.518c-.008.018-.01.039-.02.082.047-.03.077-.042.098-.064.085-.083.17-.167.248-.255.271-.305.458-.66.596-1.043.18-.498.228-1.011.145-1.531-.103-.65-.33-1.263-.597-1.881a9.055 9.055 0 00-.024-.055l-.033.022zM5.797 8.29a.26.26 0 00.018.153c.124.251.25.501.379.75.025.049.066.09.03.163-.284.06-.578.119-.88.255.059.038.097.06.132.087.042.032.112.058.09.12-.01.033-.075.048-.117.072.017.01.043.021.067.036.166.102.33.207.447.368.138.192.229.404.188.644-.079.469-.306.85-.69 1.132-.054.04-.106.083-.161.122a.243.243 0 00-.103.245.77.77 0 00.055.195c.083.196.22.35.375.492.083.076.159.164.222.257a.37.37 0 01.025.377c-.023.05-.05.099-.076.148-.03.06-.028.111.022.162.041.042.08.089.112.138.038.058.078.079.147.05a.486.486 0 01.333-.006c.16.046.302.126.444.21.13.077.264.149.4.219.067.035.14.05.219.026.071-.022.124.01.145.076.02.064-.003.108-.074.139-.07.03-.137.063-.209.088-.1.035-.201.073-.314.077-.013-.107.11-.088.127-.159-.206-.126-.643-.145-.801-.034.063.112.035.21-.096.313-.13-.1-.025-.202.002-.3a.209.209 0 00-.249.17c-.015.101.067.216.178.224.108.007.218-.005.326-.012.06-.005.12-.027.199 0-.103.123-.248.127-.357.19.002.05.07.086.019.131-.053.048-.095-.001-.132-.03-.08-.063-.16-.126-.231-.197a.474.474 0 01-.157-.311.52.52 0 00-.043-.172c-.032-.074-.032-.137.033-.19-.018-.03-.028-.053-.045-.072a1.222 1.222 0 01-.196-.369c-.053-.137-.046-.264.048-.381.024-.03.05-.06.064-.095a.664.664 0 00.047-.168c.017-.165-.064-.287-.182-.387-.186-.156-.36-.322-.46-.551-.005-.011-.024-.017-.037-.026-.011.017-.024.027-.025.038-.019.185-.045.37-.052.557-.014.377.058.743.162 1.104.118.41.289.798.488 1.173.267.502.537 1.002.812 1.5.055.098.13.189.208.27.198.202.452.272.724.273.202 0 .404-.006.605-.026.295-.03.59-.073.884-.113.183-.025.365-.057.548-.08.21-.026.38.073.522.21.16.156.305.327.447.5.22.265.397.56.554.867.05.098.07.1.147.03.13-.121.26-.242.394-.36.067-.059.088-.12.067-.213a3.535 3.535 0 01-.085-.796c.002-.157.006-.314.018-.471.015-.224.03-.45.06-.672a59.114 59.114 0 01.362-2.298c.087-.493.182-.984.268-1.477.06-.347.118-.694.162-1.043.034-.273.055-.55.063-.825.011-.332.003-.665.002-.998 0-.077.004-.155-.01-.23-.028-.142-.01-.155-.162-.19a5.826 5.826 0 00-.607-.107c-.146-.018-.207-.053-.221-.19-.006-.049-.025-.098-.041-.146-.009-.025-.024-.048-.046-.09l-.025.264c-.009.096-.029.116-.127.115-.055 0-.11-.008-.164-.008-.476 0-.952-.008-1.426.032-.095.008-.173-.015-.226-.103-.04-.066-.088-.126-.134-.186-.063-.084-.086-.093-.182-.06-.195.068-.388.138-.582.21a2.71 2.71 0 00-.675.394.986.986 0 01-.323.168c-.033.01-.07.008-.127.013.02-.066.024-.114.047-.15.064-.105.135-.205.205-.306.023-.033.049-.063.073-.095l-.015-.023-.201.037c-.146.04-.296.07-.437.122-.148.053-.266.023-.386-.072a3.623 3.623 0 01-.733-.786l-.093-.132zm8.592 8.963l-.147.09c-.22.134-.44.266-.659.402-.093.058-.184.12-.27.188-.085.07-.124.161-.072.272.047.1.093.2.147.294.047.08.124.138.213.147.11.01.228.012.336-.012.217-.05.372-.205.528-.357a.291.291 0 00.087-.308c-.046-.18-.079-.365-.118-.547-.011-.052-.027-.103-.045-.169zm-.257-2.409c-.12.291-.205.597-.325.91-.151.433-.294.87-.435 1.323.036-.01.054-.01.067-.018.261-.16.522-.324.785-.484.054-.033.071-.078.065-.138-.012-.13-.024-.262-.034-.393l-.068-.886c-.008-.103-.02-.206-.029-.31-.009 0-.017-.002-.026-.004zm3.081-8.13l.099.285c.08.231.159.463.24.714l.58 1.952c.187.63.372 1.262.558 1.893.114.382.235.762.343 1.146.072.257.126.519.186.799.044.206.087.413.127.64.034.106.023.226.077.325l.025-.006-.068-.362c-.038-.206-.077-.412-.113-.638-.015-.07-.029-.141-.046-.211-.095-.396-.177-.796-.29-1.187-.196-.685-.413-1.364-.618-2.046-.165-.549-.322-1.1-.488-1.648-.069-.227-.15-.45-.226-.695l-.117-.336c-.037-.107-.075-.216-.115-.322-.04-.106-.084-.21-.127-.314a7.558 7.558 0 01-.027.01zM6.225 14.304c-.063-.001-.115.014-.134.083a.35.35 0 00.41.012 4.533 4.533 0 00-.276-.095zM5.23 11.98c-.026-.027-.057-.048-.075.002-.012.032-.007.07-.01.113.082-.037.082-.037.085-.115zm.062-1.189a.135.135 0 00-.088.056.197.197 0 00-.025.11c.005.152.01.306.026.457a.751.751 0 00.066.218c.061.136.157.167.288.101.055-.027.06-.054.025-.11a4.52 4.52 0 01-.129-.211c-.015-.068-.066-.131-.033-.207.04-.09-.076-.116-.074-.19V10.874c-.003-.038-.006-.087-.056-.083zm-.017-.968a.867.867 0 00-.467.127c-.076.045-.084.07-.05.158.034.087.07.173.115.254.064.117.09.125.21.077a.657.657 0 01.336-.053c.202.022.357.136.504.264l.092.077c.007-.006.014-.013.022-.018-.019-.105-.035-.226-.149-.264-.157-.053-.324-.075-.508-.117l-.24-.005c.24-.169.452-.044.687.009-.063-.115-.153-.147-.23-.193-.082-.05-.17-.092-.25-.144-.06-.037-.12-.08-.072-.172zm10.233.325c-.23-.01-.427.08-.608.211-.034.026-.06.065-.105.117.087.026.15.046.232.065.044-.015.088-.03.13-.046.306-.114.61-.115.904.031.126.063.237.04.366-.005-.02-.031-.03-.054-.045-.071a.986.986 0 00-.448-.273c-.14-.044-.284-.024-.426-.03zM7.99 6.483a.308.308 0 00.002.133c.08.321.156.643.242.962.104.387.27.75.456 1.103.02.037.061.08.098.087a.404.404 0 00.253-.051l-.472-.84c-.23-.448-.405-.92-.579-1.394zM10.397.497c-.2-.008-.405.004-.603.034-.236.035-.47.087-.7.152-.287.08-.569.18-.852.273-.04.013-.074.038-.11.058.028.014.05.018.07.014.287-.068.58-.085.873-.09.134-.002.269.009.402.025.19.024.382.048.57.09.456.104.874.3 1.265.556.464.306.888.66 1.257 1.078.205.232.395.475.56.739.17.274.315.561.449.856.273.601.456 1.232.6 1.876.04.173.07.348.1.524.017.104.065.167.17.19.122.028.2.105.22.251-.003.102-.06.174-.129.24a1.065 1.065 0 00-.268.358.164.164 0 00.083-.039c.08-.086.162-.172.235-.265a.56.56 0 00.13-.333c.009-.05.022-.1.024-.15.007-.124-.017-.15-.143-.168-.025-.004-.049-.014-.073-.015-.082-.007-.125-.063-.137-.131-.033-.198-.004-.355.247-.408.086-.018.174-.03.26-.042.158-.023.315-.053.473-.067.14-.012.19.033.226.167.008.029.018.057.021.087.019.179-.008.225-.141.288-.027.013-.055.024-.078.042a.148.148 0 00-.051.067c-.039.144.073.382.206.445l.673.32c.023.011.05.015.075.023l.018-.026c-.015-.008-.032-.013-.044-.024a2.27 2.27 0 00-.544-.32 4.898 4.898 0 00-.173-.075.203.203 0 01-.126-.191c-.003-.085.045-.154.128-.187l.059-.025c.099-.044.118-.076.112-.187a.384.384 0 00-.008-.063c-.067-.294-.123-.59-.205-.88a9.478 9.478 0 00-.826-2.036 7.465 7.465 0 00-1.39-1.805 4.536 4.536 0 00-1.177-.824 3.656 3.656 0 00-1.016-.328 6.155 6.155 0 00-.712-.074zm6.719 5.955c.01.014.018.028.038.034l-.022-.044-.016.01zM4.103 3.917a.062.062 0 01-.03.012.455.455 0 01-.04.039c-.01.01-.02.02-.045.04l-.363.354c-.088.085-.17.178-.266.253-.284.22-.425.53-.544.855a.132.132 0 00-.007.071c.013.055.033.108.052.168l.074.026c-.017.056-.03.105-.047.152-.058.164-.118.327-.175.491-.005.015.008.036.019.077.08-.175.158-.33.225-.489.228-.544.484-1.074.819-1.561.09-.133.182-.266.283-.401.004-.006.007-.013.022-.03.001-.016.003-.032.015-.04l.008-.017zm12.976 2.408a.023.023 0 01.009.019.073.073 0 00-.006.01.188.188 0 00.007.02l.018.022c.002-.007.007-.016.005-.021-.003-.01-.012-.018-.02-.038a1.331 1.331 0 01-.013-.012zM4.199 4.48c-.003.004-.008.008-.027.014-.005.013-.011.025-.031.047a2.085 2.085 0 01-.124.167c-.048.07-.116.055-.181.041-.134-.028-.228.016-.287.143-.089.187-.187.37-.273.56-.049.108-.11.216-.118.36.081.003.154.007.228.008h.228a2.563 2.563 0 01-.079.264c-.01.052-.022.103-.033.155l.02.004c.018-.046.037-.092.067-.153.066-.142.13-.285.2-.426.02-.04.034-.1.116-.092 0 .043.004.084 0 .124-.005.045-.017.09-.028.143.141.043.086.174.115.269.102-.022.104-.195.248-.144v.205l.017.002.439-1.059c-.13 0-.246-.02-.358.033-.024.011-.058-.001-.108-.004.075-.15.139-.278.211-.417a.128.128 0 01.025-.036c0-.015-.001-.03.008-.038l.006-.02c-.005.006-.01.011-.028.017-.004.012-.009.024-.026.045a.085.085 0 01-.032.033c-.123.157-.09.164-.258.106-.079-.027-.078-.028-.047-.144.028-.046.056-.093.098-.15 0-.016-.001-.032.007-.042L4.2 4.48zm2.073-.67c-.003.006-.007.011-.027.016-.094.125-.194.246-.28.377-.155.238-.301.481-.451.723-.14.224-.345.368-.575.481-.017.008-.04.006-.079.011.012-.059.016-.109.033-.153a6.076 6.076 0 01.229-.518l-.007-.02a.138.138 0 01-.035.025c-.028.05-.055.1-.093.164-.26.424-.443.817-.442.95.024.004.048.011.073.013.177.013.188.007.26-.165.03-.07.077-.12.147-.15l.175-.07c.044-.018.085-.057.146-.032.003.05-.01.11.014.145.042.062.044.125.047.193.002.049.017.098.026.147.029-.034.039-.065.05-.097.142-.39.277-.782.428-1.17.1-.256.22-.504.33-.756.013-.03.013-.067.03-.092V3.81zm3.987-.34c0 .045.01.084.021.123.042.16.094.318.124.48.024.133.023.27.028.406 0 .033-.019.067-.032.11-.094-.058-.047-.158-.106-.215h-.125c-.015.072-.01.152-.046.2-.066.085-.155.154-.236.227-.043.038-.078.018-.103-.025l-.046-.087c-.065.035-.117.069-.172.093-.116.051-.235.095-.35.147-.085.038-.09.053-.07.147.014.075.034.148.047.223.013.072.05.109.123.124.233.05.462.115.657.265.058-.102.058-.102.168-.151.03-.014.06-.03.092-.042.08-.03.115-.017.15.06.023.048.041.098.066.158.06-.14-.042-.267.017-.416.157.18.24.39.375.567a.235.235 0 00.022-.098c.002-.124 0-.247.002-.371 0-.034.013-.067.02-.1l.032-.003c.11.155.13.354.226.52a3.036 3.036 0 00-.01-.392c-.004-.045 0-.074.05-.088.08.036.116.14.215.158-.03-.275-.423-1.137-.798-1.635-.114-.127-.2-.28-.34-.386zm-2.667.696c-.019.034-.03.05-.037.067-.061.185-.125.37-.18.556-.031.105-.087.169-.195.19-.09.019-.178.052-.268.073-.038.009-.089.015-.118-.003-.024-.016-.025-.069-.036-.106-.064.076-.082.087-.17.047-.133-.062-.262-.135-.393-.201-.048-.025-.093-.063-.17-.03-.043.12-.091.25-.137.382-.099.28-.087.242.095.453.046.048.102.03.154.023.054-.009.106-.03.16-.036.13-.013.26-.08.367-.015.204-.064.387-.122.571-.178.05-.015.089.005.114.054.022.042.034.093.082.121.038-.056-.013-.128.063-.178l.14.241-.042-1.46zm.278.358c-.096-.01-.107.01-.11.108-.002.038-.003.078.002.115.03.2.099.386.174.57.002.006.012.01.022.015l.078-.05c.052.036.081.088.153.088.205-.002.41.014.616.012.099-.001.158.042.205.12.018.03.024.077.088.066l-.08-.394c-.05-.195-.085-.395-.172-.589-.057.057-.114.068-.18.046a.72.72 0 00-.135-.028c-.22-.028-.44-.059-.66-.08zm10.254-1.727c.089.163.155.316.139.491-.016.168.026.342-.044.516-.047-.033-.088-.082-.112-.075-.117.035-.164-.057-.227-.115a4.772 4.772 0 01-.286-.29l-.104-.113a4.856 4.856 0 01-.023.019c.035.046.07.093.11.156.04.064.084.127.122.193.034.058.065.118.031.205-.082-.01-.164-.019-.246-.032-.06-.01-.101 0-.124.07-.031.098-.037.096-.15.09.02.042.036.08.057.116.041.074.03.138-.03.196-.06.06-.118.122-.178.181a.175.175 0 01-.185.046c-.222-.061-.447-.113-.67-.174-.032-.009-.063-.04-.086-.068-.03-.04-.052-.087-.08-.13-.044-.07-.09-.138-.136-.207a.18.18 0 00-.014.105c.012.127.03.253.035.38.005.1-.024.12-.121.104-.104-.017-.206-.04-.31-.058-.064-.012-.131-.028-.202.03l.081.208c.09 0 .166-.01.237.002a.819.819 0 01.458.251c.078.083.154.168.241.26l.018-.005c-.004-.006-.008-.013-.01-.04.014-.056-.062-.118.018-.178.031.03.064.057.088.09.058.078.111.159.169.257l.089.141.024-.013a2093.819 2093.819 0 01-.427-.934c.055.007.083.007.108.016.193.07.385.142.577.216.074.028.147.06.219.094.062.028.112.018.157-.033.05-.056.102-.112.154-.167.05-.051.095-.046.132.014.016.025.026.053.04.08.071.138.143.277.217.433l.159.308.025-.011c-.044-.106-.07-.218-.138-.334-.057-.182-.168-.346-.206-.545.136.034.362.326.567.732l.057.074.018-.011a1.563 1.563 0 01-.052-.127c-.046-.145-.097-.29-.136-.436-.022-.083-.036-.173.022-.26l.109.058-.026-.207.027-.016c.022.02.05.036.065.06.073.108.143.22.215.33.01.016.029.029.043.043-.036-.217-.2-.38-.229-.626l.155.112c.014-.166.012-.319.042-.465.032-.158-.023-.297-.063-.445.024.004.036.006.055.025.092.124.183.249.277.371.02.027.05.047.069.087l.04.063.019-.015a.293.293 0 01-.053-.082 27.922 27.922 0 01-.332-.49c-.221-.311-.363-.467-.485-.521zm-6.57.327c-.003.161.092.275.069.415l-.368.087c.09.139.032.237-.052.331-.05.057-.092.122-.143.178-.037.04-.046.078-.018.126l.16.275c.029.048.072.066.128.064.076-.003.152 0 .228-.001.116-.003.216.022.275.137.006.014.02.024.044.052.004-.059-.003-.098.01-.13.016-.04.04-.099.072-.108.084-.023.173-.024.26-.03.013-.001.027.018.04.029l.071.065c.019-.11-.082-.198-.024-.31l.126.04c-.026-.123-.07-.245-.071-.366 0-.123.051-.243.115-.36.107.062.16.156.234.253.183.265.36.533.494.834.165-.078.27.068.407.088-.003-.106-.133-.441-.197-.492a.142.142 0 00-.102-.028c-.06.011-.119.039-.191.063-.025-.039-.056-.078-.077-.122a3.936 3.936 0 00-.473-.783c-.076-.094-.16-.182-.228-.26l-.391.285c-.049.035-.094.03-.132-.017l-.169-.207c-.025-.03-.053-.059-.097-.108z","clipRule":"evenodd"}],
  "openai-codex": [{"d":"M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"}],
  "openai": [{"d":"M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"}],
  "openrouter": [{"d":"M18.654 3.87a5.087 5.087 0 110 10.174L23.7 19.09c.64.641.187 1.737-.72 1.737H8.48a8.479 8.479 0 010-16.958h10.175zM8.479 7.26a5.087 5.087 0 100 10.176 5.087 5.087 0 000-10.175z"}],
  "opencode-go": [{"d":"M16 6H8v12h8V6zm4 16H4V2h16v20z"}]
})

const PROVIDER_MARK_GLYPHS = Object.freeze({ deepseek: '🐋' })

function ProviderMark({ provider, className = 'h-3 w-3', fallback = false }) {
  const id = String(provider || '').toLowerCase()
  const glyph = PROVIDER_MARK_GLYPHS[id]
  if (glyph) {
    return jsx('span', {
      'aria-hidden': true,
      className: `${className} inline-flex items-center justify-center text-[0.75rem] leading-none`,
      style: { flex: 'none' },
      children: glyph
    })
  }
  const paths = PROVIDER_MARK_PATHS[id]
  if (!paths) {
    if (!fallback) return null
    const glyph = Array.from(shortName(provider)).slice(0, 2).join('')
    return jsx('span', {
      'aria-hidden': true,
      className: `${className} inline-flex items-center justify-center text-[0.65rem] font-semibold leading-none`,
      style: { flex: 'none' },
      children: glyph
    })
  }
  return jsx('svg', {
    'aria-hidden': true,
    className,
    fill: 'currentColor',
    fillRule: 'evenodd',
    focusable: false,
    viewBox: '0 0 24 24',
    style: { flex: 'none', lineHeight: 1 },
    children: paths.map((path, index) => jsx('path', path, index))
  })
}

// Copilot aliases are provider-pool noise and never shown in the usage widget.
const BADGE_DENYLIST = new Set(['copilot', 'github-copilot', 'github_copilot'])

function formatUsd(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  // Force plain `$` (not locale currency like A$) for compact badges.
  const body = (Math.round(n * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2,
    maximumFractionDigits: 2
  })
  return `$${body}`
}

function meterOf(account) {
  return account?.meter && typeof account.meter === 'object' && !Array.isArray(account.meter)
    ? account.meter
    : null
}

function finiteMeterValue(meter, field) {
  const value = meter?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeUnavailableReason(account) {
  const reason = typeof account?.unavailable_reason === 'string'
    ? account.unavailable_reason.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    : ''
  const containsSecret = /\b(?:bearer\s+\S+|(?:api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+)/i.test(reason)
  return reason && !containsSecret ? reason.slice(0, 180) : 'Usage meter unavailable.'
}

/** Whether this provider has a valid backend meter for a glanceable badge. */
function shouldShowBadge(provider, account) {
  const id = String(provider || '').toLowerCase()
  if (BADGE_DENYLIST.has(id)) return false
  const meter = meterOf(account)
  if (!meter) return false

  if (id === 'openrouter') {
    const remaining = finiteMeterValue(meter, 'remaining_usd')
    return meter.mode === 'credits' && remaining != null && remaining >= 0
  }
  if (meter.mode === 'credits') {
    const remaining = finiteMeterValue(meter, 'remaining_usd')
    return remaining != null && remaining >= 0
  }
  if (meter.mode === 'balance') {
    const balance = finiteMeterValue(meter, 'balance_usd')
    return balance != null && balance >= 0
  }
  if (meter.mode === 'usage') {
    const used = finiteMeterValue(meter, 'used_percent')
    return used != null && used >= 0 && used <= 100
  }
  return false
}

function connectedBadgeProviders(connected, accounts) {
  const ids = [...new Set([...(connected || []), ...Object.keys(accounts || {})])]
    .filter(id => !BADGE_DENYLIST.has(String(id).toLowerCase()))
  const head = BADGE_PROVIDER_ORDER.filter(id => ids.includes(id))
  const tail = ids.filter(id => !BADGE_PROVIDER_ORDER.includes(id)).sort()
  return [...head, ...tail]
}

function orderedBadgeProviders(connected, accounts) {
  return connectedBadgeProviders(connected, accounts)
    .filter(id => shouldShowBadge(id, accounts?.[id]))
}

/** Compact badge text: "Codex: 83%" / "Nous: $21.62" / "DeepSeek: $11.49". */
function badgeText(account) {
  const meter = meterOf(account)
  if (meter?.mode === 'credits') {
    const remaining = finiteMeterValue(meter, 'remaining_usd')
    if (remaining != null && remaining >= 0) return formatUsd(remaining) || '…'
  }
  if (meter?.mode === 'balance') {
    const balance = finiteMeterValue(meter, 'balance_usd')
    if (balance != null && balance >= 0) return formatUsd(balance) || '…'
  }
  if (meter?.mode === 'usage') {
    const used = finiteMeterValue(meter, 'used_percent')
    if (used != null && used >= 0 && used <= 100) return `${Math.round(used)}%`
  }
  return '…'
}

/** Bar width comes only from the normalized backend meter. */
function badgeFillPercent(account) {
  const fill = finiteMeterValue(meterOf(account), 'fill_percent')
  if (fill == null || fill < 0 || fill > 100) return null
  return Math.round(fill)
}

function badgeTone(account) {
  const tone = meterOf(account)?.tone
  return ['ok', 'ahead', 'low', 'critical'].includes(tone) ? tone : 'unknown'
}

/**
 * Soft left→right fill using theme tokens. Yellow/warm when ahead of pace or
 * low on a credit/balance pool.
 */
function badgeFillStyle(fillPercent, tone, drainFrom = DEFAULT_SETTINGS.drainFrom) {
  if (fillPercent == null) return null
  const warm = 'var(--ui-warm, var(--ui-accent))'
  const warning = 'var(--ui-warning, var(--ui-warm, var(--ui-accent)))'
  let color
  if (tone === 'ahead' || tone === 'critical') {
    color = `color-mix(in srgb, ${warning} 42%, transparent)`
  } else if (tone === 'low') {
    color = `color-mix(in srgb, ${warm} 32%, transparent)`
  } else if (fillPercent >= 90) {
    color = `color-mix(in srgb, ${warm} 34%, transparent)`
  } else if (fillPercent >= 70) {
    color = `color-mix(in srgb, var(--ui-accent) 26%, transparent)`
  } else {
    color = `color-mix(in srgb, var(--ui-accent) 16%, transparent)`
  }
  return {
    width: `${fillPercent}%`,
    background: color,
    ...(drainFrom === 'left' ? { right: 0 } : { left: 0 })
  }
}

function badgeTextClass(tone, active) {
  return 'relative z-[1] inline-flex items-center gap-1 font-medium tabular-nums'
}

function badgeTextStyle(tone, active) {
  if (tone === 'ahead' || tone === 'critical') {
    return { color: 'var(--ui-warm, var(--ui-accent))' }
  }
  if (active) {
    return { color: 'var(--ui-text-primary, var(--ui-text-secondary))' }
  }
  return { color: 'var(--ui-text-secondary)' }
}

function badgeBorderClass(tone, opts) {
  const { active = false, streaming = false } = opts && typeof opts === 'object' ? opts : {}
  const parts = [
    'relative overflow-hidden rounded-full border bg-(--ui-chat-surface-background) px-2 py-0.5 text-[0.6875rem] shadow-sm transition-[box-shadow,border-color,transform] duration-200'
  ]
  if (active) parts.push('status-badge-active')
  else parts.push('status-badge-clickable')
  if (streaming) parts.push('status-badge-streaming')
  return parts.join(' ')
}

function badgeBorderStyle(tone, opts) {
  const { active = false } = opts && typeof opts === 'object' ? opts : {}
  // Warning tone still wins on the stroke; active adds glow via CSS class.
  if (tone === 'ahead' || tone === 'critical') {
    return {
      borderColor: 'color-mix(in srgb, var(--ui-warm, var(--ui-accent)) 55%, var(--ui-stroke-secondary))'
    }
  }
  if (active) {
    return {
      borderColor: 'color-mix(in srgb, var(--ui-accent) 55%, var(--ui-stroke-secondary))'
    }
  }
  return { borderColor: 'var(--ui-stroke-secondary)' }
}

const BADGE_FX_STYLE_ID = 'status-badge-fx'

/** Inject once: active glow + streaming pulse (respects reduced motion). */
function ensureBadgeFxStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(BADGE_FX_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = BADGE_FX_STYLE_ID
  el.textContent = `
@keyframes status-badge-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--ui-accent) 40%, transparent),
      0 0 10px color-mix(in srgb, var(--ui-accent) 22%, transparent);
  }
  50% {
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--ui-accent) 55%, transparent),
      0 0 16px color-mix(in srgb, var(--ui-accent) 34%, transparent);
  }
}
.status-badge-active {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--ui-accent) 38%, transparent),
    0 0 12px color-mix(in srgb, var(--ui-accent) 20%, transparent);
}
.status-badge-clickable {
  cursor: pointer;
}
.status-badge-clickable:hover {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-accent) 32%, transparent);
}
.status-badge-clickable:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 55%, transparent);
  outline-offset: 1px;
}
.status-badge-clickable[data-switching='true'] {
  opacity: 0.6;
  pointer-events: none;
}
.status-badge-streaming {
  animation: status-badge-pulse 1.55s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .status-badge-streaming { animation: none; }
}
`
  document.head.appendChild(el)
}

/**
 * Map the Desktop composer model slug → provider id used by this plugin.
 * Heuristic on the slug only (plugins don't get billing_provider on host.state).
 */
function providerFromModel(model) {
  const m = String(model || '').toLowerCase().trim()
  if (!m) return null
  // Distinctive OpenCode Go catalog ids. Overlap models (deepseek / grok / luna)
  // keep their native badges — plugins only see the model slug, not billing_provider.
  if (
    m.includes('glm-5') ||
    m.includes('kimi-k') ||
    m.includes('minimax') ||
    m.includes('mimo') ||
    m.includes('qwen3') ||
    m.includes('hy3') ||
    m.includes('muse-spark')
  ) {
    return 'opencode-go'
  }
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('openrouter')) return 'openrouter'
  if (m.includes('grok') || m.includes('xai')) return 'xai-oauth'
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic'
  if (m.includes('gemini') || m.startsWith('google/')) return 'google'
  if (m.includes('nous')) return 'nous'
  // OpenAI / Codex family: gpt-*, o-series, sol/luna nicknames, codex
  if (
    m.includes('gpt') ||
    m.includes('codex') ||
    m.includes('sol') ||
    m.includes('luna') ||
    /(^|[/\-_.])o[1-4]([.\-]|$)/.test(m)
  ) {
    return 'openai-codex'
  }
  // OpenRouter passes model slugs as `vendor/model` (e.g. anthropic/claude-sonnet-4.5).
  // Check after native providers so google/gemini-* etc. resolve first.
  if (m.includes('/')) return 'openrouter'
  return null
}

function eventType(event) {
  return String(event?.type || event?.event || '')
}

function eventSessionId(event) {
  const p = event?.payload || event?.data || event || {}
  return (
    p.session_id ||
    p.sessionId ||
    p.stored_session_id ||
    p.storedSessionId ||
    event?.session_id ||
    null
  )
}

/** True while the active chat is streaming (message deltas), with idle timeout. */
function useActiveSessionStreaming() {
  const activeSessionId = useValue(host.state.activeSessionId)
  const [streaming, setStreaming] = useState(false)

  useEffect(() => {
    let idleTimer = null
    const clearIdle = () => {
      if (idleTimer != null) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }
    const markStreaming = () => {
      setStreaming(true)
      clearIdle()
      // If complete is missed, drop the pulse after quiet.
      idleTimer = setTimeout(() => setStreaming(false), 4500)
    }
    const markIdle = () => {
      clearIdle()
      setStreaming(false)
    }

    const dispose = host.onEvent('*', event => {
      const type = eventType(event)
      if (!type) return
      const sid = eventSessionId(event)
      // Prefer active-session-only; if the event has no session id, still treat
      // stream traffic as "this window" (common for some delta frames).
      if (activeSessionId && sid && String(sid) !== String(activeSessionId)) {
        // Allow lineage-ish containment matches (stored vs runtime ids).
        const a = String(activeSessionId)
        const b = String(sid)
        if (!a.includes(b) && !b.includes(a)) return
      }

      if (
        type === 'message.start' ||
        type === 'message.delta' ||
        type === 'message.interim' ||
        type === 'agent.tool.start' ||
        type === 'tool.start'
      ) {
        markStreaming()
        return
      }
      if (
        type === 'message.complete' ||
        type === 'session.idle' ||
        type === 'agent.end' ||
        type === 'error' ||
        type.endsWith('.error')
      ) {
        markIdle()
      }
    })

    return () => {
      clearIdle()
      if (typeof dispose === 'function') dispose()
    }
  }, [activeSessionId])

  return streaming
}

function useSelectedProviderId() {
  const model = useValue(host.state.model)
  return providerFromModel(model)
}

// -- click-to-switch ------------------------------------------------------

let modelOptionsCache = null
let modelOptionsCacheAt = 0
const MODEL_OPTIONS_TTL = 30000

/** `model.options` catalog, cached ~30s so rapid badge clicks don't spam RPC. */
async function fetchModelOptions() {
  const now = Date.now()
  if (modelOptionsCache && now - modelOptionsCacheAt < MODEL_OPTIONS_TTL) return modelOptionsCache
  try {
    const res = await host.request('model.options', { explicit_only: true })
    modelOptionsCache = res || null
    modelOptionsCacheAt = Date.now()
  } catch {
    modelOptionsCache = null
    modelOptionsCacheAt = 0
  }
  return modelOptionsCache
}

/** The model slug a badge click should switch to for this provider. */
async function modelForProvider(provider) {
  const override = PROVIDER_BY_ID[provider]?.model
  if (override) return override
  const options = await fetchModelOptions()
  const row = (options?.providers || []).find(p => p.slug === provider || p.name === provider)
  if (!row) return null
  return row.featured_models?.[0] || row.models?.[0] || null
}

/** Click a badge → switch the composer/session to that provider's model. */
async function switchBadgeModel(provider, active) {
  if (active) return
  haptic('tap')
  if (typeof host.selectModel !== 'function') {
    host.notify({
      kind: 'info',
      message: 'This Hermes build predates host.selectModel — update the Desktop app to click-switch models.'
    })
    return
  }
  const target = await modelForProvider(provider)
  if (!target) {
    host.notify({
      kind: 'info',
      message: `${shortName(provider)} has no configured models — add one in Settings → Providers.`
    })
    return
  }
  const ok = await host.selectModel({ provider, model: target })
  host.notify(
    ok
      ? { kind: 'success', message: `Switched to ${target}` }
      : { kind: 'error', message: `Could not switch to ${target}` }
  )
}

/** Richer tip content kept off the badge face. */
function badgeTip(provider, account) {
  const parts = [shortName(provider)]
  const meter = meterOf(account)
  if (meter?.mode === 'credits') {
    const rem = formatUsd(meter.remaining_usd)
    const all = formatUsd(meter.allowance_usd)
    if (rem && all) parts.push(`${rem} of ${all} left`)
    else if (rem) parts.push(`${rem} credits`)
    if (meter.period_elapsed_percent != null) parts.push(`${pctNum(meter.period_elapsed_percent)}% of period`)
    if (meter.ahead_of_pace) parts.push('ahead of pace')
    if (meter.reset_at) parts.push(relativeReset(meter.reset_at, 'renews'))
  } else if (meter?.mode === 'balance') {
    const bal = formatUsd(meter.balance_usd)
    if (bal) parts.push(`balance ${bal}`)
    if (meter.tone === 'low' || meter.tone === 'critical') parts.push('low balance')
  } else if (meter?.mode === 'usage') {
    if (meter.window_label) parts.push(meter.window_label)
    if (meter.used_percent != null) parts.push(`${pctNum(meter.used_percent)}% used`)
    if (meter.period_elapsed_percent != null) parts.push(`${pctNum(meter.period_elapsed_percent)}% of period`)
    if (meter.ahead_of_pace) parts.push('ahead of pace')
    if (meter.reset_at) parts.push(relativeReset(meter.reset_at, 'resets'))
  } else {
    parts.push(account?.unavailable_reason ? safeUnavailableReason(account) : 'usage unavailable')
  }
  if (account?.plan) parts.push(account.plan)
  return parts.join(' · ')
}

const BADGE_TYPES = Object.freeze({
  usage: Object.freeze({
    id: 'usage',
    label: 'Usage',
    isAvailable: shouldShowBadge,
    face: badgeText,
    fillPercent: badgeFillPercent,
    tone: badgeTone,
    tip: badgeTip
  })
})

function badgeTypeFor(provider) {
  return BADGE_TYPES[providerDefinition(provider).badgeType] || BADGE_TYPES.usage
}

/** Adapt provider/account payloads into the generic strip item contract. */
function buildStatusBadgeItems(data, settings) {
  const accounts = data?.accounts || {}
  const available = orderedBadgeProviders(data?.connected_providers, accounts)
  return visibleBadgeProviders(available, settings).map(provider => {
    const badgeType = badgeTypeFor(provider)
    const account = accounts[provider]
    return {
      id: provider,
      provider,
      type: badgeType.id,
      label: shortName(provider),
      value: badgeType.face(account),
      fillPercent: badgeType.fillPercent(account),
      tone: badgeType.tone(account),
      tooltip: badgeType.tip(provider, account)
    }
  })
}

function SettingsSection({ title, description, children }) {
  return jsxs('section', {
    className: 'flex flex-col gap-2 rounded-md border border-(--ui-stroke-secondary) p-2.5',
    children: [
      jsxs('div', {
        className: 'flex flex-col gap-0.5',
        children: [
          jsx('div', { className: 'text-sm font-medium text-(--ui-text-primary)', children: title }),
          description ? jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: description }) : null
        ]
      }),
      children
    ]
  })
}

function SettingChoice({ label, description, value, options, onChange }) {
  return jsxs('div', {
    className: 'flex flex-col gap-1.5 border-t border-(--ui-stroke-secondary) pt-2 first:border-t-0 first:pt-0',
    children: [
      jsxs('div', {
        className: 'flex flex-col gap-0.5',
        children: [
          jsx('div', { className: 'text-xs font-medium text-(--ui-text-secondary)', children: label }),
          jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: description })
        ]
      }),
      jsx(SegmentedControl, { value, options, onChange })
    ]
  })
}

function StatusBadgesSettings({ ctx, $settings }) {
  const settings = useValue($settings)
  const query = useQuery({
    queryKey: USAGE_QUERY_KEY,
    queryFn: () => ctx.rest('/usage'),
    refetchInterval: 30000,
    staleTime: 20000
  })
  const setPresentation = patch => updateSettings($settings, patch)

  return jsxs('div', {
    className: 'flex h-full flex-col gap-2.5 overflow-auto p-2.5 text-sm',
    children: [
      jsxs('div', {
        className: 'flex items-start justify-between gap-2',
        children: [
          jsxs('div', {
            className: 'flex flex-col gap-0.5',
            children: [
              jsx('div', { className: 'font-medium text-(--ui-text-primary)', children: 'Status Badges' }),
              jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'Configure compact status surfaces. Usage is the first badge type.' })
            ]
          }),
          jsx(Button, {
            size: 'sm',
            variant: 'ghost',
            onClick: () => $settings.set(normalizeSettings(null)),
            children: 'Reset'
          })
        ]
      }),
      jsx(SettingsSection, {
        title: 'Placement',
        description: 'Changes apply immediately and persist on this Desktop installation.',
        children: jsxs('div', {
          className: 'flex flex-col gap-2',
          children: [
            jsx(SettingChoice, {
              label: 'Composer position',
              description: 'Place the strip above or below the composer.',
              value: settings.position,
              options: [
                { id: 'bottom', label: 'Below' },
                { id: 'top', label: 'Above' }
              ],
              onChange: position => setPresentation({ position })
            }),
            jsx(SettingChoice, {
              label: 'Alignment',
              description: 'Align the badges within the available composer width.',
              value: settings.alignment,
              options: [
                { id: 'left', label: 'Left' },
                { id: 'center', label: 'Center' },
                { id: 'right', label: 'Right' }
              ],
              onChange: alignment => setPresentation({ alignment })
            }),
            jsx(SettingChoice, {
              label: 'Drain edge',
              description: 'Choose which edge empties as remaining capacity falls.',
              value: settings.drainFrom,
              options: [
                { id: 'right', label: 'From right' },
                { id: 'left', label: 'From left' }
              ],
              onChange: drainFrom => setPresentation({ drainFrom })
            })
          ]
        })
      }),
      jsx(ProviderSettings, { ctx, $settings, settings, query })
    ]
  })
}

function DisplayStyleSetting({ $settings, settings }) {
  return jsxs('div', {
    className: 'flex flex-col gap-1.5 border-t border-(--ui-stroke-secondary) pt-2',
    children: [
      jsxs('div', {
        className: 'flex flex-col gap-0.5',
        children: [
          jsx('div', { className: 'text-xs font-medium text-(--ui-text-secondary)', children: 'Display style' }),
          jsx('div', { className: 'text-xs text-(--ui-text-quaternary)', children: 'Show provider icons, badge text, or both.' })
        ]
      }),
      jsxs(Select, {
        value: settings.displayStyle,
        onValueChange: displayStyle => updateSettings($settings, { displayStyle }),
        children: [
          jsx(SelectTrigger, {
            className: 'w-full',
            'aria-label': 'Badge display style',
            children: jsx(SelectValue, { placeholder: 'Both' })
          }),
          jsxs(SelectContent, {
            children: [
              jsx(SelectItem, { value: 'both', children: 'Both' }),
              jsx(SelectItem, { value: 'icon', children: 'Icon' }),
              jsx(SelectItem, { value: 'text', children: 'Text' })
            ]
          })
        ]
      })
    ]
  })
}

function ProviderSettings({ $settings, settings, query }) {
  let providerRows
  if (query.isLoading) {
    providerRows = jsx('div', {
      className: 'flex items-center gap-2 text-xs text-(--ui-text-tertiary)',
      children: [jsx(GlyphSpinner, {}), 'Loading providers…']
    })
  } else if (query.error) {
    providerRows = jsxs('div', {
      className: 'flex items-center justify-between gap-2 text-xs text-(--ui-text-tertiary)',
      children: [
        jsx('span', { children: 'Provider status could not be loaded.' }),
        jsx(Button, { size: 'sm', variant: 'ghost', onClick: () => query.refetch(), children: 'Retry' })
      ]
    })
  } else {
    const data = query.data || { accounts: {}, connected_providers: [] }
    const providers = connectedBadgeProviders(data.connected_providers, data.accounts)
    providerRows = providers.length
      ? jsx('div', {
          className: 'flex flex-col',
          children: providers.map(provider => {
            const definition = providerDefinition(provider)
            const badgeType = badgeTypeFor(provider)
            const account = data.accounts?.[provider]
            const usable = shouldShowBadge(provider, account)
            return jsxs('label', {
              className: 'flex cursor-pointer items-center gap-2 border-t border-(--ui-stroke-secondary) py-2 first:border-t-0 first:pt-0 last:pb-0',
              children: [
                jsx(ProviderMark, { provider, className: 'h-4 w-4 text-(--ui-text-secondary)' }),
                jsxs('span', {
                  className: 'min-w-0 flex-1',
                  children: [
                    jsx('span', { className: 'block truncate text-sm text-(--ui-text-primary)', children: definition.label }),
                    jsx('span', { className: 'block text-xs text-(--ui-text-quaternary)', children: `${badgeType.label} · ${usable ? badgeType.face(account) : 'unavailable'}` }),
                    !usable ? jsx('span', { className: 'block text-xs text-(--ui-text-tertiary)', children: safeUnavailableReason(account) }) : null
                  ]
                }),
                jsx(Switch, {
                  checked: isProviderEnabled(settings, provider),
                  size: 'xs',
                  onCheckedChange: enabled => setProviderEnabled($settings, provider, enabled)
                })
              ]
            }, provider)
          })
        })
      : jsx('div', { className: 'text-xs text-(--ui-text-tertiary)', children: 'No connected providers.' })
  }

  return jsx(SettingsSection, {
    title: 'Providers',
    description: 'Enable or hide each connected provider badge independently.',
    children: jsxs('div', {
      className: 'flex flex-col gap-2',
      children: [
        providerRows,
        jsx(DisplayStyleSetting, { $settings, settings })
      ]
    })
  })
}

function BadgeSlot({ ctx, $settings, slot }) {
  const settings = useValue($settings)
  if (!slotIsActive(slot, settings)) return null
  return jsx(FloatingUsageBadges, { ctx, $settings })
}

function FloatingUsageBadges({ ctx, $settings }) {
  ensureBadgeFxStyles()
  const settings = useValue($settings)
  const selectedProvider = useSelectedProviderId()
  const sessionStreaming = useActiveSessionStreaming()
  const [switching, setSwitching] = useState(null)
  const query = useQuery({
    queryKey: USAGE_QUERY_KEY,
    queryFn: () => ctx.rest('/usage'),
    refetchInterval: 30000,
    staleTime: 20000
  })
  if (query.isLoading) {
    return jsx('div', { className: 'mx-auto text-[0.6875rem] text-(--ui-text-quaternary)', children: 'usage…' })
  }
  if (query.error) {
    return jsx('div', {
      className: 'mx-auto text-[0.6875rem] text-(--ui-text-quaternary)',
      children: 'usage unavailable'
    })
  }
  const data = query.data || { accounts: {}, connected_providers: [] }
  const availableProviders = orderedBadgeProviders(data.connected_providers, data.accounts)
  const items = buildStatusBadgeItems(data, settings)
  if (!availableProviders.length) {
    return jsx('div', { className: 'mx-auto text-[0.6875rem] text-(--ui-text-quaternary)', children: 'no providers' })
  }
  if (!items.length) return null
  const display = displayStyleFlags(settings.displayStyle)
  return jsxs('div', {
    className: `flex w-full max-w-full flex-wrap gap-1 ${alignmentClass(settings.alignment)}`,
    children: items.map(item => {
      const provider = item.provider
      const label = `${item.label}: ${item.value}`
      const fillPercent = item.fillPercent
      const tone = item.tone
      const fillStyle = badgeFillStyle(fillPercent, tone, settings.drainFrom)
      const active = selectedProvider != null && provider === selectedProvider
      const streaming = active && sessionStreaming
      const busy = switching === provider
      const runSwitch = () => {
        if (busy || active) return
        setSwitching(provider)
        switchBadgeModel(provider, active).finally(() => setSwitching(null))
      }
      const tipBits = [item.tooltip]
      if (active) tipBits.push(streaming ? 'selected · streaming' : 'selected model')
      else if (typeof host.selectModel === 'function') tipBits.push('click to switch')
      return jsx(Tip, {
        label: tipBits.join(' · '),
        children: jsxs('div', {
          className: badgeBorderClass(tone, { active, streaming }),
          style: badgeBorderStyle(tone, { active }),
          onClick: runSwitch,
          onKeyDown: ev => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault()
              runSwitch()
            }
          },
          tabIndex: 0,
          'data-active': active ? 'true' : undefined,
          'data-streaming': streaming ? 'true' : undefined,
          'data-switching': busy ? 'true' : undefined,
          ...(fillPercent != null
            ? {
                role: 'meter',
                'aria-label': `${item.label} ${item.value} usage${active ? (streaming ? ', selected, streaming' : ', selected') : ', click to switch'}`,
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': fillPercent
              }
            : {
                'aria-label': `${item.label} ${item.value}${active ? (streaming ? ', selected, streaming' : ', selected') : ', click to switch'}`
              }),
          children: [
            fillStyle
              ? jsx('div', {
                  'aria-hidden': true,
                  className: 'pointer-events-none absolute inset-y-0 rounded-full transition-[width,background] duration-300 ease-out',
                  style: fillStyle
                })
              : null,
            jsxs('span', {
              className: badgeTextClass(tone, active),
              style: badgeTextStyle(tone, active),
              children: [
                display.icon ? jsx(ProviderMark, { provider, fallback: !display.text }) : null,
                display.text ? label : null
              ]
            })
          ]
        })
      }, item.id)
    })
  })
}

function untilLabel(iso) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  let ms = t - Date.now()
  if (ms <= 0) return 'now'
  const totalMins = Math.round(ms / 60000)
  if (totalMins < 60) return `${totalMins}m`
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours < 48) return mins ? `${hours}h ${mins}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remH = hours % 24
  return remH ? `${days}d ${remH}h` : `${days}d`
}

/** "resets in 3d 9h" / "renews in 4h 12m", falling back to an absolute stamp. */
function relativeReset(iso, verb) {
  if (!iso) return null
  const rel = untilLabel(iso)
  return rel ? `${verb} in ${rel}` : `${verb} ${new Date(iso).toLocaleString()}`
}

// Plugin storage is localStorage scoped as `hermes.plugin.<id>.<key>`
// (apps/desktop/src/contrib/plugin.ts), so a rename would orphan the saved
// pill visibility/order. Copy it over once; the legacy key is left in place.
function adoptLegacySettings(ctx) {
  if (ctx.storage.get(SETTINGS_KEY, null) !== null) return
  for (const legacyId of LEGACY_IDS) {
    try {
      const raw = globalThis.localStorage?.getItem(`hermes.plugin.${legacyId}.${SETTINGS_KEY}`)
      if (raw) {
        ctx.storage.set(SETTINGS_KEY, JSON.parse(raw))
        return
      }
    } catch {
      // Unreadable or malformed legacy settings: start from the defaults.
    }
  }
}

export default {
  id: ID,
  name: 'Status Badges',
  description: 'Configurable provider status badges for the composer.',
  register(ctx) {
    adoptLegacySettings(ctx)
    const $settings = atom(normalizeSettings(ctx.storage.get(SETTINGS_KEY, DEFAULT_SETTINGS)))
    ctx.onDispose($settings.listen(settings => ctx.storage.set(SETTINGS_KEY, settings)))

    ctx.registerMany([
      {
        // Preserve the contribution id so the existing sidebar position survives.
        id: 'details',
        area: 'panes',
        title: 'status badges',
        data: {
          placement: 'right',
          collapsible: true,
          dock: { pane: 'workspace', pos: 'right' },
          width: '300px',
          minWidth: '250px',
          maxWidth: '420px'
        },
        render: () => jsx(StatusBadgesSettings, { ctx, $settings })
      },
      {
        id: 'badges-top',
        area: COMPOSER_AREAS.top,
        order: 30,
        render: () => jsx(BadgeSlot, { ctx, $settings, slot: 'top' })
      },
      {
        // Keep the established underside surface as the default "below" slot.
        id: 'badges',
        area: COMPOSER_AREAS.underside,
        order: 30,
        render: () => jsx(BadgeSlot, { ctx, $settings, slot: 'bottom' })
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: `${ID}.open`,
          label: 'Status Badges — configuration help',
          keywords: ['status', 'provider', 'credits', 'quota', 'usage', 'badges', 'configuration'],
          run: () => {
            haptic('tap')
            host.notify({
              kind: 'info',
              message: 'Open the Status Badges sidebar tab to choose providers, position, alignment, and drain edge. Usage badges keep their existing meter semantics and click-to-switch behavior.'
            })
          }
        }
      }
    ])
  }
}
