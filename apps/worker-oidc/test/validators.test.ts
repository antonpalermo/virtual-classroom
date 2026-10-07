import { describe, it } from 'vitest'
import type { z } from 'zod'
import { emailSchema, passwordSchema } from '../src/lib/validators.js'

const message = (schema: z.ZodType, value: string) => schema.safeParse(value).error?.issues[0]?.message

describe('emailSchema', () => {
    it('accepts a valid email', ({ expect }) => {
        expect(emailSchema.safeParse('student@example.com').success).toBe(true)
    })

    it('rejects an empty email as required', ({ expect }) => {
        expect(message(emailSchema, '  ')).toBe('Email is required')
    })

    it('rejects a malformed email', ({ expect }) => {
        expect(message(emailSchema, 'not-an-email')).toBe('Enter a valid email address')
    })
})

describe('passwordSchema', () => {
    it('accepts any non-empty password', ({ expect }) => {
        expect(passwordSchema.safeParse('x').success).toBe(true)
    })

    it('rejects an empty password', ({ expect }) => {
        expect(message(passwordSchema, '')).toBe('Password is required')
    })
})
