import { Field, FieldError, FieldLabel } from '@capstone/ui/components/field'
import { Input } from '@capstone/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@capstone/ui/components/select'
import { createFormHook, createFormHookContexts } from '@tanstack/react-form'
import type { ComponentProps } from 'react'

const { fieldContext, formContext, useFieldContext } = createFormHookContexts()

// Reusable `<form.AppField>` child: label + input + validation errors.
function TextField({ label, ...props }: { label: string } & ComponentProps<typeof Input>) {
    const field = useFieldContext<string>()
    const invalid = field.state.meta.isTouched && !field.state.meta.isValid
    return (
        <Field data-invalid={invalid}>
            <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
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

function SelectField({ label, options }: { label: string; options: readonly string[] }) {
    const field = useFieldContext<string>()
    return (
        <Field>
            <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
            <Select value={field.state.value} onValueChange={value => value && field.handleChange(value)}>
                <SelectTrigger id={field.name} onBlur={field.handleBlur} className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map(option => (
                        <SelectItem key={option} value={option}>
                            {option}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    )
}

export const { useAppForm } = createFormHook({ fieldContext, formContext, fieldComponents: { TextField, SelectField }, formComponents: {} })
