/** How long ago, in the few words a list row has room for: "now", "5m", "3h", "2d", "4w", then the date. */
export function ago(iso: string | number | null, now = Date.now()): string {
  if (iso === null || iso === "") return "";
  const then = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 28) return days < 7 ? `${days}d` : `${Math.round(days / 7)}w`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(then).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

/** "Updated 2 min ago", for the bar. */
export function updatedText(fetchedAt: number | null, now = Date.now()) {
  if (fetchedAt === null) return "Not loaded yet";
  const minutes = Math.floor((now - fetchedAt) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.floor(minutes / 60)} h ago`;
}

const AVATAR_HUES = [12, 32, 145, 190, 215, 260, 290, 330];

/** A person's initials on a colour of their own, the same every time: the frame loads no pictures from Jira. */
export function avatarOf(name: string) {
  const hash = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  return { initials: initials || "?", color: `hsl(${AVATAR_HUES[hash % AVATAR_HUES.length]} 55% 45%)` };
}

/** ago as words in a sentence: "just now", "3h ago", or "on 3 Nov" for an older date. */
export function agoText(iso: string | number | null, now = Date.now()): string {
  const short = ago(iso, now);
  if (short === "now") return "just now";
  return /\d$/.test(short) || /[a-z]{3}/i.test(short) ? `on ${short}` : short ? `${short} ago` : "";
}

export type PriorityLevel = "highest" | "high" | "medium" | "low" | "lowest";

const NUMBERED_LEVELS: PriorityLevel[] = ["highest", "highest", "high", "medium", "low", "lowest"];

const PRIORITY_WORDS: [PriorityLevel, RegExp][] = [
  ["lowest", /lowest|trivial/],
  ["highest", /highest|blocker|critical|immediate|urgent|emergency/],
  ["high", /high|major|must/],
  ["low", /low|minor/],
  ["medium", /medium|normal|moderate/],
];

/** Sites name their priorities as they like, such as "P2 - Degraded" or "Must have", so the level comes from its number, else the words in the name. */
export function priorityLevel(name: string): PriorityLevel | null {
  const text = name.toLowerCase();
  const numbered = /\bp([0-5])\b/.exec(text)?.[1];
  if (numbered) return NUMBERED_LEVELS[Number(numbered)]!;
  return PRIORITY_WORDS.find(([, words]) => words.test(text))?.[0] ?? null;
}
