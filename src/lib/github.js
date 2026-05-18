// Thin async wrapper around the `gh` CLI. Keeps the loop free of REST plumbing.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

async function gh(args, { cwd } = {}) {
  const { stdout } = await pexec("gh", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

/** List open issues with a given label. Returns array of {number,title,body,labels,updatedAt}. */
export async function listOpenIssues({ repo, label, limit = 20 }) {
  const out = await gh([
    "issue", "list",
    "-R", repo,
    "--state", "open",
    "--label", label,
    "--limit", String(limit),
    "--json", "number,title,body,labels,updatedAt",
  ]);
  return JSON.parse(out);
}

/** True if any open PR's head branch matches `branch`. */
export async function prExistsForBranch({ repo, branch }) {
  const out = await gh([
    "pr", "list",
    "-R", repo,
    "--state", "open",
    "--head", branch,
    "--json", "number",
  ]);
  return JSON.parse(out).length > 0;
}

/** Create a PR. Returns the URL. */
export async function createPr({ repo, title, body, base = "main", head, cwd }) {
  const out = await gh([
    "pr", "create",
    "-R", repo,
    "--base", base,
    "--head", head,
    "--title", title,
    "--body", body,
  ], { cwd });
  return out.trim();
}

/** Comment on an issue. */
export async function commentIssue({ repo, number, body }) {
  await gh([
    "issue", "comment", String(number),
    "-R", repo,
    "--body", body,
  ]);
}

/** Add a label to an issue (used to mark "in progress" so we don't re-pick it). */
export async function addLabel({ repo, number, label }) {
  await gh(["issue", "edit", String(number), "-R", repo, "--add-label", label]);
}

/** Remove a label from an issue. */
export async function removeLabel({ repo, number, label }) {
  await gh(["issue", "edit", String(number), "-R", repo, "--remove-label", label]);
}

/** Ensure a repo label exists (idempotent). */
export async function ensureLabel({ repo, name, color = "ededed", description = "" }) {
  try {
    await gh(["label", "create", name, "-R", repo, "--color", color, "--description", description]);
  } catch (err) {
    // `gh label create` exits non-zero if it already exists; that's fine.
    if (!String(err.stderr || err.message).match(/already exists/i)) throw err;
  }
}
