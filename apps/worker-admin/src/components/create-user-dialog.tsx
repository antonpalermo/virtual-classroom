import { Button } from '@capstone/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@capstone/ui/components/dialog'
import { FieldGroup } from '@capstone/ui/components/field'
import { useState } from 'react'
import { useAppForm } from '../lib/form'
import { emailSchema, nameSchema, ROLES, validateWith } from '../lib/validators'

export interface NewUser {
    name: string
    email: string
    role: string
}

// onCreate resolves to an error message, or null on success (which clears the form and closes the dialog).
// On failure the dialog stays open with the typed values kept, so the admin can correct and resubmit.
export function CreateUserDialog({ onCreate }: { onCreate: (user: NewUser) => Promise<string | null> }) {
    const [open, setOpen] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const form = useAppForm({
        defaultValues: { name: '', email: '', role: 'user' } as NewUser,
        // Otherwise one field's blur error blocks handleSubmit before it validates (and reveals errors on)
        // the fields the admin never touched. onSubmit still only runs once every field is valid.
        canSubmitWhenInvalid: true,
        onSubmit: async ({ value, formApi }) => {
            setError(null)
            const failure = await onCreate(value)
            if (failure) {
                setError(failure)
                return
            }
            formApi.reset()
            setOpen(false)
        }
    })

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                setOpen(next)
                setError(null)
            }}
        >
            <DialogTrigger render={<Button />}>Create</DialogTrigger>
            <DialogContent>
                <form
                    noValidate
                    onSubmit={event => {
                        event.preventDefault()
                        form.handleSubmit()
                    }}
                    className="flex flex-col gap-4"
                >
                    <DialogHeader>
                        <DialogTitle>Create user</DialogTitle>
                    </DialogHeader>
                    <FieldGroup>
                        <form.AppField name="name" validators={validateWith(nameSchema)}>
                            {field => <field.TextField label="Name" type="text" />}
                        </form.AppField>
                        <form.AppField name="email" validators={validateWith(emailSchema)}>
                            {field => <field.TextField label="Email" type="email" />}
                        </form.AppField>
                        <form.AppField name="role">{field => <field.SelectField label="Role" options={ROLES} />}</form.AppField>
                    </FieldGroup>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <DialogFooter>
                        <Button type="submit">Create user</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
