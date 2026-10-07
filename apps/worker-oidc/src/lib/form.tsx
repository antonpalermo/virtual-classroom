import { Field, FieldError, FieldLabel } from '@capstone/ui/components/field'
import { Input } from '@capstone/ui/components/input'
import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import type { ComponentProps, ReactNode } from 'react'

const { fieldContext, formContext, useFieldContext } = createFormHookContexts()

// Reusable `<form.AppField>` child: label (+ optional aside, e.g. a link) + input + validation errors.
function TextField({ label, aside, ...props }: { label: string; aside?: ReactNode } & ComponentProps<typeof Input>) {
    const field = useFieldContext<string>()
    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
    return (
        <Field data-invalid={invalid}>
            <div className="flex items-center justify-between">
                <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
                {aside}
            </div>
            <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={event => field.handleChange(event.target.value)}
                aria-invalid={invalid}
                {...props}
            />
            {invalid && <FieldError errors={field.state.meta.errors} />}
        </Field>
    )
}

export const { useAppForm } = createFormHook({ fieldContext, formContext, fieldComponents: { TextField }, formComponents: {} })
