import type { PhrasingContent, Root, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** Atlassian Document Format, the rich text Jira keeps descriptions and comments in. */
export interface AdfNode {
  type: string;
  /** The document's own, always 1. */
  version?: number;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

const doc = (content: AdfNode[]): AdfNode => ({ version: 1, type: "doc", content });

const textOf = (node: AdfNode): string => node.text ?? (node.content ?? []).map(textOf).join("");

const BLOCK_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList", "listItem", "codeBlock", "blockquote", "rule", "table", "tableRow", "tableHeader", "tableCell", "panel", "mediaSingle", "mediaGroup", "expand", "nestedExpand", "decisionList", "taskList", "taskItem", "decisionItem", "blockCard", "embedCard"]);

/** What an inline node reads as in plain text: a mention its name, a card its address. */
function inlineText(node: AdfNode): string {
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "mention":
      return String(node.attrs?.text ?? "@someone");
    case "emoji":
      return String(node.attrs?.text ?? node.attrs?.shortName ?? "");
    case "inlineCard":
      return String(node.attrs?.url ?? "");
    case "status":
      return String(node.attrs?.text ?? "");
    case "date":
      return node.attrs?.timestamp ? new Date(Number(node.attrs.timestamp)).toISOString().slice(0, 10) : "";
    default:
      return (node.content ?? []).map(inlineText).join("") || node.text || "";
  }
}

/** The document as plain text, for search and for the agent: blocks on their own lines, list items with a dash. */
export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return "";
  const lines: string[] = [];
  const walk = (block: AdfNode, prefix: string) => {
    if (block.type === "tableRow") {
      lines.push(prefix + (block.content ?? []).map((cell) => adfToText(cell).replace(/\n+/g, " ")).join(" | "));
      return;
    }
    if (block.type === "doc" || block.type === "blockquote" || block.type === "panel" || block.type === "expand" || block.type === "nestedExpand" || block.type === "table" || block.type === "mediaSingle") {
      (block.content ?? []).forEach((child) => walk(child, prefix));
      return;
    }
    if (block.type === "bulletList" || block.type === "orderedList" || block.type === "taskList" || block.type === "decisionList") {
      (block.content ?? []).forEach((item, index) => walk(item, block.type === "orderedList" ? `${index + 1}. ` : "- "));
      return;
    }
    if (block.type === "listItem" || block.type === "taskItem" || block.type === "decisionItem" || block.type === "tableCell" || block.type === "tableHeader") {
      const children = block.content ?? [];
      const inline = children.every((child) => !BLOCK_TYPES.has(child.type));
      if (inline) lines.push(prefix + children.map(inlineText).join(""));
      else children.forEach((child, index) => walk(child, index === 0 ? prefix : "  "));
      return;
    }
    if (block.type === "codeBlock") {
      lines.push(...textOf(block).split("\n"));
      return;
    }
    if (block.type === "rule") return;
    if (block.type === "media" || block.type === "mediaGroup") {
      lines.push("[attachment]");
      return;
    }
    lines.push(prefix + (block.content ?? []).map(inlineText).join(""));
  };
  walk(node, "");
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Markdown as Jira's rich text: headings, lists, code, quotes, tables, links and the inline marks. */
export function markdownToAdf(markdown: string): AdfNode {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
  return doc(blocksOf(tree.children));
}

function blocksOf(nodes: RootContent[]): AdfNode[] {
  return nodes.flatMap((node): AdfNode[] => {
    switch (node.type) {
      case "paragraph":
        return [{ type: "paragraph", content: inlinesOf(node.children, []) }];
      case "heading":
        return [{ type: "heading", attrs: { level: node.depth }, content: inlinesOf(node.children, []) }];
      case "list":
        return [
          {
            type: node.ordered ? "orderedList" : "bulletList",
            ...(node.ordered && (node.start ?? 1) !== 1 && { attrs: { order: node.start } }),
            content: node.children.map((item) => ({ type: "listItem", content: blocksOf(item.children) })),
          },
        ];
      case "code":
        return [{ type: "codeBlock", ...(node.lang && { attrs: { language: node.lang } }), content: node.value ? [{ type: "text", text: node.value }] : [] }];
      case "blockquote":
        return [{ type: "blockquote", content: blocksOf(node.children) }];
      case "thematicBreak":
        return [{ type: "rule" }];
      case "table":
        return [tableOf(node)];
      case "html":
        return [{ type: "paragraph", content: [{ type: "text", text: node.value }] }];
      default:
        return [];
    }
  });
}

function tableOf(table: Table): AdfNode {
  return {
    type: "table",
    content: table.children.map((row, rowIndex) => ({
      type: "tableRow",
      content: row.children.map((cell) => ({ type: rowIndex === 0 ? "tableHeader" : "tableCell", content: [{ type: "paragraph", content: inlinesOf(cell.children, []) }] })),
    })),
  };
}

const withMark = (marks: AdfMark[], mark: AdfMark) => [...marks.filter(({ type }) => type !== mark.type), mark];

function inlinesOf(nodes: PhrasingContent[], marks: AdfMark[]): AdfNode[] {
  return mergeText(
    nodes.flatMap((node): AdfNode[] => {
      switch (node.type) {
        case "text":
          return node.value ? [textNode(node.value, marks)] : [];
        case "strong":
          return inlinesOf(node.children, withMark(marks, { type: "strong" }));
        case "emphasis":
          return inlinesOf(node.children, withMark(marks, { type: "em" }));
        case "delete":
          return inlinesOf(node.children, withMark(marks, { type: "strike" }));
        case "inlineCode":
          return [textNode(node.value, withMark(marks, { type: "code" }))];
        case "link":
          return inlinesOf(node.children, withMark(marks, { type: "link", attrs: { href: node.url } }));
        case "break":
          return [{ type: "hardBreak" }];
        case "image":
          return [textNode(node.alt || node.url, withMark(marks, { type: "link", attrs: { href: node.url } }))];
        case "html":
          return [textNode(node.value, marks)];
        default:
          return "children" in node ? inlinesOf((node as { children: PhrasingContent[] }).children, marks) : [];
      }
    }),
  );
}

const textNode = (text: string, marks: AdfMark[]): AdfNode => (marks.length ? { type: "text", text, marks: sortMarks(marks) } : { type: "text", text });

const MARK_ORDER = ["link", "strong", "em", "strike", "code"];
const sortMarks = (marks: AdfMark[]) => [...marks].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));

