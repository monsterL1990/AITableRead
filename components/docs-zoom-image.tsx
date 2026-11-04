"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useI18n } from "@/components/locale-provider";

const NARROW = "(max-width: 767px)";

/** Body screenshots stay in the column until the reader asks for a larger view. */
export function DocsCover() {
  const { t } = useI18n();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/docs-assets/cover.png" alt={t("docs.coverAlt")} className="h-auto w-full rounded-md border border-border" />
  );
}

export function DocsZoomImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const openedAt = useRef(0);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openZoom() {
    openedAt.current = Date.now();
    setOpen(true);
  }

  function onThumbnailClick(event: MouseEvent<HTMLImageElement>) {
    if (!window.matchMedia(NARROW).matches) return;
    event.preventDefault();
    openZoom();
  }

  function onBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-docs-zoom-image]")) return;
    if (Date.now() - openedAt.current < 400) return;
    setOpen(false);
  }

  return (
    <>
      {/* Packaged screenshots are static files; the lightbox shows the same file larger. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        title={t("docs.zoomTitle")}
        loading="lazy"
        decoding="async"
        draggable={false}
        onClick={onThumbnailClick}
        onDoubleClick={(event) => {
          event.preventDefault();
          openZoom();
        }}
        className="h-auto w-full cursor-zoom-in select-none rounded-md border border-border bg-card"
      />
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt || t("docs.zoom")}
          className="fixed inset-0 z-[80] overflow-auto bg-[#1c1712]/92"
          onClick={onBackdropClick}
        >
          <button
            type="button"
            className="fixed top-4 right-4 z-[81] rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
            }}
          >
            {t("docs.close")}
          </button>
          <div className="flex min-h-full items-center justify-center px-4 py-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              data-docs-zoom-image=""
              draggable={false}
              className="h-auto w-auto max-w-none shadow-lg md:max-w-[96vw]"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
