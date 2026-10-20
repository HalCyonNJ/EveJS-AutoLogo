# autoAllianceLogo

Give any alliance on this server its own logo by dropping an image into this mod's
`logo/` folder. No client patch, no database edit, no renaming: the file name is the
alliance id.

```
mods/autoAllianceLogo/logo/99000001.png
mods/autoAllianceLogo/logo/99000001.jpg
mods/autoAllianceLogo/logo/99000001.jpeg
```

* PNG or JPEG.
* Up to **1280 x 1280**; a larger image is scaled down to fit (the log says so).
* The server publishes `<allianceID>_32.png` … `<allianceID>_1024.png` into the
  runtime image store, which is exactly what the image service serves to clients.
* The folder is watched: a new or replaced image is applied within about a second,
  and the whole folder is re-checked every minute.
* The image service caches a logo for **five minutes**; reconnect (or wait five
  minutes) to see it. A client that was already logged in keeps its old texture.

This is the same file-based path the bundled ConfigEditor uses for alliance logos
(`allianceImageStore.storeAllianceLogo`); the mod only automates "drop file → apply".

Alliance logos are the one customisable entity image in the game; corporation logos
are generated from their ticker and are not touched.

## Install

```powershell
node installer/install.js --server "D:\path\to\EveJS"
node installer/install.js --server "D:\path\to\EveJS" --dry-run
node installer/install.js --status --server "D:\path\to\EveJS"
```

`installer\install.bat` wraps the same file. The installer registers the preload
for both deployments when both are found:

| Deployment | File | Change |
|---|---|---|
| Docker | `docker/entrypoint.sh` | `--require /app/mods/autoAllianceLogo/loader.js` per launch block |
| Docker | `.dockerignore` | `!mods/` + `!mods/**` |
| Docker | `compose.yaml` | `- ./mods/autoAllianceLogo/logo:/app/mods/autoAllianceLogo/logo` |
| Native | `StartServer.bat` | `NODE_OPTIONS` gets the `--require` |

Then rebuild once on Docker:

```bash
docker compose build init
docker compose up -d --no-deps server
```

The logo folder is bind-mounted from the host, so dropping an image after that
needs no rebuild. `installer\uninstall.js` reverses the registration and keeps
`logo/` unless `--purge-logos` is given. Details: [installer/README.md](installer/README.md).
## Boot line

```
[autoAllianceLogo] v1.0.0 active - /app/mods/autoAllianceLogo/logo
[autoAllianceLogo] alliance 99000001: 99000001.png (PNG 512x512) published as PNG 512x512 for sizes 32/64/128/256/512/1024
```

A file that is not really a PNG/JPEG, cannot be read or cannot be written is logged
as an error and skipped; the server keeps running. The alliance id in the file name
is not checked against the database (that would require touching the gameStore
during preload, which stalls startup); an id that does not exist simply publishes
files nothing requests.

## Commands (staff)

```
/alogo flush                 rescan logo/ and republish every logo now
/alogo delete <allianceID>   remove the published logo and its source image
/alogo help
```

`flush` forces the republish even when the file hash is unchanged, and `delete`
removes both the six `<id>_*.png` published files and the `<id>.png|jpg|jpeg`
source image, so the default logo is served again. Both answer in chat; a client
that already loaded the old texture still needs the alliance window reopened or a
relogin to see the change.

Ignored files are never silent: every scan records the files it could not use
(wrong name, unknown alliance id, not really a PNG/JPEG) and the next `/alogo`
reply lists them under `WARNING: N file(s) in logo/ were ignored`, with the file
name and the reason.

The image service answers alliance logos with `Cache-Control: public, max-age=300`
(upstream behaviour, unchanged by this mod). The commands are immediate on the
server; a client picks the new file up on its next image request after that window,
or right away after a relogin. A server-side mod cannot invalidate a client texture
that is already loaded.
## Tests

```
node test/run.js
```
