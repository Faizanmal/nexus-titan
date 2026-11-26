# Phase 00 evidence

Commands were run in the repository root on Windows PowerShell, 2026-11-14 (Asia/Calcutta).

```text
git status --short --branch
fatal: not a git repository (or any of the parent directories): .git
exit: 128
```

```text
pnpm create next-app@latest --help
Usage: create-next-app [directory] [options]
--ts --tailwind --eslint --app --src-dir --use-pnpm supported
exit: 0
```

```text
pnpm create next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --use-pnpm --yes --disable-git --import-alias '@/*'
Creating a new Next.js app in ...\apps\web.
Using pnpm. Initializing project with template: app tw
Resolved next 16.4.6, react/react-dom 19.3.0
ERR_PNPM_META_FETCH_FAIL: GET https://registry.npmjs.org/pnpm: fetch failed
ECONNREFUSED for registry.npmjs.org packages
exit: 1
```

```text
uv init / uv add / uv sync
error: failed to open file ...\uv\cache\sdists-v9\.git: Access is denied. (os error 5)
exit: 1
```

Hardware inventory: Windows OS version and 4 logical processors obtained. WMI RAM/CPU model calls returned Access denied; RAM left unmeasured. Workspace drive showed about 9 GB available. No credentials were inspected or included.

## Completed acceptance checks

```text
pnpm install
Done in 1m 13.8s using pnpm v11.18.0
exit: 0
```

```text
pnpm -r lint
packages/contracts lint: Done
apps/web lint: Done
exit: 0
```

```text
pnpm -r typecheck
packages/contracts typecheck: Done
apps/web typecheck: Done
exit: 0
```

```text
pnpm --filter @nexus-titan/web build
Next.js 16.4.5; Compiled successfully; Finished TypeScript; generated 4/4 static pages
exit: 0
```

```text
uv sync --project services/api
Installed 28 packages; generated services/api/uv.lock
exit: 0
```

```text
uv run --project services/api pytest -s
GET /health -> 200 {'status': 'ok', 'service': 'nexus-titan-api'}
1 passed, 1 warning in 25.96s
exit: 0
```

```text
pnpm -r test
health contract JSON roundtrip: 1 passed, 0 failed
exit: 0
```

```text
docker compose --profile core --profile distributed --profile graph --profile observe config
All declared services rendered; published ports use host_ip 127.0.0.1
exit: 0
```

The test warning is Starlette's deprecation warning about using `httpx` through its current `TestClient` integration. Docker services were not started; only Compose configuration was validated. The first lint/typecheck/test attempts found configuration issues and were rerun after fixes; only the final passing outcomes above are acceptance results.
