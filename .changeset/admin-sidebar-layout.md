---
'@capstone/admin': minor
'@capstone/ui': minor
---

Add an app shell to worker-admin: an inset sidebar with a Users link, a header with the sidebar toggle and a user menu (email + sign out), and a rounded content panel. `/users`' create form moves into a dialog built with TanStack Form and the shared field components, role pickers (dialog and table) use the shared `Select`, and the users list is a TanStack Table `DataTable`. `@capstone/ui` gains the shadcn `sidebar`, `sheet`, `tooltip`, `skeleton`, `dropdown-menu`, `avatar`, `dialog`, `select` and `table` components and the `use-mobile` hook.
