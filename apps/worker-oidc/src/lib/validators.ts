import { z } from 'zod'

export const emailSchema = z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email address'))
export const passwordSchema = z.string().min(1, 'Password is required')

// Reusable for any form field: `<form.AppField validators={validateWith(schema)}>`.
// TanStack Form accepts Zod (Standard Schema) directly; validates on blur, then again on submit.
export const validateWith = (schema: z.ZodType<unknown, string>) => ({ onBlur: schema, onSubmit: schema })
