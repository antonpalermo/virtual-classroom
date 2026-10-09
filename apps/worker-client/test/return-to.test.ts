import { beforeEach, describe, expect, it } from 'vitest'
import { takeReturnTo } from '../src/lib/auth-client'

const store = new Map<string, string>()
globalThis.sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key)
} as unknown as Storage

describe('takeReturnTo', () => {
    beforeEach(() => store.clear())

    it('returns a stashed same-origin path once', () => {
        store.set('oidc_return_to', '/room?id=abc')
        expect(takeReturnTo()).toBe('/room?id=abc')
        expect(takeReturnTo()).toBe('/')
    })

    it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)'])('falls back to / for %s', value => {
        store.set('oidc_return_to', value)
        expect(takeReturnTo()).toBe('/')
    })
})
