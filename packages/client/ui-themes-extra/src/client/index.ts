/**
 * Client half of the extra-themes plugin. Registers the 14 extra color
 * themes from the dsh-beautify catalog into the harness theme runtime. Each
 * theme ships a light and a dark colorScheme variant, so each logical theme
 * produces two registrations: `<id>-light` and `<id>-dark`. Values are the
 * exact HEX values from dsh-beautify's THEMES table, mapped onto the
 * standard `--dsw-alias-*` and `--dsw-specific-sidebar-fill` tokens plus the
 * three invariant state colors.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeDefinition, ThemeTokens } from '@deepseek-ai/dsh-client-ui-theme/client'

const STATE_ERROR_LIGHT = '#dc2626'
const STATE_ERROR_DARK = '#f87171'
const STATE_SUCCESS_LIGHT = '#16a34a'
const STATE_SUCCESS_DARK = '#4ade80'
const STATE_WARN_LIGHT = '#d97706'
const STATE_WARN_DARK = '#fbbf24'

interface Palette {
  readonly brand: string
  readonly bg: string
  readonly layer1: string
  readonly layer2: string
  readonly overlay: string
  readonly border1: string
  readonly border2: string
  readonly label: string
  readonly label2: string
  readonly sidebar: string
}

interface ThemeSource {
  readonly id: string
  readonly label: string
  readonly light: Palette
  readonly dark: Palette
}

const THEMES: readonly ThemeSource[] = Object.freeze([
  Object.freeze({
    id: 'minecraft',
    label: '我的世界',
    light: Object.freeze({ brand: '#6A8D2E', bg: '#F7FAF0', layer1: '#ffffff', layer2: '#EDF3DC', overlay: '#ffffff', border1: '#DDE5C8', border2: '#C6D3A4', label: '#2C3A1A', label2: '#5C6B44', sidebar: '#F0F5E0' }),
    dark: Object.freeze({ brand: '#9BC440', bg: '#141B0E', layer1: '#1A2312', layer2: '#202C16', overlay: '#181F10', border1: '#2E3C1E', border2: '#3E5030', label: '#EDF5D8', label2: '#A9BC84', sidebar: '#11170C' }),
  }),
  Object.freeze({
    id: 'gundam',
    label: '高达',
    light: Object.freeze({ brand: '#E0333B', bg: '#FAF8F7', layer1: '#ffffff', layer2: '#F5EDEA', overlay: '#ffffff', border1: '#E5D9D4', border2: '#D4BFB6', label: '#33201C', label2: '#7A5A52', sidebar: '#F7F1EE' }),
    dark: Object.freeze({ brand: '#FF4D52', bg: '#1A1210', layer1: '#221614', layer2: '#2B1C19', overlay: '#1E1412', border1: '#3A2722', border2: '#4E3630', label: '#FBE9E5', label2: '#C49A8F', sidebar: '#170F0D' }),
  }),
  Object.freeze({
    id: 'eva',
    label: 'EVA',
    light: Object.freeze({ brand: '#8E24AA', bg: '#FAF5FC', layer1: '#ffffff', layer2: '#F3E9F8', overlay: '#ffffff', border1: '#E3D3EC', border2: '#CEAEDD', label: '#33123F', label2: '#6D4F7D', sidebar: '#F6EEFA' }),
    dark: Object.freeze({ brand: '#BA68C8', bg: '#160E1D', layer1: '#1C1226', layer2: '#231831', overlay: '#190F22', border1: '#33233F', border2: '#46305A', label: '#F4E8FB', label2: '#B79CCB', sidebar: '#120B18' }),
  }),
  Object.freeze({
    id: 'cyberpunk',
    label: '赛博朋克',
    light: Object.freeze({ brand: '#D81B60', bg: '#FBF4F8', layer1: '#ffffff', layer2: '#F8E8F0', overlay: '#ffffff', border1: '#EBCFD9', border2: '#DBA4BA', label: '#3A0F23', label2: '#7E4A61', sidebar: '#FAEEF4' }),
    dark: Object.freeze({ brand: '#FF2E88', bg: '#120A14', layer1: '#190F1D', layer2: '#201426', overlay: '#160C1A', border1: '#33203C', border2: '#483052', label: '#FFE4F2', label2: '#D19CB8', sidebar: '#0F0812' }),
  }),
  Object.freeze({
    id: 'dark-gold',
    label: '黑金',
    light: Object.freeze({ brand: '#B8860B', bg: '#FAF9F6', layer1: '#ffffff', layer2: '#F3EFE4', overlay: '#ffffff', border1: '#E2DBC8', border2: '#CFC4A6', label: '#2B2515', label2: '#6E644A', sidebar: '#F6F2E8' }),
    dark: Object.freeze({ brand: '#E2B13C', bg: '#12110C', layer1: '#1A1811', layer2: '#211E16', overlay: '#17150F', border1: '#38331F', border2: '#4C4529', label: '#F7EFD8', label2: '#C0AF84', sidebar: '#0F0E09' }),
  }),
  Object.freeze({
    id: 'starry',
    label: '星空',
    light: Object.freeze({ brand: '#3F51B5', bg: '#F6F7FC', layer1: '#ffffff', layer2: '#ECEEF9', overlay: '#ffffff', border1: '#D8DCEE', border2: '#BAC0E0', label: '#1B2140', label2: '#4A5178', sidebar: '#EFF1FA' }),
    dark: Object.freeze({ brand: '#7C8CE8', bg: '#0B1024', layer1: '#111735', layer2: '#161E42', overlay: '#0E1430', border1: '#232C55', border2: '#313C72', label: '#E8EBFB', label2: '#A3ACDA', sidebar: '#090D1E' }),
  }),
  Object.freeze({
    id: 'sakura',
    label: '樱花',
    light: Object.freeze({ brand: '#E91E63', bg: '#FEF7FA', layer1: '#ffffff', layer2: '#FCEAF2', overlay: '#ffffff', border1: '#F3D3E0', border2: '#E6ACC3', label: '#41101F', label2: '#855065', sidebar: '#FDF1F6' }),
    dark: Object.freeze({ brand: '#F06292', bg: '#1D0F16', layer1: '#261420', layer2: '#2F1A28', overlay: '#221119', border1: '#402434', border2: '#57304A', label: '#FDEAF1', label2: '#CE93AC', sidebar: '#190C13' }),
  }),
  Object.freeze({
    id: 'forest',
    label: '森林',
    light: Object.freeze({ brand: '#2E7D32', bg: '#F4FAF2', layer1: '#ffffff', layer2: '#E8F3E4', overlay: '#ffffff', border1: '#D3E5CC', border2: '#B6D2AC', label: '#16290F', label2: '#4E6B41', sidebar: '#EFF7EA' }),
    dark: Object.freeze({ brand: '#66BB6A', bg: '#0E1709', layer1: '#142011', layer2: '#1A2915', overlay: '#111B0D', border1: '#2A3D22', border2: '#3B5232', label: '#E9F5DF', label2: '#9FBE8C', sidebar: '#0B1308' }),
  }),
  Object.freeze({
    id: 'ocean',
    label: '海洋',
    light: Object.freeze({ brand: '#0277BD', bg: '#F2F8FC', layer1: '#ffffff', layer2: '#E4F1F9', overlay: '#ffffff', border1: '#CFE3F0', border2: '#A9CBE2', label: '#0C2C43', label2: '#3E6680', sidebar: '#EBF3FA' }),
    dark: Object.freeze({ brand: '#4FC3F7', bg: '#08141D', layer1: '#0D1C28', layer2: '#122332', overlay: '#0A1822', border1: '#1F3445', border2: '#2D4A62', label: '#E0F2FC', label2: '#8FBFD8', sidebar: '#07101A' }),
  }),
  Object.freeze({
    id: 'sunset',
    label: '落日',
    light: Object.freeze({ brand: '#E64A19', bg: '#FDF6F2', layer1: '#ffffff', layer2: '#F9E9E0', overlay: '#ffffff', border1: '#EED4C4', border2: '#E0B39B', label: '#3A1607', label2: '#7C4A30', sidebar: '#FAEFE8' }),
    dark: Object.freeze({ brand: '#FF8A65', bg: '#1C1009', layer1: '#251510', layer2: '#2E1B14', overlay: '#211209', border1: '#3E2A1E', border2: '#553A2B', label: '#FDE9DE', label2: '#D0A18A', sidebar: '#180D07' }),
  }),
  Object.freeze({
    id: 'mint',
    label: '薄荷',
    light: Object.freeze({ brand: '#00897B', bg: '#F2FAF9', layer1: '#ffffff', layer2: '#E2F3F0', overlay: '#ffffff', border1: '#CCE8E3', border2: '#A9D8D0', label: '#082E2B', label2: '#3E6B66', sidebar: '#E9F6F4' }),
    dark: Object.freeze({ brand: '#4DB6AC', bg: '#0A1515', layer1: '#0F1D1D', layer2: '#142524', overlay: '#0C1818', border1: '#1F3837', border2: '#2D4F4D', label: '#DFF3F1', label2: '#8FC4BE', sidebar: '#081212' }),
  }),
  Object.freeze({
    id: 'vaporwave',
    label: '蒸汽波',
    light: Object.freeze({ brand: '#D500F9', bg: '#FBF4FE', layer1: '#ffffff', layer2: '#F6E6FE', overlay: '#ffffff', border1: '#E8CCFA', border2: '#D4A3F5', label: '#340A46', label2: '#74458D', sidebar: '#F8EEFC' }),
    dark: Object.freeze({ brand: '#E040FB', bg: '#170A1F', layer1: '#1D0F28', layer2: '#251437', overlay: '#1A0D24', border1: '#36204A', border2: '#4C2F66', label: '#F6E6FF', label2: '#C79EE0', sidebar: '#130821' }),
  }),
  Object.freeze({
    id: 'neon',
    label: '霓虹',
    light: Object.freeze({ brand: '#00B0FF', bg: '#F4FBFE', layer1: '#ffffff', layer2: '#E2F6FE', overlay: '#ffffff', border1: '#C8EDFB', border2: '#9BDFF8', label: '#062A38', label2: '#33677E', sidebar: '#EBF8FD' }),
    dark: Object.freeze({ brand: '#18FFFF', bg: '#060D13', layer1: '#0A141C', layer2: '#0F1C26', overlay: '#081018', border1: '#1C3040', border2: '#2A465C', label: '#DDFBFF', label2: '#7FD8E8', sidebar: '#050B10' }),
  }),
  Object.freeze({
    id: 'midnight',
    label: '午夜',
    light: Object.freeze({ brand: '#303F9F', bg: '#F5F6FB', layer1: '#ffffff', layer2: '#E9EBF7', overlay: '#ffffff', border1: '#D5D8EC', border2: '#B4B9DD', label: '#171D3C', label2: '#434A72', sidebar: '#EEF0F9' }),
    dark: Object.freeze({ brand: '#7986CB', bg: '#0A0C1A', layer1: '#10132A', layer2: '#151938', overlay: '#0C0F22', border1: '#232747', border2: '#30355E', label: '#E4E6F8', label2: '#9AA0CE', sidebar: '#080A16' }),
  }),
])

function buildTokens(palette: Palette, scheme: 'light' | 'dark'): ThemeTokens {
  const error = scheme === 'light' ? STATE_ERROR_LIGHT : STATE_ERROR_DARK
  const success = scheme === 'light' ? STATE_SUCCESS_LIGHT : STATE_SUCCESS_DARK
  const warn = scheme === 'light' ? STATE_WARN_LIGHT : STATE_WARN_DARK
  return Object.freeze({
    '--dsw-alias-bg-base': palette.bg,
    '--dsw-alias-bg-layer-1': palette.layer1,
    '--dsw-alias-bg-layer-2': palette.layer2,
    '--dsw-alias-bg-overlay': palette.overlay,
    '--dsw-alias-border-l1': palette.border1,
    '--dsw-alias-border-l2': palette.border2,
    '--dsw-alias-brand-primary': palette.brand,
    '--dsw-alias-label-primary': palette.label,
    '--dsw-alias-label-secondary': palette.label2,
    '--dsw-alias-state-error-primary': error,
    '--dsw-alias-state-success-primary': success,
    '--dsw-alias-state-warn-primary': warn,
    '--dsw-specific-sidebar-fill': palette.sidebar,
  })
}

function buildDefinition(theme: ThemeSource, scheme: 'light' | 'dark'): ThemeDefinition {
  const palette = scheme === 'light' ? theme.light : theme.dark
  return Object.freeze({
    id: `${theme.id}-${scheme}`,
    colorScheme: scheme,
    tokens: buildTokens(palette, scheme),
  })
}

export const EXTRA_THEMES: readonly ThemeSource[] = THEMES

export function registerAll(ctx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []
  for (const theme of THEMES) {
    disposers.push(ctx.theme.register(buildDefinition(theme, 'light')))
    disposers.push(ctx.theme.register(buildDefinition(theme, 'dark')))
  }
  return Object.freeze(disposers)
}

export const inject = ['theme']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers = registerAll(ctx)
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-themes-extra: theme registrations')
}
