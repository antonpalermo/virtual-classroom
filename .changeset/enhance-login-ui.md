---
"@capstone/ui": minor
"@capstone/client": patch
---

feat(ui): add card component for layout composition

- export Card, CardContent, CardHeader, CardFooter, CardTitle, CardDescription, CardAction subcomponents from shadcn registry

feat(client): enhance login page with split-layout card design

- restyle login route to match shadcn login-04 block layout
- add Card wrapper with responsive grid layout (single column mobile, two columns desktop)
- display "Welcome back" heading and sign-in button on left; gradient placeholder panel on right
- include terms-of-service footer text
- preserve existing PKCE/OIDC redirect behavior
