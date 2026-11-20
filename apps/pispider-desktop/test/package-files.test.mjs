import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");

test("electron-builder files include every relative helper required by main.cjs", async () => {
  const [mainSource, builderSource] = await Promise.all([
    fs.readFile(path.join(appDir, "main.cjs"), "utf8"),
    fs.readFile(path.join(appDir, "electron-builder.yml"), "utf8"),
  ]);
  const config = parse(builderSource);
  const files = config.files ?? [];
  const helpers = [...mainSource.matchAll(/require\("\.\/([^"]+\.cjs)"\)/g)].map((match) => match[1]);

  assert.ok(helpers.length > 0);
  for (const helper of helpers) {
    assert.ok(files.includes(helper), `electron-builder.yml files 缺少 main.cjs 依赖：${helper}`);
  }
});
