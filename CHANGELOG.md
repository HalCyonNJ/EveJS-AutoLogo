# Changelog

## 1.1.1 - 2026-10-29

**Compatibility only: re-checked against EveJS 261028.1.**

- Every server file the mod touches is byte-identical in 261028.1:
  `allianceImageStore.js`, `_secondary/image/imageRequestResolver.js`,
  `edge/image/imageEdgeRuntime.js`, `edge/image/imageEdgeProcess.worker.js` and
  `_shared/orderedProcessClient.js`, so the in-memory resolver wrapper and the
  fork inheritance still work unchanged.
- `compatibility.evejsVersions` now lists `261018.1` and `261028.1`.
- No code change, no server source edit.
## 1.1.0 - 2026-10-21

First release, for EveJS 261018.1 (Docker and native loader paths).

- One folder for both image kinds: `logo/<id>.png|jpg|jpeg`, because alliance ids
  and corporation ids never collide.
- Every source is rendered into the six square sizes (32 … 1024) with the aspect
  ratio preserved and transparent padding; images above 1280 x 1280 are scaled
  down first.
- Alliance logos are published through the vendor's `allianceImageStore`;
  corporation logos are served by wrapping the image edge's
  `resolveImageRequest` in memory, so no EveJS source file is edited.
- No command layer: the folder is the interface (add/overwrite to publish, delete
  or rename to remove). A state file makes removal survive restarts and keeps the
  mod from touching files it did not publish.
- Ignored files are recorded during every scan and the next command lists them
  (wrong name, not a real image, id that is neither an alliance nor a
  corporation).
- Documented that the EVE client texture cache can keep an old logo after the
  five-minute HTTP window; clearing the client image cache is the reliable fix.
- Installer registers the preload in both deployment kinds, keeps `mods/` in the
  Docker build context and adds the logo bind mount; uninstall keeps `logo/`
  unless `--purge-logos` is given.
