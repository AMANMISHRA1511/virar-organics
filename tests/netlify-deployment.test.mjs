import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createRedirects,
  netlifyClientEnvironment,
  validateBackendOrigin,
  writeRedirects,
} from "../scripts/netlify-build.mjs";
import { socketTransportOptions } from "../frontend/src/realtime-options.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = "https://virar-api.onrender.com";
const parseRules = (value) =>
  createRedirects(value)
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));

test("requires an explicit backend origin instead of a dummy or local fallback", () => {
  for (const value of [undefined, null, "", " ", false, 4000]) {
    assert.throws(() => validateBackendOrigin(value), /BACKEND_ORIGIN/);
  }
});

test("accepts and canonicalizes only a standalone public HTTPS DNS origin", () => {
  assert.equal(
    validateBackendOrigin("https://VIRAR-API.onrender.com/"),
    backend,
  );
  assert.equal(validateBackendOrigin(`${backend}:8443`), `${backend}:8443`);
  assert.equal(validateBackendOrigin(`${backend}:443/`), backend);
});

test("rejects insecure, credential-bearing, private and ambiguous URL targets", () => {
  const values = [
    "http://virar-api.onrender.com",
    "//virar-api.onrender.com",
    "https://user:password@virar-api.onrender.com",
    "https://@virar-api.onrender.com",
    `${backend}/api`,
    `${backend}/a/..`,
    `${backend}/?token=secret`,
    `${backend}/#part`,
    `${backend}?`,
    `${backend}#`,
    `${backend}\\api`,
    ` ${backend}`,
    `${backend}\n`,
    `${backend}\n/* https://attacker.example.org/:splat 200!`,
    "https://127.0.0.1",
    "https://2130706433",
    "https://0x7f000001",
    "https://[::1]",
    "https://10.0.0.10",
    "https://localhost",
    "https://api.localhost",
    "https://api.internal",
    "https://api.local",
    "https://api.test",
    "https://api",
    "https://api..example.com",
    "https://-api.example.com",
    "https://api.example.com.",
    "https://api.example.com:65536",
  ];
  for (const value of values) {
    assert.throws(() => validateBackendOrigin(value), /BACKEND_ORIGIN/, value);
  }
});

test("rejects a storefront or deploy URL as its own backend proxy target", () => {
  for (const origin of [
    "https://virar.netlify.app",
    "https://preview--virar.netlify.app",
  ]) {
    assert.throws(
      () =>
        validateBackendOrigin(origin, [
          "https://unrelated.example.com",
          `${origin}/`,
        ]),
      /proxy loop/,
    );
  }
  assert.equal(
    validateBackendOrigin(backend, ["https://virar.netlify.app"]),
    backend,
  );
});

test("keeps all API, image and polling routes ahead of the SPA fallback", () => {
  const rules = parseRules(backend);
  assert.deepEqual(
    rules.map((rule) => rule[0]),
    [
      "/api",
      "/api/*",
      "/uploads",
      "/uploads/*",
      "/socket.io",
      "/socket.io/*",
      "/*",
    ],
  );
  for (const [from, target, status] of rules.slice(0, -1)) {
    assert.equal(
      status,
      "200!",
      `Must proxy ${from} even if a static file exists`,
    );
    assert.ok(target.startsWith(`${backend}/`));
    assert.equal(target.includes("/index.html"), false);
  }
  assert.deepEqual(rules.at(-1), ["/*", "/index.html", "200"]);
  assert.equal(
    rules.find((rule) => rule[0] === "/api/*")[1],
    `${backend}/api/:splat`,
  );
  assert.equal(
    rules.find((rule) => rule[0] === "/socket.io/*")[1],
    `${backend}/socket.io/:splat`,
  );
});

test("invalid configuration creates no publish directory or partial routing file", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "virar-netlify-"));
  const output = path.join(temporary, "dist");
  try {
    await assert.rejects(
      writeRedirects(output, `${backend}/api`),
      /BACKEND_ORIGIN/,
    );
    await assert.rejects(readFile(path.join(output, "_redirects")), {
      code: "ENOENT",
    });
    await writeRedirects(output, backend);
    assert.equal(
      await readFile(path.join(output, "_redirects"), "utf8"),
      createRedirects(backend),
    );
    await assert.rejects(readFile(path.join(output, "_redirects.tmp")), {
      code: "ENOENT",
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("the Netlify CLI entry fails closed before Vite when the backend origin is absent", () => {
  const environment = { ...process.env };
  delete environment.BACKEND_ORIGIN;
  const result = spawnSync(process.execPath, ["scripts/netlify-build.mjs"], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BACKEND_ORIGIN is required/);
  assert.doesNotMatch(result.stdout, /building|transformed|built in/);
});

test("only the Netlify target selects polling and it cannot upgrade to WebSocket", () => {
  assert.deepEqual(socketTransportOptions("netlify"), {
    transports: ["polling"],
    upgrade: false,
  });
  for (const target of [undefined, "", "local", "server", "false"]) {
    assert.deepEqual(socketTransportOptions(target), {
      transports: ["websocket", "polling"],
    });
  }
});

test("build environment explicitly sets the public transport flag without creating public secret variables", () => {
  const input = {
    BACKEND_ORIGIN: backend,
    JWT_SECRET: "test-fixture-not-for-deployment",
    VITE_DEPLOY_TARGET: "local",
  };
  const result = netlifyClientEnvironment(input);
  assert.equal(result.VITE_DEPLOY_TARGET, "netlify");
  assert.equal(result.JWT_SECRET, input.JWT_SECRET);
  assert.equal(result.VITE_JWT_SECRET, undefined);
  assert.equal(result.VITE_BACKEND_ORIGIN, undefined);
  assert.equal(input.VITE_DEPLOY_TARGET, "local");
});
