#!/usr/bin/env node
// Autonomous dev loop.
//
// Each tick:
//   1. List open issues labeled `automation` on $REPO.
//   2. Skip ones already labeled `in-progress` or with an existing PR on auto/issue-N.
//   3. Pick the oldest remaining issue.
//   4. Create a git worktree at .worktrees/issue-N on branch auto/issue-N.
//   5. Hand the issue body to the coding-agent.
//   6. If files changed, commit, push, open a PR, and comment back on the issue.
//   7. Sleep $POLL_SECONDS and repeat.
//
// Safety:
//   - --once   : run a single tick and exit (use this for cron or smoke tests).
//   - --dry-run: list what would be picked, take no side effects.
//   - hard limit of MAX_PRS_PER_HOUR PR creations (default 4).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  listOpenIssues,
  prExistsForBranch,
  createPr,
  commentIssue,
  addLabel,
  removeLabel,
  ensureLabel,
} from "./lib/github.js";
import { runCodingAgent, hasUncommittedChanges } from "./lib/agent.js";

const pexec = promisify(execFile);

const REPO = process.env.REPO || "DoraleeAI/openclaw-lab";
const LABEL_TODO = process.env.LABEL_TODO || "automation";
const LABEL_INPROGRESS = process.env.LABEL_INPROGRESS || "in-progress";
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 60);
const MAX_PRS_PER_HOUR = Number(process.env.MAX_PRS_PER_HOUR || 4);

const args = new Set(process.argv.slice(2));
const ONCE = args.has("--once");
const DRY_RUN = args.has("--dry-run");

const prTimestamps = []; // sliding-window rate limiter

function log(...m) {
  console.log(new Date().toISOString(), ...m);
}

function rateLimitOk() {
  const now = Date.now();
  while (prTimestamps.length && now - prTimestamps[0] > 60 * 60 * 1000) prTimestamps.shift();
  return prTimestamps.length < MAX_PRS_PER_HOUR;
}

async function git(args, cwd) {
  return pexec("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
}

async function ensureWorktree({ repoRoot, branch, issueNumber }) {
  const wtRoot = path.join(repoRoot, ".worktrees");
  await mkdir(wtRoot, { recursive: true });
  const wtPath = path.join(wtRoot, `issue-${issueNumber}`);
  // Clean stale worktree + stale local branch from a previous failed run.
  try { await git(["worktree", "remove", "--force", wtPath], repoRoot); } catch { /* not registered */ }
  await rm(wtPath, { recursive: true, force: true }).catch(() => {});
  try { await git(["branch", "-D", branch], repoRoot); } catch { /* no such branch */ }
  await git(["fetch", "origin", "main"], repoRoot);
  await git(["worktree", "add", "-b", branch, wtPath, "origin/main"], repoRoot);
  return wtPath;
}

async function processIssue({ issue, repoRoot }) {
  const branch = `auto/issue-${issue.number}`;

  // Dry-run short-circuits before any network side effects.
  if (DRY_RUN) {
    log(`#${issue.number}: ${issue.title}`);
    log(`  [dry-run] would create branch ${branch} and dispatch coding-agent.`);
    return;
  }
  if (await prExistsForBranch({ repo: REPO, branch })) {
    log(`#${issue.number}: PR already exists on ${branch}, skipping.`);
    return;
  }
  if (!rateLimitOk()) {
    log(`Rate limit reached (${MAX_PRS_PER_HOUR}/hr). Will retry next tick.`);
    return;
  }

  log(`#${issue.number}: ${issue.title}`);

  await ensureLabel({
    repo: REPO,
    name: LABEL_INPROGRESS,
    color: "fbca04",
    description: "Auto loop working on this",
  });
  await addLabel({ repo: REPO, number: issue.number, label: LABEL_INPROGRESS });

  let labelHeld = true;
  const releaseLabel = async () => {
    if (!labelHeld) return;
    labelHeld = false;
    await removeLabel({ repo: REPO, number: issue.number, label: LABEL_INPROGRESS }).catch((e) =>
      log(`  warning: could not remove ${LABEL_INPROGRESS}: ${e.message}`),
    );
  };

  try {
    const wtPath = await ensureWorktree({ repoRoot, branch, issueNumber: issue.number });

    const prompt = [
      `You are working on issue #${issue.number}: ${issue.title}`,
      "",
      "Issue body:",
      issue.body || "(no body)",
      "",
      "Make the minimum meaningful change. Keep edits small and reviewable.",
      "Do not modify .github/workflows. Do not add binary files.",
    ].join("\n");

    const result = await runCodingAgent({ cwd: wtPath, prompt });
    log(`  agent mode=${result.mode}`);

    if (!(await hasUncommittedChanges(wtPath))) {
      log(`  agent made no changes; releasing label and cleaning up.`);
      await git(["worktree", "remove", "--force", wtPath], repoRoot).catch(() => {});
      await git(["branch", "-D", branch], repoRoot).catch(() => {});
      await releaseLabel();
      return;
    }

    await git(["add", "-A"], wtPath);
    await git([
      "-c", "user.email=bot@openclaw.local",
      "-c", "user.name=openclaw-lab-bot",
      "commit", "-m", `auto: address #${issue.number}: ${issue.title}`,
    ], wtPath);
    await git(["push", "-u", "origin", branch], wtPath);

    const prBody = [
      `Closes #${issue.number}`,
      "",
      "Generated by the openclaw-lab autonomous loop.",
      "",
      "Agent summary:",
      "```",
      result.summary || "(no summary)",
      "```",
      "",
      "Review carefully before merging.",
    ].join("\n");

    const prUrl = await createPr({
      repo: REPO,
      title: `auto: ${issue.title}`,
      body: prBody,
      head: branch,
      cwd: wtPath,
    });
    prTimestamps.push(Date.now());
    log(`  opened ${prUrl}`);
    await commentIssue({ repo: REPO, number: issue.number, body: `Opened ${prUrl}` });
    // PR is the new state; the label has done its job.
    await releaseLabel();
  } catch (err) {
    log(`  processing failed: ${err.message}`);
    await commentIssue({
      repo: REPO,
      number: issue.number,
      body: `Autonomous loop failed on this issue:\n\n\`\`\`\n${String(err.message).slice(0, 1000)}\n\`\`\``,
    }).catch(() => {});
    await releaseLabel();
    throw err;
  }
}

async function tick({ repoRoot }) {
  const issues = await listOpenIssues({ repo: REPO, label: LABEL_TODO });
  const eligible = issues
    .filter((i) => !i.labels.some((l) => l.name === LABEL_INPROGRESS))
    .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));

  if (eligible.length === 0) {
    log(`no eligible issues (total ${issues.length}, skipped ${issues.length - eligible.length})`);
    return;
  }

  const next = eligible[0];
  await processIssue({ issue: next, repoRoot });
}

async function main() {
  // repoRoot = directory containing this file's package.json
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  log(`openclaw-lab loop starting -- repo=${REPO} dryRun=${DRY_RUN} once=${ONCE}`);

  if (ONCE) {
    await tick({ repoRoot });
    return;
  }

  // Long-running loop with graceful shutdown.
  let stop = false;
  const shutdown = (sig) => {
    log(`got ${sig}, shutting down after current tick`);
    stop = true;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!stop) {
    try {
      await tick({ repoRoot });
    } catch (err) {
      log("tick failed:", err.message);
    }
    if (stop) break;
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
  log("bye");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
