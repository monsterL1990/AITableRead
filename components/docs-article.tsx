/* Packaged screenshots are already static files under public/docs-assets. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { DocsZoomImage } from "@/components/docs-zoom-image";
import { DOCS_NAV, docBySlug, type DocSlug } from "@/lib/docs-nav";
import { loadDocMarkdown, parseDocsMarkdown, type Inline } from "@/lib/docs";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, index) =>
    node.type === "strong" ? (
      <strong key={index} className="font-semibold text-foreground">
        {node.text}
      </strong>
    ) : (
      node.text
    ),
  );
}

export function DocsArticle({ slug }: { slug: DocSlug }) {
  const doc = docBySlug(slug);
  const blocks = parseDocsMarkdown(loadDocMarkdown(slug));
  const index = DOCS_NAV.findIndex((item) => item.slug === slug);
  const previous = index > 0 ? DOCS_NAV[index - 1] : undefined;
  const next = index >= 0 && index < DOCS_NAV.length - 1 ? DOCS_NAV[index + 1] : undefined;

  return (
    <article className="sheet rounded-lg border border-border px-5 py-7 sm:px-10 sm:py-9">
      {doc.showCover ? (
        <figure className="mb-8">
          <img
            src="/docs-assets/cover.png"
            alt="围读封面"
            className="h-auto w-full rounded-md border border-border"
          />
        </figure>
      ) : null}
      {blocks.map((block, index) => {
        if (block.type === "h1") {
          return (
            <h1 key={index} className="font-serif text-3xl font-medium tracking-tight text-foreground">
              <Inlines nodes={block.inlines} />
            </h1>
          );
        }
        if (block.type === "h2") {
          return (
            <h2 key={index} className="mt-10 border-b border-border pb-2 font-serif text-xl font-medium text-primary">
              <Inlines nodes={block.inlines} />
            </h2>
          );
        }
        if (block.type === "img") {
          return (
            <figure key={index} className="my-6">
              <DocsZoomImage src={block.src} alt={block.alt} />
              {block.alt ? <figcaption className="mt-2 text-center text-sm text-muted-foreground">{block.alt}</figcaption> : null}
            </figure>
          );
        }
        if (block.type === "ul" || block.type === "ol") {
          const List = block.type;
          return (
            <List
              key={index}
              className={`my-4 space-y-2 pl-6 font-serif text-[1.0625rem] leading-8 ${block.type === "ul" ? "list-disc" : "list-decimal"}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inlines nodes={item} />
                </li>
              ))}
            </List>
          );
        }
        if (block.type === "p") {
          return (
            <p key={index} className="my-4 font-serif text-[1.0625rem] leading-8 text-foreground">
              <Inlines nodes={block.inlines} />
            </p>
          );
        }
        return null;
      })}
      <nav className="mt-12 flex items-stretch justify-between gap-3 border-t border-border pt-5 text-sm" aria-label="前后文">
        {previous ? (
          <Link href={previous.href} className="text-primary hover:underline">
            上一篇 · {previous.label}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={next.href} className="text-primary hover:underline">
            下一篇 · {next.label}
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
