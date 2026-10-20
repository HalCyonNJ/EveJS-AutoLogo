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

The image service sends `Cache-Control: public, max-age=300` (upstream), but the
EVE client also maintains its own texture cache and can keep an old logo well past
that window. If a replaced logo does not show up, clear the client image cache
(`%LOCALAPPDATA%\CCP\EVE\...`) or test with a fresh client; the server files are
already current (a direct request returns the new bytes).
## Troubleshooting

| Symptom | Check |
|---|---|
| No `[autoLogo]` boot line | preload missing: run the installer, rebuild/restart |
| `... not a PNG or JPEG` | the file is not really an image; re-export it |
| Nothing changes in game | confirm the published files exist, then clear the client image cache (`%LOCALAPPDATA%\CCP\EVE\...`) or use a fresh client; the EVE texture cache can keep the old logo far longer than the five-minute HTTP cache |
| Deleting the source did not remove the logo | the state file is written after the next sweep; wait a second or check the boot log |
| `id ... matches neither an alliance nor a corporation` | typo in the file name |
