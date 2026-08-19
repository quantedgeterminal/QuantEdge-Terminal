import { customType } from 'drizzle-orm/pg-core'

/**
 * `bytea` is absent as a built-in type in drizzle-orm 0.45. postgres.js returns
 * `Buffer` (a `Uint8Array` subclass) and accepts `Uint8Array` on input.
 */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea'
  },
})
