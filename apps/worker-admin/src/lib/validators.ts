import { z } from 'zod'

export const ROLES = ['user', 'admin'] as const

// Same rules the old form got from the browser: `required` name, `type="email"` + `required` email.
export const nameSchema = z.string().min(1, 'Name is required')
export const emailSchema = z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email address'))

// TanStack Form accepts Zod (Standard Schema) directly; validates on blur, then again on submit.
export const validateWith = (schema: z.ZodType<unknown, string>) => ({ onBlur: schema, onSubmit: schema })
