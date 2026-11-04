import assert from "node:assert/strict";
import test from "node:test";
import { authEnabled, authGate } from "../lib/auth-mode";

test("local dev is open, production keeps login unless the switch says otherwise", () => {
  assert.equal(authEnabled({ NODE_ENV: "development" }), false);
  assert.equal(authEnabled({ NODE_ENV: "test" }), false);
  assert.equal(authEnabled({}), false);
  assert.equal(authEnabled({ NODE_ENV: "production" }), true);
  assert.equal(authEnabled({ NODE_ENV: "development", WEIDU_AUTH: "on" }), true);
  assert.equal(authEnabled({ NODE_ENV: "production", WEIDU_AUTH: "off" }), false);
  assert.equal(authEnabled({ WEIDU_AUTH: "1" }), true);
  assert.equal(authEnabled({ NODE_ENV: "production", WEIDU_AUTH: "false" }), false);
  assert.equal(authEnabled({ WEIDU_AUTH: "  ON  " }), true);
});

test("auth off sends /login home and does not ask for a session", () => {
  assert.equal(authGate("/", false, false), "allow");
  assert.equal(authGate("/settings", false, false), "allow");
  assert.equal(authGate("/login", false, false), "home");
  assert.equal(authGate("/login", true, false), "home");
  assert.equal(authGate("/", false, true), "login");
  assert.equal(authGate("/login", false, true), "allow");
  assert.equal(authGate("/login", true, true), "home");
  assert.equal(authGate("/settings", true, true), "allow");
});
