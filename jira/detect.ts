import type { Candidate } from "./model.ts";

export const SCANNED_COMMITS = 300;

export const branchesArgs = () => ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"];
export const commitsArgs = () => ["log", `-${SCANNED_COMMITS}`, "--format=%s"];

/** Words shaped like issue keys that aren't: encodings, hashes, standards. */
const NOT_PROJECTS = new Set(["UTF", "SHA", "ISO", "RFC", "CVE", "GPL", "LGPL", "AES", "MD", "HTTP", "TLS", "SSL", "IPV", "PEP", "ES", "ECMA", "WCAG", "CWE", "GHSA", "COVID", "X", "PR"]);

const KEYS = /\b([A-Z][A-Z0-9_]{1,9})-\d+\b/g;
const LOWER_CASE_KEYS = /\b([a-z][a-z0-9_]{1,9})-\d+\b/g;

const projectsIn = (text: string, keys: RegExp) => [...text.matchAll(keys)].map(([, project]) => project!.toUpperCase()).filter((project) => !NOT_PROJECTS.has(project));

/**
 * The projects whose issue keys the commit subjects and branch names name, the most named first. A branch's key in
 * lower case (kite-12-fix) counts only for a project named in capitals somewhere, as release-2 would otherwise be one.
 */
export function candidatesOf(commits: string, branches: string): Candidate[] {
  const named = [...projectsIn(commits, KEYS), ...projectsIn(branches, KEYS)];
  const known = new Set(named);
  const mentions = new Map<string, number>();
  [...named, ...projectsIn(branches, LOWER_CASE_KEYS).filter((project) => known.has(project))].forEach((project) => mentions.set(project, (mentions.get(project) ?? 0) + 1));
  return [...mentions.entries()].map(([project, count]) => ({ project, mentions: count })).sort((a, b) => b.mentions - a.mentions || a.project.localeCompare(b.project));
}
