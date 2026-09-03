import assert from "node:assert/strict";
import { AUTH_COOKIE, createAdminSession, isAdminSession, isAuthorizedRequest, validAdminCredentials } from "../lib/auth";

assert.equal(validAdminCredentials("admin", "admin"), true);
assert.equal(validAdminCredentials("admin", "wrong"), false);
assert.equal(validAdminCredentials("other", "admin"), false);

const session = createAdminSession();
assert.equal(isAdminSession(session), true);
assert.equal(isAdminSession("forged"), false);
assert.equal(isAuthorizedRequest(new Request("https://opencast.test", { headers: { cookie: `${AUTH_COOKIE}=${encodeURIComponent(session)}` } })), true);
assert.equal(isAuthorizedRequest(new Request("https://opencast.test")), false);

console.log("Demo authentication tests passed.");
