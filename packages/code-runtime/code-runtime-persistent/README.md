# Persistent Code Runtime

CPython implementation of the `ctx.codeRuntime` service. It keeps one interpreter per agent session, so Python variables can be reused across sequential Code Mode programs. It does not persist arbitrary interpreter globals across DSH restarts; use the durable history or another host store for restart-durable data.

## Configuration

- `runTimeoutMs`: positive program wall-time limit in milliseconds; defaults to 120000. A timed-out interpreter is terminated.

## Isolation and limits

The kernel is a subprocess with the same process privileges as DSH; persistence is a convenience feature, not a security boundary. Sessions receive separate kernels. Disposing the provider terminates and waits for every kernel. The backend reports the Python SDK language and `persistent-process` substrate.

The package exports the Service provider class as its default export. Mount it as an alternative to—not alongside—another `codeRuntime` provider.

## Known Limitations and Deferred Work

- Session variables exist only in the live interpreter and disappear after runtime or DSH restart.
- Python code executes with the host user's process privileges; do not run untrusted programs in this backend.
