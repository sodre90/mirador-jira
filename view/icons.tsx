import { useState } from "react";
import type { Person, Status } from "../jira/model.ts";
import { avatarOf } from "./format.ts";

const TYPE_LOOKS: Record<string, { mark: string; color: string }> = {
  epic: { mark: "⚡", color: "#7f56d9" },
  story: { mark: "S", color: "#30a46c" },
  task: { mark: "T", color: "#4b7bec" },
  bug: { mark: "B", color: "#e5484d" },
  "sub-task": { mark: "↳", color: "#4b7bec" },
  subtask: { mark: "↳", color: "#4b7bec" },
  improvement: { mark: "↑", color: "#0ea5a4" },
  "new feature": { mark: "+", color: "#30a46c" },
  spike: { mark: "?", color: "#d97706" },
};

export function TypeBadge({ type }: { type: string }) {
  const look = TYPE_LOOKS[type.toLowerCase()] ?? { mark: (type[0] ?? "?").toUpperCase(), color: "#8b8d98" };
  return (
    <span className="type" style={{ background: look.color }} title={type} aria-label={type} role="img">
      {look.mark}
    </span>
  );
}

export function StatusLozenge({ status }: { status: Status }) {
  return <span className={`lozenge c-${status.category}`}>{status.name}</span>;
}

const PRIORITY_LOOKS: Record<string, { mark: string; className: string }> = {
  highest: { mark: "⇈", className: "p-highest" },
  blocker: { mark: "⇈", className: "p-highest" },
  critical: { mark: "⇈", className: "p-highest" },
  high: { mark: "↑", className: "p-high" },
  major: { mark: "↑", className: "p-high" },
  medium: { mark: "=", className: "p-medium" },
  normal: { mark: "=", className: "p-medium" },
  low: { mark: "↓", className: "p-low" },
  minor: { mark: "↓", className: "p-low" },
  lowest: { mark: "⇊", className: "p-lowest" },
  trivial: { mark: "⇊", className: "p-lowest" },
};

export function PriorityMark({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const look = PRIORITY_LOOKS[priority.toLowerCase()] ?? { mark: "•", className: "p-medium" };
  return (
    <span className={`priority ${look.className}`} title={`${priority} priority`} aria-label={`${priority} priority`} role="img">
      {look.mark}
    </span>
  );
}

export function Avatar({ person, size = 18 }: { person: Person | null; size?: number }) {
  if (!person) return <span className="avatar nobody" style={{ width: size, height: size, fontSize: size * 0.5 }} title="Unassigned" aria-hidden />;
  const { initials, color } = avatarOf(person.name);
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * (initials.length > 1 ? 0.42 : 0.55) }} title={person.name} aria-hidden>
      {initials}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" role="status" />;
}

/** An issue's key, which copies itself when clicked. */
export function KeyChip({ issueKey }: { issueKey: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="key-chip"
      data-hint="Copy the key"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(issueKey).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      <span className="key">{issueKey}</span>
      {copied && <span className="copy-mark">✓</span>}
    </button>
  );
}

export function Labels({ labels }: { labels: string[] }) {
  return (
    <>
      {labels.map((label) => (
        <span key={label} className="label">
          {label}
        </span>
      ))}
    </>
  );
}
