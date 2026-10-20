# autoLogo - manual

## Images

Put one image per entity into `mods/autoLogo/logo/`:

```
99000001.png     alliance 99000001
98000001.jpg     corporation 98000001
98000002.jpeg
```

* The file name is the entity id; nothing is renamed and no list file is needed.
* Alliance ids and corporation ids never collide, so one folder serves both.
* PNG or JPEG; the mod renders the six square sizes (32 … 1024), preserving the
  aspect ratio and padding with transparency.
* At most **1280 x 1280**; larger images are scaled down to fit.
* Replace an image by overwriting the same file. A new or changed file is applied
  within about a second; the folder is re-checked every minute.

Published files:

* alliance: `EVEJS_DATA_ROOT/gameStore/images/Alliance/<id>_<size>.png`
* corporation: `EVEJS_DATA_ROOT/corporation-logo/<id>_<size>.png`

## Removing a logo

Delete (or rename) the source image; the next scan removes both published copies
(alliance store files and the corporation files) and the default logo is served
again. Nothing else is needed - there is no command.
## Seeing the change in the client

The image service sends `Cache-Control: public, max-age=300` for images
(upstream). The server files are current immediately, but a client that already
loaded the old texture shows it until the five-minute window has passed or the
client relogins. A server-side mod cannot invalidate a texture that a running
client already holds.

## Troubleshooting

| Symptom | Check |
|---|---|
| No `[autoLogo]` boot line | preload missing: run the installer, rebuild/restart |
| `... not a PNG or JPEG` | the file is not really an image; re-export it |
| Nothing changes in game | wait five minutes / relog; confirm the published files exist |
| `/alogo` says "staff command" | the account lacks the staff view role |
| `id ... matches neither an alliance nor a corporation` | typo in the file name |
