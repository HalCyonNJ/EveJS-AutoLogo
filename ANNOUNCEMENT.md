# autoAllianceLogo 1.0.0

Give any alliance on your server its own logo. Drop an image named after the
alliance id into the mod's `logo/` folder - no renaming, no client patch, no
database edit.

```
mods/autoAllianceLogo/logo/99000001.png
mods/autoAllianceLogo/logo/99000001.jpg
mods/autoAllianceLogo/logo/99000001.jpeg
```

- PNG or JPEG, up to **1280 x 1280** (larger images are scaled down to fit).
- Applied within about a second (folder watcher) and re-checked every minute.
- Published through the same store the built-in ConfigEditor uses, so the image
  service serves it exactly like any other alliance logo.
- Staff commands: `/alogo flush`, `/alogo delete <allianceID>`, `/alogo help`.
- Works on the Docker and native deployments; the installer registers the
  preload, keeps `mods/` in the Docker build context and adds the logo bind
  mount. Fast, safe, and it never edits EveJS source.

Note: the image service caches images for up to five minutes (upstream). The
server files change immediately; a logged-in client picks the new logo up after
that window or after a relogin.
