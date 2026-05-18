// HMAC verification for GitHub webhooks. Split out from the express handler
// so it can be unit-tested without spinning up the server.
import crypto from "crypto";

/**
 * Verify the X-Hub-Signature-256 header against a raw request body.
 *
 * @param {object} args
 * @param {string|undefined} args.signature - value of `X-Hub-Signature-256`.
 * @param {Buffer|undefined} args.rawBody   - the exact bytes GitHub POSTed.
 * @param {string} args.secret              - the shared webhook secret.
 * @returns {boolean} true iff signature matches.
 */
export function verifySignature({ signature, rawBody, secret }) {
  if (!signature || typeof signature !== "string" || !signature.startsWith("sha256=")) return false;
  if (!rawBody || rawBody.length === 0) return false;
  if (!secret) return false;

  const expected = "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; guard before calling.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
