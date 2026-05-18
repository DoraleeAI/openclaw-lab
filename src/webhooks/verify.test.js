import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { verifySignature } from "./verify.js";

const SECRET = "test-secret";

function sign(body, secret = SECRET) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("accepts a correctly signed body", () => {
  const rawBody = Buffer.from('{"hello":"world"}');
  const signature = sign(rawBody);
  assert.equal(verifySignature({ signature, rawBody, secret: SECRET }), true);
});

test("rejects a body signed with a different secret", () => {
  const rawBody = Buffer.from('{"hello":"world"}');
  const signature = sign(rawBody, "wrong-secret");
  assert.equal(verifySignature({ signature, rawBody, secret: SECRET }), false);
});

test("rejects when payload bytes are tampered with after signing", () => {
  const original = Buffer.from('{"hello":"world"}');
  const signature = sign(original);
  const tampered = Buffer.from('{"hello":"WORLD"}');
  assert.equal(verifySignature({ signature, rawBody: tampered, secret: SECRET }), false);
});

test("rejects missing or malformed signature header", () => {
  const rawBody = Buffer.from("x");
  assert.equal(verifySignature({ signature: undefined, rawBody, secret: SECRET }), false);
  assert.equal(verifySignature({ signature: "", rawBody, secret: SECRET }), false);
  assert.equal(verifySignature({ signature: "sha1=deadbeef", rawBody, secret: SECRET }), false);
  assert.equal(verifySignature({ signature: "sha256=", rawBody, secret: SECRET }), false);
});

test("rejects empty body even if header is present", () => {
  const rawBody = Buffer.alloc(0);
  const signature = sign(Buffer.from("anything"));
  assert.equal(verifySignature({ signature, rawBody, secret: SECRET }), false);
});

test("rejects when secret is missing", () => {
  const rawBody = Buffer.from("x");
  const signature = sign(rawBody);
  assert.equal(verifySignature({ signature, rawBody, secret: "" }), false);
});

test("does not throw on length mismatch with the expected digest", () => {
  // crypto.timingSafeEqual would throw on differing buffer lengths; the
  // verifier must guard before calling it.
  const rawBody = Buffer.from("x");
  assert.equal(
    verifySignature({ signature: "sha256=abcd", rawBody, secret: SECRET }),
    false,
  );
});
