import { onDestroy } from 'svelte'
import type { Invoice } from './@types/invoices.js'
import type { Session } from './@types/session.js'
import type { BitcoinExchangeRates, Settings } from './@types/settings.js'
import { DEFAULT_SETTINGS } from './constants.js'
import { getDataFromStorage, STORAGE_KEYS, writeDataToStorage } from './storage.js'
import type { ConnectionInterface } from './connections/interfaces.js'
import { liveQuery } from 'dexie'
import { db } from './db.js'
import type { AppError } from './@types/errors.js'

import {
  BehaviorSubject,
  defer,
  filter,
  from,
  Observable,
  scan,
  shareReplay,
  startWith,
  Subject,
  take
} from 'rxjs'
import { log$, logger } from './logs.js'
import { SvelteSubject } from './svelte.js'

export const session$ = new BehaviorSubject<Session | null>(null)
export const checkedSession$ = new BehaviorSubject<boolean>(false)

/** A list of connection info stored in the db */
export const storedConnections$ = from(liveQuery(() => db.connections.toArray())).pipe(
  startWith([]),
  shareReplay(1)
)

export const errors$ = new Subject<AppError>()

/** A list of interfaces for each initialized connection */
export const connections$ = new BehaviorSubject<ConnectionInterface[]>([])

type ConnectionErrors = Record<ConnectionInterface['info']['connectionId'], AppError[]>

/** A collection of the last 10 errors for each connectionId */
export const connectionErrors$: Observable<ConnectionErrors> = errors$.pipe(
  filter((error) => error.key.startsWith('connection_')),
  scan((acc, value) => {
    const { connectionId } = value.detail

    if (!connectionId) {
      logger.warn(`Connection error that does not have a connection id: ${JSON.stringify(value)}`)
      return acc
    }

    if (!acc[connectionId]) {
      acc[connectionId] = []
    }

    const errors = acc[connectionId]
    errors.push(value)

    /** keep the last 10 errors only, truncate if longer */
    errors.length = Math.min(errors.length, 10)

    return acc
  }, {} as ConnectionErrors),
  shareReplay(1),
  startWith({})
)

// when svelte component is destroyed
export const onDestroy$ = defer(() => {
  const subject = new Subject<void>()
  onDestroy(() => {
    subject.next()
  })
  return subject.asObservable().pipe(take(1))
})

// the last url path
export const lastPath$ = new BehaviorSubject('')

// current bitcoin exchange rates
export const bitcoinExchangeRates$ = new BehaviorSubject<BitcoinExchangeRates | null>(null)

// all payment update events
export const paymentUpdates$ = new Subject<Invoice>()

const storedSettings = getDataFromStorage(STORAGE_KEYS.settings)

// app settings
export const settings$ = new SvelteSubject<Settings>({
  ...DEFAULT_SETTINGS,
  ...(storedSettings ? JSON.parse(storedSettings) : {})
})

// updates settings in storage and handles dark mode toggle
settings$.pipe(filter((x) => !!x)).subscribe((update) => {
  try {
    writeDataToStorage(STORAGE_KEYS.settings, JSON.stringify(update))
  } catch (error) {
    logger.error('Could not save settings to storage, access to local storage denied')
  }
})

export const recentLogs$: Observable<string[]> = log$.pipe(
  scan((allLogs, newLog) => {
    if (newLog === 'CLEAR_ALL_LOGS') return []

    allLogs.push(newLog)

    while (allLogs.length > 50) {
      allLogs.shift()
    }

    return allLogs
  }, [] as string[]),
  shareReplay(1),
  startWith([])
)

// subscribe to ensure that we start collecting logs
recentLogs$.subscribe()
