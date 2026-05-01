import Viewer from "@samvera/clover-iiif/viewer";
import { useEffect, useRef, useState } from "react";

const MANIFEST_PATH = `${import.meta.env.BASE_URL}iiif/manifest.json`;
const manifestUrl = () =>
  typeof window === "undefined"
    ? MANIFEST_PATH
    : new URL(MANIFEST_PATH, window.location.href).toString();

type Manifest = {
  label?: { en?: string[] };
  summary?: { en?: string[] };
};

function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const cloverHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(manifestUrl())
      .then((r) => r.json())
      .then(setManifest)
      .catch((e) => console.error("manifest load failed", e));
  }, []);

  // Clover renders <video> inside its own subtree on each canvas change. Watch
  // the host node and force loop/autoplay/muted on every video that appears
  // (muted required for autoplay under most browser policies).
  useEffect(() => {
    const host = cloverHostRef.current;
    if (!host) return;

    const apply = (root: ParentNode) => {
      for (const v of root.querySelectorAll("video")) {
        if (!v.loop) v.loop = true;
        if (!v.muted) v.muted = true;
        if (!v.autoplay) v.autoplay = true;
        if (v.paused) v.play().catch(() => {});
      }
    };

    apply(host);
    const observer = new MutationObserver(() => apply(host));
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const title = manifest?.label?.en?.[0] ?? "Antifffication";
  const summary = manifest?.summary?.en?.[0] ?? "";

  return (
    <div className="min-h-svh max-w-6xl mx-auto px-6 py-10">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-accent">
          {title}
        </h1>
        {summary && <p className="mt-3 text-fg/80 max-w-2xl">{summary}</p>}
      </header>

      {!manifest && (
        <p className="text-fg/60">
          No manifest yet. Run{" "}
          <code className="font-mono">npm run build:iiif</code>.
        </p>
      )}

      {manifest && (
        <section className="mb-10">
          <div className="aspect-[16/10] w-full bg-black/40 rounded overflow-hidden">
            <div ref={cloverHostRef} className="w-full h-full">
              <Viewer
                iiifContent={manifestUrl()}
                options={{
                  canvasBackgroundColor: "#0b0a0d",
                  showIIIFBadge: true,
                  informationPanel: { open: false },
                }}
              />
            </div>
          </div>
        </section>
      )}

      <footer className="mt-16 text-xs text-fg/40">
        Built with Vite + React + Tailwind. IIIF Level 0 tiles via sharp.
        Viewer: Clover.
      </footer>
    </div>
  );
}

export default App;
