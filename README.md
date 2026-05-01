# Antifffication

Photos and videos of ants in the Cogapp office, presented as a single IIIF
Presentation v3 manifest viewable through Clover and Storiiies.

## Stack

- Vite + React + TypeScript
- Tailwind v4 (Biome v2 for lint/format, no ESLint)
- `sharp` to generate IIIF Image API Level 0 static tile pyramids
- `@samvera/clover-iiif` viewer (handles photo + video canvases)
- Storiiies viewer via iframe as a secondary view
- Hosted on GitHub Pages — base path `/antifffication/`

## Layout

```
source-media/      raw photos/videos (gitignored)
public/iiif/       generated tiles + manifest.json (committed)
scripts/build-iiif.ts   sharp pipeline that produces public/iiif/
src/               React app
```

## Local dev

```sh
npm install
npm run build:iiif   # regenerate tiles + manifest from source-media/
npm run dev
```

`build:iiif` requires ImageMagick (`magick`) on PATH — Pixel "Motion Photo"
JPEGs trip libvips 8.18, so source files are stripped via ImageMagick before
`sharp` reads them.

## Deploying

Pushes to `main` trigger `.github/workflows/deploy.yml`, which regenerates
tiles, builds Vite, and publishes to GitHub Pages.

The manifest URL on the deployed site is:

```
https://lukew-cogapp.github.io/antifffication/iiif/manifest.json
```