const sameMarks = (a: AdfMark[] | undefined, b: AdfMark[] | undefined) => JSON.stringify(sortMarks(a ?? [])) === JSON.stringify(sortMarks(b ?? []));

function mergeText(nodes: AdfNode[]): AdfNode[] {
  return nodes.reduce<AdfNode[]>((merged, node) => {
    const last = merged.at(-1);
    if (last?.type === "text" && node.type === "text" && sameMarks(last.marks, node.marks)) merged[merged.length - 1] = { ...last, text: `${last.text}${node.text}` };
    else merged.push(node);
    return merged;
  }, []);
}

/** The nodes adfToMarkdown writes and markdownToAdf reads back: a document of only these can be edited as Markdown. */
const MARKDOWN_NODES = new Set(["doc", "paragraph", "text", "hardBreak", "heading", "bulletList", "orderedList", "listItem", "codeBlock", "blockquote", "rule"]);
const MARKDOWN_MARKS = new Set(["strong", "em", "strike", "code", "link"]);

const escapeInline = (text: string) => text.replace(/([\\`*_[\]<>#|~])/g, "\\$1");

function inlineMarkdown(nodes: AdfNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "\\\n";
      const marks = sortMarks(node.marks ?? []);
      const code = marks.some(({ type }) => type === "code");
      let text = code ? `\`${node.text ?? ""}\`` : escapeInline(node.text ?? "");
      for (const mark of [...marks].reverse()) {
        if (mark.type === "strong") text = `**${text}**`;
        if (mark.type === "em") text = `*${text}*`;
        if (mark.type === "strike") text = `~~${text}~~`;
        if (mark.type === "link") text = `[${text}](${String(mark.attrs?.href ?? "")})`;
      }
      return text;
    })
    .join("");
}

function blockMarkdown(node: AdfNode, indent: string): string {
  const children = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return indent + inlineMarkdown(children).replace(/\n/g, `\n${indent}`);
    case "heading":
      return `${indent}${"#".repeat(Number(node.attrs?.level ?? 1))} ${inlineMarkdown(children)}`;
    case "codeBlock":
      return [`${indent}\`\`\`${String(node.attrs?.language ?? "")}`, ...textOf(node).split("\n").map((line) => indent + line), `${indent}\`\`\``].join("\n");
    case "blockquote":
      return children.map((child) => blockMarkdown(child, "").replace(/^/gm, `${indent}> `)).join(`\n${indent}>\n`);
    case "rule":
      return `${indent}---`;
    case "bulletList":
    case "orderedList": {
      const start = Number(node.attrs?.order ?? 1);
      return children
        .map((item, index) => {
          const marker = node.type === "orderedList" ? `${start + index}. ` : "- ";
          const body = (item.content ?? []).map((child) => blockMarkdown(child, " ".repeat(marker.length))).join("\n\n");
          return indent + marker + body.slice(marker.length);
        })
        .join("\n");
    }
    default:
      return indent + inlineMarkdown(children);
  }
}

export function adfToMarkdown(node: AdfNode | null | undefined): string {
  if (!node) return "";
  return (node.content ?? []).map((block) => blockMarkdown(block, "")).join("\n\n");
}

/** Without the attributes Jira adds by itself (local ids), so two documents compare by what they say. */
function normalize(node: AdfNode): unknown {
  const KEPT_ATTRS: Record<string, string[]> = { heading: ["level"], codeBlock: ["language"], orderedList: ["order"] };
  const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([name, value]) => KEPT_ATTRS[node.type]?.includes(name) && value !== null && value !== undefined && !(name === "order" && value === 1)));
  const content = node.content ? mergeText(node.content.filter((child) => !(child.type === "text" && !child.text))).map(normalize) : undefined;
  const marks = node.marks?.length ? sortMarks(node.marks).map(({ type, attrs: markAttrs }) => (type === "link" ? { type, href: markAttrs?.href } : { type })) : undefined;
  return { type: node.type, ...(Object.keys(attrs).length && { attrs }), ...(content?.length && { content }), ...(node.text !== undefined && { text: node.text }), ...(marks && { marks }) };
}

const onlyMarkdownNodes = (node: AdfNode): boolean => MARKDOWN_NODES.has(node.type) && (node.marks ?? []).every(({ type }) => MARKDOWN_MARKS.has(type)) && (node.content ?? []).every(onlyMarkdownNodes);

/** Whether the document survives being edited as Markdown: mentions, media, panels and tables stay for Jira's editor. */
export function editableAsMarkdown(node: AdfNode | null | undefined): boolean {
  if (!node || !node.content?.length) return true;
  if (!onlyMarkdownNodes(node)) return false;
  return JSON.stringify(normalize(markdownToAdf(adfToMarkdown(node)))) === JSON.stringify(normalize(node));
}

export const isAdf = (value: unknown): value is AdfNode => !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
