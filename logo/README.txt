Alliance logos
==============

Drop one image per alliance in this folder.  The file name IS the alliance id:

    99000001.png
    99000001.jpg
    99000001.jpeg

Rules
-----
* PNG or JPEG only.
* Maximum 1280 x 1280 pixels.  A larger image is scaled down to fit (and the
  server log says so); it is never rejected for being large.
* Only the file name matters.  Nothing is renamed, no list file is needed, and
  the same alliance can be replaced by overwriting its file.
* The server applies a new or changed file within about a second (the folder is
  watched) and re-checks every minute.  The image service caches a logo for
  five minutes, so reconnect the client - or wait five minutes - to see it.

Staff commands: `/alogo flush` republishes now, `/alogo delete <allianceID>` removes
both the published files and the source image.

The published files land in the runtime image store as
`<allianceID>_32.png` ... `<allianceID>_1024.png`, which is exactly what the
image service serves to the client.  Alliance logos are the only customisable
entity images in the game; corporation logos are generated from their ticker and
are not handled here.
