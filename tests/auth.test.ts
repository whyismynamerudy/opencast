import assert from "node:assert/strict";
import { AUTH_COOKIE, createAdminSession, isAdminSession, isAuthorizedRequest, validAdminCredentials } from "../lib/auth";

// Credentials come only from the environment; the repository contains none.
// The auth module reads them per call, so setting them after import is fine.
process.env.OPENCAST_AUTH_USERNAME = "test-admin";
process.env.OPENCAST_AUTH_PASSWORD = "test-password";

assert.equal(validAdminCredentials("test-admin", "test-password"), true);
assert.equal(validAdminCredentials("test-admin", "wrong"), false);
assert.equal(validAdminCredentials("other", "test-password"), false);

// Login fails closed when the environment is not configured.
const previousUsername = process.env.OPENCAST_AUTH_USERNAME;
delete process.env.OPENCAST_AUTH_USERNAME;
assert.equal(validAdminCredentials("", ""), false);
assert.equal(validAdminCredentials("test-admin", "test-password"), false);
process.env.OPENCAST_AUTH_USERNAME = previousUsername;

const session = createAdminSession();
assert.equal(isAdminSession(session), true);
assert.equal(isAdminSession("forged"), false);
assert.equal(isAuthorizedRequest(new Request("https://opencast.test", { headers: { cookie: `${AUTH_COOKIE}=${encodeURIComponent(session)}` } })), true);
assert.equal(isAuthorizedRequest(new Request("https://opencast.test")), false);

console.log("Demo authentication tests passed.");
