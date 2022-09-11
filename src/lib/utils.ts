import Hammer, {
  DIRECTION_ALL,
  DIRECTION_DOWN,
  DIRECTION_HORIZONTAL,
  DIRECTION_LEFT,
  DIRECTION_RIGHT,
  DIRECTION_UP,
  DIRECTION_VERTICAL,
  Pan
} from 'hammerjs'

import Big from 'big.js'
import UAParser from 'ua-parser-js'
import { formatDistanceToNowStrict, formatRelative, type Locale } from 'date-fns'
import type { Load } from '@sveltejs/kit'
import { credentials$ } from './streams'
import type { CoreLnCredentials, ListfundsResponse } from './backends'

import {
  COINBASE_PRICE_ENDPOINT,
  COIN_GECKO_PRICE_ENDPOINT,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY
} from './constants'

import {
  type Denomination,
  type PaymentType,
  type Settings,
  Language,
  type Payment,
  type BitcoinExchangeRates,
  type FormattedSections
} from './types'

import {
  ar,
  bn,
  enGB,
  enUS,
  es,
  fr,
  hi,
  id,
  ja,
  pt,
  ru,
  zhCN,
  de,
  te,
  tr,
  ta,
  ko
} from 'date-fns/locale'

export function formatDecodedInvoice(decodedInvoice: {
  paymentRequest: string
  sections: { name: string; value?: string | number }[]
}): {
  paymentRequest: string
  expiry: number
  description: string
  amount: string
  timestamp: number
} {
  const { sections, paymentRequest } = decodedInvoice

  const formattedSections = sections.reduce((acc, { name, value }) => {
    if (name && value) {
      acc[name] = value
    }

    return acc
  }, {} as FormattedSections)

  return { paymentRequest, ...formattedSections }
}

export function truncateValue(request: string): string {
  return `${request.slice(0, 9)}...${request.slice(-9)}`
}

export function getSettingsFromStorage(): Settings {
  const value = localStorage.getItem(SETTINGS_STORAGE_KEY)
  const settingsInStorage: Settings | null = value && JSON.parse(value)

  return settingsInStorage || DEFAULT_SETTINGS
}

export function supportsNotifications(): boolean {
  return 'Notification' in window
}

export function notificationsPermissionsGranted(): boolean {
  return Notification.permission === 'granted'
}

export function formatValueForDisplay({
  value,
  denomination,
  commas = false,
  input = false
}: {
  value: string | null
  denomination: Denomination
  commas?: boolean
  input?: boolean
}): string {
  if (!value) return ''

  switch (denomination) {
    case 'btc': {
      const formatted = value === '0' ? value : Big(value).round(8).toString()
      return commas ? formatWithCommas(formatted) : formatted
    }

    case 'sats':
    case 'msats': {
      const formatted = Big(value).round().toString()
      return commas ? formatWithCommas(formatted) : formatted
    }

    // fiat
    default: {
      let formatted

      // if live input don't round or format just yet
      if (input) {
        formatted = value
      } else if (String(value).includes('.')) {
        const rounded = Big(value).round(2).toString()
        const decimalIndex = rounded.indexOf('.')
        formatted =
          decimalIndex >= 1 && decimalIndex === rounded.length - 2 ? `${rounded}0` : rounded
      } else {
        formatted = value
      }

      return commas ? formatWithCommas(formatted) : formatted
    }
  }
}

export function formatWithCommas(val: string, commasAfterDecimal?: boolean) {
  if (commasAfterDecimal) {
    return val.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  const parts = val.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return parts.join('.')
}

export async function getClipboardPermissions(): Promise<boolean> {
  try {
    const name = 'clipboard-read' as PermissionName
    const { state } = await navigator.permissions.query({ name })

    return state === 'granted'
  } catch (error) {
    return false
  }
}

export async function readClipboardValue(): Promise<string | null> {
  try {
    const clipboardText = await navigator.clipboard.readText()
    return clipboardText || null
  } catch (error) {
    return null
  }
}

/**
 *
 * @returns boolean indicating if write was successful
 */
export async function writeClipboardValue(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (error) {
    return false
  }
}

export const nodePublicKeyRegex = /[0-9a-fA-F]{66}/
export const lightningInvoiceRegex = /^(lnbcrt|lnbc)[a-zA-HJ-NP-Z0-9]{1,}$/
const ipRegex = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)(\.(?!$)|$)){4}$/

