# @deepseek-ai/dsh-client-ui-gl-seats

English | [中文](README.zh.md)

Golden Land browser surfaces for the DeepSeek Harness Web shell.

The package contributes one occupant to `sidebar.footer.action`. It renders the `Проекты` and `Дизайн` rows with the sidebar owner's expanded or rail state.

`Проекты` opens a local popover backed by `http://127.0.0.1:3181/api/projects`. `Дизайн` temporarily shadows the `details` slot at a lower priority, so the panel uses the native details grid track, resize handle, width concessions, and close lifecycle. Releasing the shadow restores the shipped tool-details occupant.

## Model Experience

None, as the browser-side Golden Land navigation and preview surfaces register nothing model-facing.

#### KV Cache effect

None. Browser-only state never enters model history.

## Known Limitations and Deferred Work

- **Session-scoped Design** — the Design row is disabled while the current session is blank because `details` has session scope.
- **Loopback dependency** — the project registry and design catalog depend on the Golden Land ledger service at port 3181.
- **Read-only projects** — the project popover does not mutate the registry; project mutation remains tool-owned.
