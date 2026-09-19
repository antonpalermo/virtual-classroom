# @capstone/typescript

## 0.0.1

### Patch Changes

- b71aba3: Centralize worker-client's and worker-admin's Vite/React tsconfig bases into `@capstone/typescript/configs` (`tsconfig.app.json`, `tsconfig.node.json`), removing duplicated compilerOptions and a latent `tsBuildInfoFile` cache-path collision between the two workspaces. worker-admin's passthrough worker now type-checks under the same rules as worker-client's byte-identical one, instead of the stricter Workers-runtime base.
