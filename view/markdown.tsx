import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const openOutside = (href: string | undefined) => (event: React.MouseEvent) => {
  event.preventDefault();
  if (href && /^https?:/i.test(href)) window.mirador.openLink(href);
};

/**
 * Markdown, without the HTML it may hold; links open in the browser, and pictures, which the sandboxed frame
 * can't load, stay links to them.
 */
export function MarkdownText({ text }: { text: string }) {
  if (!text.trim()) return <p className="muted">No description.</p>;
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} onClick={openOutside(href)}>
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <a className="picture-link" href={typeof src === "string" ? src : undefined} onClick={openOutside(typeof src === "string" ? src : undefined)}>
              🖼 {alt || "Picture"}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
