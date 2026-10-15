# @capstone/ui

## 0.2.0

### Minor Changes

- 287def5: Add an app shell to worker-admin: an inset sidebar with a Users link, a header with the sidebar toggle and a user menu (email + sign out), and a rounded content panel. `/users`' create form moves into a dialog built with TanStack Form and the shared field components, role pickers (dialog and table) use the shared `Select`, and the users list is a TanStack Table `DataTable` with a row actions menu and a confirm modal and success/error toasts for deletes. `@capstone/ui` gains the shadcn `sidebar`, `sheet`, `tooltip`, `skeleton`, `dropdown-menu`, `avatar`, `dialog`, `alert-dialog`, `select`, `table` and `sonner` components and the `use-mobile` hook.

## 0.1.0

### Minor Changes

- 05cd822: Add `@capstone/ui` shared shadcn/ui package (Base UI, Tailwind v4) and wire it into the client, admin, and oidc apps.
