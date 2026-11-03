import type { ReactNode } from "react";
import { adfToText, type AdfMark, type AdfNode } from "../jira/adf.ts";

const openOutside = (href: string) => (event: React.MouseEvent) => {
  event.preventDefault();
  if (/^https?:/i.test(href)) window.mirador.openLink(href);
};

function marked(text: ReactNode, marks: AdfMark[] = []): ReactNode {
  return marks.reduce<ReactNode>((inner, mark) => {
    switch (mark.type) {
      case "strong":
        return <strong>{inner}</strong>;
      case "em":
        return <em>{inner}</em>;
      case "code":
        return <code>{inner}</code>;
      case "strike":
        return <s>{inner}</s>;
      case "underline":
        return <u>{inner}</u>;
      case "link": {
        const href = String(mark.attrs?.href ?? "");
        return (
          <a href={href} onClick={openOutside(href)}>
            {inner}
          </a>
        );
      }
      default:
        return inner;
    }
  }, text);
}

const children = (node: AdfNode) => (node.content ?? []).map((child, index) => <Node key={index} node={child} />);

/** One node of Jira's rich text; what this view doesn't draw shows as its text, and pictures, which can't load here, as a mark. */
function Node({ node }: { node: AdfNode }): ReactNode {
  switch (node.type) {
    case "doc":
      return <>{children(node)}</>;
    case "text":
      return marked(node.text ?? "", node.marks);
    case "paragraph":
      return <p>{children(node)}</p>;
    case "heading": {
      const level = Math.min(6, Math.max(3, Number(node.attrs?.level ?? 1) + 2));
      const Heading = `h${level}` as "h3";
      return <Heading>{children(node)}</Heading>;
    }
    case "bulletList":
      return <ul>{children(node)}</ul>;
    case "orderedList":
      return <ol start={Number(node.attrs?.order ?? 1)}>{children(node)}</ol>;
    case "listItem":
      return <li>{children(node)}</li>;
    case "taskList":
      return <ul className="tasks">{children(node)}</ul>;
    case "taskItem":
      return (
        <li>
          <span className="task-box">{node.attrs?.state === "DONE" ? "☑" : "☐"}</span> {children(node)}
        </li>
      );
    case "codeBlock":
      return (
        <pre>
          <code>{adfToText(node)}</code>
        </pre>
      );
    case "blockquote":
      return <blockquote>{children(node)}</blockquote>;
    case "panel":
      return <div className={`panel panel-${String(node.attrs?.panelType ?? "info")}`}>{children(node)}</div>;
    case "rule":
      return <hr />;
    case "hardBreak":
      return <br />;
    case "mention":
      return <span className="mention">{String(node.attrs?.text ?? "@someone")}</span>;
    case "emoji":
      return <>{String(node.attrs?.text ?? node.attrs?.shortName ?? "")}</>;
    case "inlineCard":
    case "blockCard":
    case "embedCard": {
      const url = String(node.attrs?.url ?? "");
      return (
        <a className="card-link" href={url} onClick={openOutside(url)}>
          {url}
        </a>
      );
    }
    case "status":
      return <span className="lozenge c-new">{String(node.attrs?.text ?? "")}</span>;
    case "date":
      return <span className="date">{node.attrs?.timestamp ? new Date(Number(node.attrs.timestamp)).toLocaleDateString() : ""}</span>;
    case "table":
      return (
        <table>
          <tbody>{children(node)}</tbody>
        </table>
      );
    case "tableRow":
      return <tr>{children(node)}</tr>;
    case "tableHeader":
      return <th>{children(node)}</th>;
    case "tableCell":
      return <td>{children(node)}</td>;
    case "expand":
    case "nestedExpand":
      return (
        <details>
          <summary>{String(node.attrs?.title ?? "More")}</summary>
          {children(node)}
        </details>
      );
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return <span className="attachment">📎 An attachment, which opens in Jira</span>;
    default:
      return node.content ? <>{children(node)}</> : <>{node.text ?? ""}</>;
  }
}

export function AdfView({ doc, empty }: { doc: AdfNode | null; empty: string }) {
  if (!doc?.content?.length) return <p className="muted">{empty}</p>;
  return (
    <div className="markdown">
      <Node node={doc} />
    </div>
  );
}
