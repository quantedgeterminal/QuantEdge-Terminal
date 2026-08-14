import pino from 'pino'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// Two WS subscriptions on one account and writing book_updates/arrivals — T020.
log.info('collector scaffold: nothing to collect yet')