export function getPaymentType(value: string): PaymentType | null {
  if (nodePublicKeyRegex.test(value)) {
    return 'node_public_key'
  }

  if (lightningInvoiceRegex.test(value)) {
    return 'payment_request'
  }

  return null
}

type SwipeOptions = {
  direction: number
  threshold?: number
  velocity?: number
}

type DragOptions = {
  direction?: number
  threshold?: number
  maxDrag?: number
}

export function swipe(
  node: HTMLElement,
  options?: SwipeOptions
): { update: (options?: SwipeOptions) => void; destroy: () => void } {
  const hammer = new Hammer(node)
  hammer.get('swipe').set(options)
  hammer.on('swipe', (ev: HammerInput) =>
    node.dispatchEvent(new CustomEvent('swipe', { detail: ev }))
  )

  return {
    update(opt) {
      hammer.get('swipe').set(opt)
    },
    destroy() {
      hammer.off('swipe')
    }
  }
}

export function drag(
  node: HTMLElement,
  { direction, threshold, maxDrag = 50 }: DragOptions
): { update: (options: DragOptions) => void; destroy: () => void } {
  const hammer = new Hammer(node)

  hammer.add(new Pan({ direction, threshold }))

  hammer.on('pan', (ev: HammerInput) => {
    const { deltaX, deltaY, deltaTime } = ev

    const beyondMaxDragX = Math.abs(deltaX) > maxDrag
    const beyondMaxDragY = Math.abs(deltaY) > maxDrag

    if (
      !beyondMaxDragY &&
      ((direction === DIRECTION_DOWN && deltaY > 0) ||
        (direction === DIRECTION_UP && deltaY < 0) ||
        direction === DIRECTION_ALL ||
        direction === DIRECTION_VERTICAL)
    ) {
      node.style.top = `${deltaY}px`
    }

    if (
      !beyondMaxDragX &&
      ((direction === DIRECTION_RIGHT && deltaX > 0) ||
        (direction === DIRECTION_LEFT && deltaX < 0) ||
        direction === DIRECTION_ALL ||
        direction === DIRECTION_HORIZONTAL)
    ) {
      node.style.top = `${deltaY}px`
    }

    // reset back to position
    if (ev.isFinal) {
      if (deltaTime > 300 || !beyondMaxDragY) {
        node.style.top = '0px'
      }

      if (deltaTime > 300 || !beyondMaxDragX) {
        node.style.left = '0px'
      }
    }
  })

  return {
    update(opt) {
      hammer.get('pan').set(opt)
    },
    destroy() {
      hammer.off('pan')
    }
  }
}

// Svelte action to use when wanting to do something when there is a click outside of element
export function clickOutside(element: HTMLElement, callbackFunction: () => void) {
  function onClick(event: MouseEvent) {
    if (!element.contains(event.target as HTMLElement)) {
      callbackFunction()
    }
  }

  document.body.addEventListener('click', onClick)

  return {
    update(newCallbackFunction: () => void) {
      callbackFunction = newCallbackFunction
    },
    destroy() {
      document.body.removeEventListener('click', onClick)
    }
  }
}

