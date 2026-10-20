# How autoLogo works

One loader for two image kinds. Alliance ids and corporation ids live in separate
ranges and never collide, so one `logo/<id>.png|jpg|jpeg` folder can hold both;
every source is published to both image paths and the request path decides which
one a client sees.

## 1. Registration

```
docker/entrypoint.sh   --require /app/mods/autoLogo/loader.js
StartServer.bat        NODE_OPTIONS=%NODE_OPTIONS% --require=.../loader.js
```

Two kinds of process load it:

* the **game server** (`node .` from `server/`), which scans and publishes;
* the **image edge**, forked by the game server with the inherited `--require`
  flags, which installs the corporation resolver wrapper.

The scanner is gated to the game server process (`argv[1] == <root>/server`), so
only one process writes files.

## 2. One folder, two destinations

`mods/autoLogo/logo/` is bind-mounted from the host. A scan decodes each source
once and renders the six square sizes (32 … 1024, aspect preserved, transparent
padding). The rendered PNGs are written to:

* `EVEJS_DATA_ROOT/gameStore/images/Alliance/<id>_<size>.png` through the vendor's
  `allianceImageStore.storeAllianceLogo` (one call per size);
* `EVEJS_DATA_ROOT/corporation-logo/<id>_<size>.png` for the corporation side.

The copy nothing requests is inert. The command layer reads `alliances` and
`corporations` from the gameStore **at command time** and uses the sets to
classify ids, warn about ids that are neither, and refuse a `delete` on the wrong
kind.

## 3. Serving corporations

`lib/resolver.js` wraps `server/src/_secondary/image/imageRequestResolver.js` when
the image edge requires it. `matchCorporationLogo` recognises
`/Corporation/<id>_<size>.png`, `/Corporation/<id>.png` and
`/corporations/<id>/logo?size=...`; a published file wins (`findPublished` falls
back to the largest available size), everything else goes to the original
resolver. No source file is modified on disk.

## 4. No commands

There is no chat command. The folder is the interface:

* a new or changed `<id>.png|jpg|jpeg` is published within about a second;
* deleting or renaming the source removes both published sets (alliance store
  paths and the corporation files), because the mod keeps a small state file
  `corporation-logo/.autoLogo-state.json` listing the ids *it* published and their
  source hashes. Only those ids are ever removed - files another tool put into the
  alliance folder are never touched.
## 5. Client cache

The image service sends `Cache-Control: public, max-age=300`, but the EVE client
also keeps its own texture cache and may keep an old logo much longer. A replaced
logo therefore sometimes needs the client image cache cleared
(`%LOCALAPPDATA%\\CCP\\EVE\\...`) or a fresh client; the server files are already
current and a direct request returns the new bytes.

## 6. Failure behaviour

* A bad image is skipped with a log line naming the file and the reason.
* A failed render or write is logged; previous files stay.
* If a future build changes the resolver, the wrapper stops matching and the
  vendor behaviour returns.
* The mod never touches the chat dispatcher or the slash command list; it is
  purely a file watcher plus the image-edge resolver wrapper.

## 7. Tests

`node test/run.js` covers image parsing, square rendering with padding, request
matching, dual publishing (alliance store calls + corporation files), wrong names,
unchanged/force behaviour, size fallback, the completed-removal delete helpers, the
state round-trip and the resolver wrapper.
