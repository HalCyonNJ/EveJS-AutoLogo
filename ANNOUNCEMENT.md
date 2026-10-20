# autoLogo 1.1.0

One mod for alliance **and** corporation logos. Drop an image named after the
entity id into the mod's `logo/` folder - alliance and corporation ids never
collide, so one folder serves both. No renaming, no client patch, no EveJS source
edit (alliance logos use the existing store; corporation logos wrap the image
edge resolver in memory).

```
mods/autoLogo/logo/99000001.png     (alliance)
mods/autoLogo/logo/98000001.jpg     (corporation)
```

- PNG or JPEG, up to **1280 x 1280** (larger images are scaled down).
- Rendered into the six sizes the image service asks for (32 … 1024), square with
  the aspect ratio preserved.
- Applied within about a second (folder watcher) and re-checked every minute.
- No commands: publish, replace and remove by adding, overwriting and deleting the
  image file; the folder is the whole interface.
- Docker and native deployments; the installer registers the preload, keeps
  `mods/` in the Docker build context and adds the logo bind mount.

Note: the image service caches images for up to five minutes (upstream). The
server files change immediately; a logged-in client picks the new logo up after
that window or after a relogin.