// browsers use different event names and hidden properties
export function getPageVisibilityParams(): { hidden: string; visibilityChange: string } {
  // Opera 12.10 and Firefox 18 and later support
  if (typeof document.hidden !== 'undefined') {
    return {
      hidden: 'hidden',
      visibilityChange: 'visibilitychange'
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
  } else if (typeof document.msHidden !== 'undefined') {
    return {
      hidden: 'msHidden',
      visibilityChange: 'msvisibilitychange'
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
  } else {
    return {
      hidden: 'webkitHidden',
      visibilityChange: 'webkitvisibilitychange'
    }
  }
}

// https://github.com/date-fns/date-fns/blob/9bb51691f201c3ec05ab832acbc5d478f2e5c47a/docs/i18nLocales.md
const locales: Record<string, Locale> = {
  'en-GB': enGB, // British English
  'en-US': enUS, // American English
  'zh-CN': zhCN, // Chinese (mainland)
  es, // Spanish
  hi, // Hindi
  ar, // Arabic
  bn, // Bengali
  fr, // French
  pt, // Portuguese
  ru, // Russian
  ja, // Japanese
  id, // Indonesian
  de, // German
  te, // Telugu
  tr, // Turkish
  ta, // Tamil
  ko // Korean
}

export function formatDate(options: { date: string; language: string; type?: 'relative' }) {
  const { date, language, type = 'relative' } = options

  const settingsLocale =
    Object.keys(Language)[Object.values(Language).indexOf(language as Language)]

  const locale = locales[settingsLocale] || enGB

  if (type === 'relative') {
    return formatRelative(new Date(date), new Date(), { locale })
  }
}

export function formatCountdown(options: { date: Date; language: string }) {
  const { date, language } = options

  const settingsLocale =
    Object.keys(Language)[Object.values(Language).indexOf(language as Language)]

  const locale = locales[settingsLocale] || enGB

  return formatDistanceToNowStrict(date, { locale, addSuffix: true })
}

export function formatDestination(destination: string, type: PaymentType): string {
  switch (type) {
    case 'payment_request':
    case 'node_public_key':
      return truncateValue(destination)
    default:
      return destination
  }
}

export const userAgent = new UAParser(navigator.userAgent)

export function getCredentialsFromStorage(): CoreLnCredentials | null {
  const credentialsJson = localStorage.getItem('credentials')

  return credentialsJson ? JSON.parse(credentialsJson) : null
}

export const load: Load = async () => {
  const credentials = credentials$.getValue()

  if (!credentials.connection) {
    return {
      redirect: '/welcome',
      status: 302
    }
  }
}

// limited to offchain funds for the moment
export const calculateBalance = (funds: ListfundsResponse): string => {
  const offChain = funds.channels.reduce(
    (total, { our_amount_msat }) => total.add(our_amount_msat),
    Big('0')
  )

  // const onChain = funds.outputs.reduce((total, { amount_msat }) => total.add(amount_msat), Big('0'))

  // return offChain.add(onChain).toString()
  return offChain.toString()
}

export const sortPaymentsMostRecent = (payments: Payment[]): Payment[] =>
  payments.sort((a, b) => {
    return (
      new Date(b.completedAt || b.startedAt).getTime() -
      new Date(a.completedAt || a.startedAt).getTime()
    )
  })

export function validateConnectionString(connect: string): boolean {
  const [publicKey, host] = connect.split('@')
  if (!publicKey || !host) return false

  const [ip, port] = host.split(':')
  if (!ip || !port) return false

  const portNumber = parseInt(port)
  if (portNumber < 1 || portNumber > 65535) return false

  if (!publicKey.match(nodePublicKeyRegex)) return false
  if (!ip.match(ipRegex)) return false

  return true
}

/** Tries to get exchange rates from Coingecko first, if that fails then try Coinbase */
export async function getBitcoinExchangeRate(): Promise<BitcoinExchangeRates | null> {
  try {
    const coinGecko = await fetch(COIN_GECKO_PRICE_ENDPOINT).then((res) => res.json())
    return coinGecko.bitcoin
  } catch (error) {
    try {
      const coinbase: { data: { rates: BitcoinExchangeRates } } = await fetch(
        COINBASE_PRICE_ENDPOINT
      ).then((res) => res.json())

      return Object.entries(coinbase.data.rates).reduce((acc, [key, value]) => {
        acc[key.toLowerCase() as keyof BitcoinExchangeRates] = value
        return acc
      }, {} as BitcoinExchangeRates)
    } catch (error) {
      return null
    }
  }
}

export const noop = () => {}

export function deriveLastPayIndex(payments: Payment[]): number {
  return payments.length
    ? payments.reduce((currentHighestIndex, { payIndex }) => {
        return payIndex && payIndex > currentHighestIndex ? payIndex : currentHighestIndex
      }, 0)
    : 0
}

export function isPWA(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
}
