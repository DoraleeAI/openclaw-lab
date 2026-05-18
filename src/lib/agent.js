// Delegate the actual code change to a coding agent.
//
// MVP behavior: we shell out to `claude` (Claude Code in --print mode) inside a
// git worktree. If `claude` isn't on PATH, fall back to a stub mode that writes
// a tracked STUB.md file so the loop's PR pipeline can still be exercised
// end-to-end without an LLM bill.
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

async function onPath(bin) {
  return new Promise((resolve) => {
    const p = spawn("which", [bin], { stdio: "ignore" });
    p.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Run a coding agent inside `cwd` against `prompt`.
 * Returns { mode: "claude"|"stub", summary }.
 */
export async function runCodingAgent({ cwd, prompt, timeoutMs = 10 * 60 * 1000 }) {
  if (await onPath("claude")) {
    return await runClaude({ cwd, prompt, timeoutMs });
  }
  return await runStub({ cwd, prompt });
}

function runClaude({ cwd, prompt, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = ["--print", "--permission-mode", "bypassPermissions", prompt];
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
      resolve({ mode: "claude", summary: stdout.trim().slice(0, 4000) });
    });
  });
}

async function runStub({ cwd, prompt }) {
  // STUB.md is intentionally tracked (not gitignored) so the loop's PR
  // pipeline can be exercised end-to-end without a real coding agent.
  const taskPath = path.join(cwd, "STUB.md");
  await writeFile(
    taskPath,
    `# Stub Agent Task\n\nNo coding agent (\`claude\`) was on PATH, so this is a stub run.\n\n## Prompt\n\n${prompt}\n`,
    "utf8",
  );
  return { mode: "stub", summary: "Wrote STUB.md (stub mode: no coding agent on PATH)." };
}

export async function hasUncommittedChanges(cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn("git", ["status", "--porcelain"], { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("exit", () => resolve(out.trim().length > 0));
  });
}
