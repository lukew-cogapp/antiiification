import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// Pixel "Motion Photo" JPEGs embed an MP4 trailer that libvips 8.18 chokes on
// ("Input buffer contains unsupported image format"). Pre-clean via ImageMagick
// to a temp file before handing to sharp.
function cleanJpegToTemp(srcPath: string): string {
  const tmp = path.join(
    tmpdir(),
    `iiif-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
  );
  execFileSync("magick", [srcPath, "-strip", "-quality", "95", tmp], {
    stdio: "pipe",
  });
  return tmp;
}

const SOURCE_DIR = path.resolve("source-media");
const OUT_DIR = path.resolve("public/iiif");
const TILE_SIZE = 512;
// Default to a path-only base so the same artefact works in dev and prod
// (Vite serves /antiiification/iiif locally; same on GitHub Pages). Set
// IIIF_BASE in CI if you want absolute URLs published.
const SITE_BASE = process.env.IIIF_BASE ?? "/antiiification";
const IIIF_BASE = `${SITE_BASE}/iiif`;

type Canvas = Record<string, unknown>;

type Caption = { label?: string; summary?: string };
type Captions = Record<string, Caption>;

async function loadCaptions(): Promise<Captions> {
  try {
    const raw = await fs.readFile(
      path.resolve("scripts/captions.json"),
      "utf8",
    );
    return JSON.parse(raw) as Captions;
  } catch {
    return {};
  }
}

const isImage = (f: string) => /\.(jpe?g|png|tiff?|webp)$/i.test(f);
const isVideo = (f: string) => /\.(mp4|webm|mov)$/i.test(f);

const slugify = (f: string) =>
  path
    .parse(f)
    .name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

async function rmrf(p: string) {
  await fs.rm(p, { recursive: true, force: true });
}

async function buildTilesForImage(rawPath: string, slug: string) {
  await rmrf(path.join(OUT_DIR, slug));

  // Strip metadata to a temp working copy so libvips can read the file.
  const srcPath = cleanJpegToTemp(rawPath);

  const img = sharp(srcPath, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error(`No dimensions: ${srcPath}`);

  // Sharp's iiif3 tile layout writes a directory whose own name becomes the
  // image-service path segment; we point `id` at the parent so URLs come out
  // as `${IIIF_BASE}/${slug}/...`.
  await sharp(srcPath, { failOn: "none" })
    .rotate()
    .tile({
      size: TILE_SIZE,
      layout: "iiif3",
      id: IIIF_BASE,
    })
    .toFile(path.join(OUT_DIR, slug));

  // Sharp writes a single pre-rendered full-image at the smallest scale
  // factor under `full/{w},{h}/0/default.jpg`. Discover its dimensions and
  // patch info.json so it advertises a `sizes` entry — viewers (Clover/OSD)
  // use this when picking a derivative for the painting body.
  const fullDir = path.join(OUT_DIR, slug, "full");
  const fullEntries = await fs.readdir(fullDir);
  const sizeDir = fullEntries[0] ?? `${width},${height}`;
  const [fullWStr, fullHStr] = sizeDir.split(",");
  const fullW = Number.parseInt(fullWStr, 10) || width;
  const fullH = Number.parseInt(fullHStr, 10) || height;

  const infoPath = path.join(OUT_DIR, slug, "info.json");
  const info = JSON.parse(await fs.readFile(infoPath, "utf8")) as Record<
    string,
    unknown
  >;
  info.sizes = [{ width: fullW, height: fullH }];
  await fs.writeFile(infoPath, JSON.stringify(info, null, 2));

  await fs.rm(srcPath, { force: true });
  return {
    slug,
    width,
    height,
    thumbW: fullW,
    thumbH: fullH,
  };
}

function probeVideo(srcPath: string) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      srcPath,
    ],
    { encoding: "utf8" },
  );
  const data = JSON.parse(out) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const stream = data.streams?.[0] ?? {};
  return {
    width: stream.width ?? 1920,
    height: stream.height ?? 1080,
    duration: Number.parseFloat(data.format?.duration ?? "0") || 1,
  };
}

async function copyVideo(srcPath: string, slug: string, fileName: string) {
  const outDir = path.join(OUT_DIR, slug);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, fileName);
  await fs.copyFile(srcPath, outPath);

  const probe = probeVideo(srcPath);

  // Pull a thumbnail at ~0.5s into the video and resize to 400px wide.
  const thumbW = 400;
  const thumbH = Math.round((probe.height / probe.width) * thumbW);
  const thumbPath = path.join(outDir, "thumb.jpg");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      "0.5",
      "-i",
      srcPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${thumbW}:-1`,
      "-q:v",
      "4",
      thumbPath,
    ],
    { stdio: "pipe" },
  );

  return {
    slug,
    url: `${IIIF_BASE}/${slug}/${fileName}`,
    thumbUrl: `${IIIF_BASE}/${slug}/thumb.jpg`,
    thumbW,
    thumbH,
    width: probe.width,
    height: probe.height,
    duration: probe.duration,
  };
}

