import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migratePiConfig } from "./pispider-migrate.mjs";

async function tempRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pispider-migrate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("migrates core config, rewrites old agent paths, and ignores sessions", async (t) => {
  const root = await tempRoot(t);
  const source = path.join(root, "pi-agent");
  const target = path.join(root, "pispider", "agent");
  await writeJson(path.join(source, "auth.json"), { token: "secret" });
  await mkdir(path.dirname(path.join(source, "settings.json")), { recursive: true });
  await writeFile(
    path.join(source, "settings.json"),
    `\uFEFF${JSON.stringify({
      resourcePaths: [path.join(source, "skills")],
      legacy: "~/.pi/agent/prompts",
      rootReference: "~/.pi/themes",
      nested: { path: path.join(source, "themes") },
    }, null, 2)}\n`,
    "utf8",
  );
  await mkdir(path.join(source, "sessions", "--project--"), { recursive: true });
  await writeFile(path.join(source, "sessions", "--project--", "session.jsonl"), "{}\n", "utf8");

  const report = await migratePiConfig({ source, target });
  assert.ok(report.copied.some((file) => file.endsWith("auth.json")));
  assert.ok(report.copied.some((file) => file.endsWith("settings.json")));
  assert.equal(await readFile(path.join(target, "auth.json"), "utf8"), await readFile(path.join(source, "auth.json"), "utf8"));

  const settings = JSON.parse(await readFile(path.join(target, "settings.json"), "utf8"));
  assert.equal(settings.resourcePaths[0], path.join(target, "skills").replaceAll("\\", "/"));
  assert.equal(settings.legacy, path.join(target, "prompts").replaceAll("\\", "/"));
  assert.equal(settings.rootReference, path.join(target, "themes").replaceAll("\\", "/"));
  assert.equal(settings.nested.path, path.join(target, "themes").replaceAll("\\", "/"));
  await assert.rejects(() => stat(path.join(target, "sessions")));
});

test("does not overwrite existing target files", async (t) => {
  const root = await tempRoot(t);
  const source = path.join(root, "pi-agent");
  const target = path.join(root, "pispider", "agent");
  await writeJson(path.join(source, "auth.json"), { token: "new" });
  await writeJson(path.join(target, "auth.json"), { token: "existing" });

  const report = await migratePiConfig({ source, target });
  assert.ok(report.skipped.some((file) => file.endsWith("auth.json")));
  assert.deepEqual(JSON.parse(await readFile(path.join(target, "auth.json"), "utf8")), { token: "existing" });
});

test("resources and extensions are opt-in and dry-run writes nothing", async (t) => {
  const root = await tempRoot(t);
  const source = path.join(root, "pi-agent");
  const target = path.join(root, "pispider", "agent");
  await mkdir(path.join(source, "themes"), { recursive: true });
  await writeFile(path.join(source, "themes", "theme.json"), "{}\n", "utf8");
  await mkdir(path.join(source, "extensions"), { recursive: true });
  await writeFile(path.join(source, "extensions", "extension.js"), "export {};\n", "utf8");

  const coreOnly = await migratePiConfig({ source, target });
  assert.equal(coreOnly.copied.length, 0);
  await assert.rejects(() => stat(path.join(target, "themes")));

  const dryRun = await migratePiConfig({ source, target, includeResources: true, dryRun: true });
  assert.ok(dryRun.copied.some((file) => file.includes(`${path.sep}themes${path.sep}`)));
  await assert.rejects(() => stat(path.join(target, "themes")));

  const all = await migratePiConfig({ source, target, includeResources: true, includeExtensions: true });
  assert.ok(all.copied.some((file) => file.includes(`${path.sep}themes${path.sep}`)));
  assert.ok(all.copied.some((file) => file.includes(`${path.sep}extensions${path.sep}`)));
  assert.ok((await stat(path.join(target, "themes", "theme.json"))).isFile());
  assert.ok((await stat(path.join(target, "extensions", "extension.js"))).isFile());
});

test("missing source fails before writing the target", async (t) => {
  const root = await tempRoot(t);
  const source = path.join(root, "missing");
  const target = path.join(root, "target");
  await assert.rejects(
    () => migratePiConfig({ source, target }),
    /Pi agent directory not found/,
  );
  await assert.rejects(() => stat(target));
});
