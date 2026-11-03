/** What running a program gave back. */
export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program in a folder; the plugin runs `acli` and `git` through it, and tests stand in for it. */
export type Runner = (program: string, args: string[], options: { cwd: string; signal?: AbortSignal }) => Promise<Ran>;

const RUN_TIMEOUT_MS = 60_000;

/** Never prompts, colours or tells of updates, so its output stays plain. */
const quietEnvironment = () => ({ ...process.env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0", CLICOLOR: "0" });

export class ProgramMissing extends Error {
  constructor(readonly program: string) {
    super(`${program} is not installed, or not on Mirador's PATH.`);
  }
}

export const spawnRunner: Runner = async (program, args, { cwd, signal }) => {
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn([program, ...args], { cwd, env: quietEnvironment(), stdin: "ignore", stdout: "pipe", stderr: "pipe", signal: signal ?? AbortSignal.timeout(RUN_TIMEOUT_MS) });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") throw new ProgramMissing(program);
    throw error;
  }
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited]);
  return { code, stdout, stderr };
};