function imageCanvas(
  info: {
    slug: string;
    width: number;
    height: number;
    thumbW: number;
    thumbH: number;
  },
  index: number,
  fileName: string,
  caption: Caption,
): Canvas {
  const canvasId = `${IIIF_BASE}/manifest/canvas/${index}`;
  const serviceId = `${IIIF_BASE}/${info.slug}`;
  // sharp's iiif3 layout writes a single pre-rendered full image at the
  // smallest size; reuse it as the painting body so Clover has something to
  // load before the tile grid resolves.
  const imgId = `${serviceId}/full/${info.thumbW},${info.thumbH}/0/default.jpg`;
  const canvas: Canvas = {
    id: canvasId,
    type: "Canvas",
    label: { en: [caption.label ?? fileName] },
    ...(caption.summary ? { summary: { en: [caption.summary] } } : {}),
    width: info.width,
    height: info.height,
    thumbnail: [
      {
        id: `${serviceId}/full/${info.thumbW},${info.thumbH}/0/default.jpg`,
        type: "Image",
        format: "image/jpeg",
        width: info.thumbW,
        height: info.thumbH,
      },
    ],
    items: [
      {
        id: `${canvasId}/page`,
        type: "AnnotationPage",
        items: [
          {
            id: `${canvasId}/anno`,
            type: "Annotation",
            motivation: "painting",
            target: canvasId,
            body: {
              id: imgId,
              type: "Image",
              format: "image/jpeg",
              width: info.width,
              height: info.height,
              service: [
                {
                  id: serviceId,
                  type: "ImageService3",
                  profile: "level0",
                },
              ],
            },
          },
        ],
      },
    ],
  };
  return canvas;
}

function videoCanvas(
  info: {
    slug: string;
    url: string;
    width: number;
    height: number;
    duration: number;
    thumbUrl: string;
    thumbW: number;
    thumbH: number;
  },
  index: number,
  fileName: string,
  caption: Caption,
): Canvas {
  const canvasId = `${IIIF_BASE}/manifest/canvas/${index}`;
  return {
    id: canvasId,
    type: "Canvas",
    label: { en: [caption.label ?? fileName] },
    ...(caption.summary ? { summary: { en: [caption.summary] } } : {}),
    width: info.width,
    height: info.height,
    duration: info.duration,
    thumbnail: [
      {
        id: info.thumbUrl,
        type: "Image",
        format: "image/jpeg",
        width: info.thumbW,
        height: info.thumbH,
      },
    ],
    items: [
      {
        id: `${canvasId}/page`,
        type: "AnnotationPage",
        items: [
          {
            id: `${canvasId}/anno`,
            type: "Annotation",
            motivation: "painting",
            target: canvasId,
            body: {
              id: info.url,
              type: "Video",
              format: "video/mp4",
              width: info.width,
              height: info.height,
              duration: info.duration,
            },
          },
        ],
      },
    ],
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const entries = (await fs.readdir(SOURCE_DIR)).sort();
  const captions = await loadCaptions();

  const canvases: Canvas[] = [];
  let i = 0;
  for (const f of entries) {
    const full = path.join(SOURCE_DIR, f);
    const slug = slugify(f);
    const caption = captions[f] ?? {};
    if (isImage(f)) {
      console.log(`[image] ${f} -> ${slug}`);
      const info = await buildTilesForImage(full, slug);
      canvases.push(imageCanvas(info, i++, f, caption));
    } else if (isVideo(f)) {
      console.log(`[video] ${f} -> ${slug}`);
      const info = await copyVideo(full, slug, f);
      canvases.push(videoCanvas(info, i++, f, caption));
    }
  }

  const manifest = {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    id: `${IIIF_BASE}/manifest.json`,
    type: "Manifest",
    label: { en: ["Antiiification — ants of the Cogapp office"] },
    summary: {
      en: [
        "Photographs and videos of ants encountered around the Cogapp office.",
      ],
    },
    items: canvases,
  };

  await fs.writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  // sharp's iiif3 layout drops a `vips-properties.xml` at the parent dir of
  // every tile pyramid; the last write lands in OUT_DIR root and is unused.
  await fs.rm(path.join(OUT_DIR, "vips-properties.xml"), { force: true });

  console.log(`Wrote manifest with ${canvases.length} canvases.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
