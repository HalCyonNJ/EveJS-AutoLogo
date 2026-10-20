# autoAllianceLogo - installer

```powershell
node install.js --server "D:\path\to\EveJS"
node install.js --server "D:\path\to\EveJS" --dry-run
node install.js --server "D:\path\to\EveJS" --docker-only
node install.js --server "D:\path\to\EveJS" --native-only
node install.js --status --server "D:\path\to\EveJS"
```

`install.bat` runs the same file with the usual header and pauses at the end.

## What it changes

| Deployment | File | Change |
|---|---|---|
| Docker | `docker/entrypoint.sh` | one `--require /app/mods/autoAllianceLogo/loader.js` per launch block (idempotent) |
| Docker | `.dockerignore` | `!mods/` + `!mods/**` so the image actually contains `mods/` |
| Docker | `compose.yaml` | `- ./mods/autoAllianceLogo/logo:/app/mods/autoAllianceLogo/logo` (writable: `/alogo delete` removes the source image) |
| Native | `StartServer.bat` | a guarded block that appends `--require=.../loader.js` to `NODE_OPTIONS` |

Every file that changes is copied into `_autoalliancelogobackup\<timestamp>\`
first. The logo images are never touched by an install: the mod's own files are
replaced, `logo/` is kept.

When both deployments are found (a checkout with `docker/entrypoint.sh` and
`StartServer.bat`), both are registered; use `--docker-only` or `--native-only`
to pin one.

## After installing (Docker)

```bash
docker compose build init
docker compose up -d --no-deps server
```

Confirm the boot line `[autoAllianceLogo] v1.0.0 active - /app/mods/autoAllianceLogo/logo`.

## Uninstall

```powershell
node uninstall.js --server "D:\path\to\EveJS"
node uninstall.js --server "D:\path\to\EveJS" --dry-run
node uninstall.js --server "D:\path\to\EveJS" --purge-logos
```

Removes the preloads, the compose volume and the mod files; `logo/` is kept
unless `--purge-logos` is given. Rebuild the image afterwards on Docker.

## Status

`--status` reports the mod folder, the number of Docker preload lines, the
compose volume, the native preload block and the images currently in `logo/`.

## Exit codes

`0` success (including "already installed"), `1` failure, `2` missing `--server`.
