Logos
=====

Drop one image per entity in this folder.  The file name IS the entity id:

    99000001.png      alliance 99000001
    98000001.jpg      corporation 98000001
    98000002.jpeg     corporation 98000002

Alliance ids and corporation ids never collide, so one folder serves both.

Rules
-----
* PNG or JPEG only.
* Maximum 1280 x 1280 pixels.  A larger image is scaled down to fit (and the
  server log says so); it is never rejected for being large.
* Only the file name matters.  Nothing is renamed, no list file is needed, and
  the same entity can be replaced by overwriting its file.
* The server renders the six square sizes the image service asks for
  (32, 64, 128, 256, 512, 1024), publishes alliance files into
  `gameStore/images/Alliance/` and corporation files into `corporation-logo/`,
  then applies a new or changed file within about a second and re-checks every
  minute.
* The image service caches an image for five minutes, so reconnect the client -
  or wait - to see a replaced logo.

To remove a logo, delete its image file; the next scan removes both published copies.
