# How autoAllianceLogo works

Alliance logos are the one image retail lets a player customise (corporations are
generated from their ticker). EveJS already has a file-backed path for them: the
image service reads `<allianceID>_<size>.png` from the runtime image store, and
the bundled ConfigEditor imports those files for an operator. This mod automates
the "drop a file" half of that path.

## 1. Registration

`loader.js` is a preload, the same shape as the other loader mods:

```
docker/entrypoint.sh   --require /app/mods/autoAllianceLogo/loader.js
StartServer.bat        NODE_OPTIONS=%NODE_OPTIONS% --require=.../loader.js
```

It runs before the game server, does its work on the main thread only, and never
touches `gameStore` (requiring the database this early stalls startup - the mod
deliberately does not need it).

## 2. The folder is the interface

`mods/autoAllianceLogo/logo/` is bind-mounted from the host, so the operator can
add, replace or remove images without rebuilding the image. The file name is the
alliance id:

```
99000001.png     99000001.jpg     99000001.jpeg
```

Nothing is renamed and there is no index file. The folder is watched
(`fs.watch`, 1 s debounce) and also swept every minute; unchanged files are
skipped by the SHA-256 of the converted PNG.

## 3. Validation and conversion

`lib/imageInfo.js` reads the pixel size without decoding (PNG `IHDR` header, JPEG
`SOF` markers). `lib/convert.js` then:

* publishes a PNG byte for byte when it fits;
* decodes and re-encodes a JPEG as PNG (the image service always serves
  `image/png`, whatever the source format);
* scales anything larger than 1280 x 1280 down to fit with bilinear filtering on
  the RGBA buffer. No native dependency: `jpeg-js` and `pngjs` are vendored
  pure-JS libraries.

Invalid files (not a real PNG/JPEG, unreadable, undecodable) are logged and
skipped; one bad file never stops the scan or the server.

## 4. Publishing

The bytes go through the vendor's own
`server/src/services/corporation/allianceImageStore.js#storeAllianceLogo`, the
same function the ConfigEditor uses. It writes
`<allianceID>_32.png` … `<allianceID>_1024.png` into
`EVEJS_DATA_ROOT/gameStore/images/Alliance/` (the `evejs-data` volume in Docker),
atomically. The image service picks the files up on its next request; nothing is
restarted and no game table is written.

## 5. Commands

`/alogo` rides on the vendor's `executeChatCommand` through a `Module._load`
overlay, like the other loader mods. It is staff-only (`hasStaffDebugRole`) and
answers in chat:

| Command | Effect |
|---|---|
| `/alogo flush` | rescan `logo/` and republish every image now, even when the hash is unchanged |
| `/alogo delete <allianceID>` | remove the six published files and the source image; the default logo is served again |
| `/alogo help` | usage |

Every scan records the files it could not use (wrong name, unknown alliance id,
not a real PNG/JPEG); the next `/alogo` reply appends them as a warning block with
the file name and the reason. The alliance list is only read at command time, when
the server has long finished loading, never during the preload.

Commands change server files immediately. The image service caches logos for up
to five minutes (`public, max-age=300`, upstream behaviour that this mod does not
change), so a client that already holds the texture displays the new image after
that window or after a relogin. A server-side mod cannot invalidate a client
texture.

## 6. Failure behaviour

* No store: the mod logs an error and stays inactive if the vendor's image store
  cannot be required.
* A bad image is skipped with a log line naming the file and the reason.
* A failed write is logged; the previous file stays in place.
* The chat hook only inspects the chat dispatcher module (resolved by path), so
  it never touches a partial circular export.

## 7. Tests

```
node test/run.js
```

Image parsing (PNG/JPEG sizes, junk), conversion (passthrough, JPEG -> PNG,
oversize scaling), the scanner (valid files, unknown ids, junk, unchanged skip),
and the command parser/overlay (flush, delete, help, staff gate, pass-through).
