# autoAllianceLogo - manual

## Images

Put one image per alliance into `mods/autoAllianceLogo/logo/`:

```
99000001.png
99000001.jpg
99000001.jpeg
```

* The file name is the alliance id; nothing is renamed and no list file is needed.
* PNG or JPEG. A PNG is published as-is; a JPEG is decoded and re-encoded as PNG.
* At most **1280 x 1280**. Larger images are scaled down to fit (the log says
  `scaled down`); they are not rejected.
* Replace an image by overwriting the same file. A new or changed file is applied
  within about a second; the folder is also re-checked every minute.
* Only alliance logos can be customised in the game; corporation logos are
  generated from their ticker and are not handled.

The published result is `<allianceID>_32.png` … `<allianceID>_1024.png` under
`EVEJS_DATA_ROOT/gameStore/images/Alliance/`, which is exactly what the image
service serves to clients.

## Commands (staff)

```
/alogo flush                 rescan logo/ and republish every image now
/alogo delete <allianceID>   remove the published logo and its source image
/alogo help                  usage
```

* `flush` forces a republish even when the file content has not changed.
* `delete` removes all six published files for that alliance and the source image,
  so the default logo is served again and the next scan does not bring it back.
* Both answer in chat and are limited to accounts with the staff view role.

## Seeing the change in the client

The image service sends `Cache-Control: public, max-age=300` for images
(upstream). The server files are current immediately, but a client that already
loaded the old texture shows it until the five-minute window has passed, the
alliance window is reopened after that, or the client relogs. A server-side mod
cannot invalidate a texture that a running client already holds.

## Troubleshooting

| Symptom | Check |
|---|---|
| No `[autoAllianceLogo]` boot line | preload missing: run the installer, then `docker compose build init` / restart |
| `alliance <id>: ... not a PNG or JPEG` | the file is not really an image; re-export it |
| Nothing changes in game | wait five minutes / relog; confirm the six files exist in the runtime image store |
| `/alogo` says "staff command" | the account lacks the staff view role |
| A typo'd alliance id | it publishes files nothing requests; `/alogo delete <id>` cleans them up |
