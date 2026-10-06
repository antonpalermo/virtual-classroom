// Reusable TanStack Form field validators: return an error message, or undefined when valid.
export const required =
    (message = 'This field is required') =>
    ({ value }: { value: string }) =>
        value.trim() ? undefined : message

export const email =
    (message = 'Enter a valid email address') =>
    ({ value }: { value: string }) =>
        !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : message

// Runs validators in order, reports the first error.
export const all =
    (...validators: Array<(arg: { value: string }) => string | undefined>) =>
    (arg: { value: string }) => {
        for (const validate of validators) {
            const message = validate(arg)
            if (message) return message
        }
    }
