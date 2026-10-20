# Changelog

## 1.0.0 - 2026-10-20

First release, for EveJS 261018.1 (Docker and native loader paths).

- Publishes an alliance logo from `logo/<allianceID>.png|jpg|jpeg` through the
  vendor's own `allianceImageStore.storeAllianceLogo`, so the image service serves
  it with no client patch and no gameStore edit.
- PNG is published byte for byte when it fits; JPEG is decoded and re-encoded as
  PNG; anything larger than 1280 x 1280 is scaled down to fit (bilinear, pure JS).
- The folder is watched and also swept once a minute; unchanged files are skipped
  by content hash.
- Unknown alliance ids, non-images and failed writes are logged and skipped; the
  server is never taken down by a bad file.
- Installer registers the preload in both launch blocks, keeps `mods/` in the
  build context, and adds the logo bind mount (writable, so `/alogo delete` can
  remove the source image too).
- Ignored files are recorded during every scan and the next `/alogo` reply lists
  them as a warning (wrong file name, unknown alliance id, not a real image), so a
  badly named image is never silently skipped.
- Staff commands: `/alogo flush` republishes every logo immediately, `/alogo
  delete <allianceID>` removes the published logo and its source image.
- The commands act on the server immediately; the image service's five-minute
  cache is upstream behaviour and is not changed (a client needs that window to
  pass, or a relogin, to display a replaced texture).
