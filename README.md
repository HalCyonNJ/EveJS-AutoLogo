# autoLogo

One mod for both customisable entity logos: **alliances** and **corporations**.
Drop an image named after the entity id into one folder - alliance ids and
corporation ids never collide, so a single folder serves both.

```
mods/autoLogo/logo/99000001.png     (alliance)
mods/autoLogo/logo/98000001.jpg     (corporation)
mods/autoLogo/logo/98000002.jpeg
```

* PNG or JPEG, up to **1280 x 1280**; larger images are scaled down to fit.
* Every source is rendered into the six square sizes the image service asks for
  (32, 64, 128, 256, 512, 1024), aspect preserved, transparent padding.
* Alliance files go through the vendor's own `allianceImageStore`; corporation
  files are served by wrapping the image edge's resolver in memory. **No EveJS
  source file is edited.**
* The folder is watched (about a second) and re-checked every minute.
* The image service caches an image for **five minutes**; reconnect (or wait) to
  see a replaced logo.

## Install

```powershell
node installer/install.js --server "D:\path\to\EveJS"
node installer/install.js --server "D:\path\to\EveJS" --docker-only
node installer/install.js --status --server "D:\path\to\EveJS"
```

The installer registers the preload (Docker entrypoint and/or `StartServer.bat`),
keeps `mods/` in the `.dockerignore` allowlist and adds the logo bind mount:

```yaml
- ./mods/autoLogo/logo:/app/mods/autoLogo/logo
```

Then rebuild once on Docker:

```bash
docker compose build init
docker compose up -d --no-deps server
```

`installer\uninstall.js` reverses the registration and keeps `logo/` unless
`--purge-logos` is given. Details: [installer/README.md](installer/README.md).

## Changing a logo

There are no commands; the folder is the whole interface:

| Action | Result |
|---|---|
| drop `<id>.png|jpg|jpeg` | published to both paths within about a second |
| overwrite the file | new bytes are published (hash change detected) |
| delete or rename the file | both published copies are removed |

The mod keeps its own small state file (`corporation-logo/.autoLogo-state.json`) so
"source removed" also removes the published files after a restart; it only ever
touches ids it published itself. Ignored files (wrong name, not a real image) are
logged once per sweep.
## How it works

The game server process renders and publishes; the image edge runs in a child
process forked from the game server and inherits this mod's preload, so it wraps
`resolveImageRequest` in memory. A request for a corporation with a published
file is answered from that file, and everything else falls through to the vendor
resolver. Alliance logos use the vendor's existing file-backed store.

## Boot line

```
[autoLogo] v1.0.0 active - /app/mods/autoLogo/logo -> /var/lib/evejs/corporation-logo

```

## Tests

```
node test/run.js
```
