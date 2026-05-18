// GitHub webhook receiver.
//
// Verifies X-Hub-Signature-256 against the RAW request body (not a
// re-serialized JSON), then routes by X-GitHub-Event. Today this just logs +
// dispatches issues.opened to a stub; the obvious next step is to enqueue
// a loop tick instead of polling.
import express from "express";

import { verifySignature } from "./verify.js";

const SECRET = process.env.GITHUB_WEBHOOK_SECRET || "dev-secret";
const PORT = Number(process.env.PORT || 3333);

if (SECRET === "dev-secret") {
  console.warn("[github-webhook] WARNING: using default dev-secret; set GITHUB_WEBHOOK_SECRET in prod.");
}

const app = express();

// Capture the raw bytes so we can verify GitHub's HMAC. JSON.stringify of
// the parsed body will NOT match byte-for-byte and breaks verification.
app.use(express.json({
  limit: "5mb",
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// --- Event handlers --------------------------------------------------------

async function onIssuesOpened(payload) {
  const n = payload.issue?.number;
  const title = payload.issue?.title;
  const labels = (payload.issue?.labels || []).map((l) => l.name);
  console.log(`[github-webhook] issues.opened #${n} "${title}" labels=${labels.join(",") || "(none)"}`);
  // TODO: wire to src/loop.js — e.g. write a flag file or POST to an
  // internal control endpoint that triggers a one-shot tick.
}

const handlers = {
  "issues": (payload) => {
    if (payload.action === "opened") return onIssuesOpened(payload);
    console.log(`[github-webhook] issues.${payload.action} #${payload.issue?.number} (ignored)`);
  },
  "ping": (payload) => console.log(`[github-webhook] ping: ${payload.zen}`),
};

// --- Routes ----------------------------------------------------------------

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/webhook/github", async (req, res) => {
  const ok = verifySignature({
    signature: req.headers["x-hub-signature-256"],
    rawBody: req.rawBody,
    secret: SECRET,
  });
  if (!ok) {
    return res.status(401).send("Invalid signature");
  }

  const event = req.headers["x-github-event"];
  const handler = handlers[event];
  if (!handler) {
    console.log(`[github-webhook] event=${event} (no handler)`);
    return res.status(200).send("ok");
  }

  try {
    await handler(req.body);
    res.status(200).send("ok");
  } catch (err) {
    console.error(`[github-webhook] handler error for ${event}:`, err);
    res.status(500).send("handler error");
  }
});

// Catch-all error handler so a thrown error doesn't crash the listener.
app.use((err, _req, res, _next) => {
  console.error("[github-webhook] unhandled:", err);
  res.status(500).send("server error");
});

const server = app.listen(PORT, () => {
  console.log(`[github-webhook] listening on :${PORT}`);
});

const shutdown = (sig) => {
  console.log(`[github-webhook] ${sig}, closing...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
