---
'@capstone/admin': minor
'@capstone/ui': minor
---

Add an app shell to worker-admin: an inset sidebar with a Users link, a header with the sidebar toggle and a user menu (email + sign out), and a rounded content panel. `/users`' create form moves into a dialog built with TanStack Form and the shared field components, and role pickers (dialog and table) use the shared `Select`. `@capstone/ui` gains the shadcn `sidebar`, `sheet`, `tooltip`, `skeleton`, `dropdown-menu`, `avatar`, `dialog` and `select` components and the `use-mobile` hook.
