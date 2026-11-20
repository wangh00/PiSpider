import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { listExtensionInventory, setExtensionEnabled } from "../src/extensions.js";

const temporaryRoots = [];

async function makeWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pispider-extensions-"));
  temporaryRoots.push(root);
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  await mkdir(path.join(home, "agent", "extensions"), { recursive: true });
  await mkdir(path.join(project, ".pi", "extensions"), { recursive: true });
  await writeFile(path.join(home, "agent", "extensions", "alpha.ts"), "export {};\n", "utf8");
  await writeFile(path.join(home, "agent", "extensions", "beta.js"), "export {};\n", "utf8");
  await writeFile(path.join(project, ".pi", "extensions", "gamma.ts"), "export {};\n", "utf8");
  await writeFile(path.join(home, "agent", "settings.json"), JSON.stringify({ extensions: ["-extensions/beta.js"] }), "utf8");
  await writeFile(path.join(project, ".pi", "settings.json"), JSON.stringify({ packages: ["./local-package"] }), "utf8");
  return { root, home, project };
}

afterEach(async () => {
  while (temporaryRoots.length) await rm(temporaryRoots.pop(), { recursive: true, force: true });
});

describe("listExtensionInventory", () => {
  it("lists auto extensions, builtins and package declarations with scoped state", async () => {
    const { home, project } = await makeWorkspace();
    const inventory = await listExtensionInventory(home, project, { projectTrusted: true });
    const rows = inventory.extensions;
    const alpha = rows.find((row) => row.id === "user:extensions/alpha.ts");
    const beta = rows.find((row) => row.id === "user:extensions/beta.js");
    const gamma = rows.find((row) => row.id === "project:extensions/gamma.ts");
    assert.equal(alpha?.enabled, true);
    assert.equal(beta?.enabled, false);
    assert.equal(gamma?.loaded, true);
    assert.equal(rows.filter((row) => row.builtin).length, 4);
    assert.equal(inventory.packages.length, 1);
    assert.equal(inventory.packages[0].scope, "project");
    assert.equal(inventory.packages[0].source, "./local-package");
  });

  it("marks project extensions unloaded when project trust is missing", async () => {
    const { home, project } = await makeWorkspace();
    const inventory = await listExtensionInventory(home, project, { projectTrusted: false });
    const gamma = inventory.extensions.find((row) => row.id === "project:extensions/gamma.ts");
    assert.equal(gamma?.loaded, false);
  });

  it("reads npm package install metadata from the scoped npm root", async () => {
    const { home, project } = await makeWorkspace();
    await mkdir(path.join(home, "agent", "npm", "node_modules", "pi-tools"), { recursive: true });
    await writeFile(
      path.join(home, "agent", "npm", "node_modules", "pi-tools", "package.json"),
      JSON.stringify({ name: "pi-tools", version: "1.2.3" }),
      "utf8",
    );
    await writeFile(
      path.join(home, "agent", "settings.json"),
      JSON.stringify({ packages: ["npm:pi-tools@1.0.0"] }),
      "utf8",
    );
    const inventory = await listExtensionInventory(home, project, { projectTrusted: true });
    const packageRow = inventory.packages.find((row) => row.source === "npm:pi-tools@1.0.0");
    assert.equal(packageRow?.installed, true);
    assert.equal(packageRow?.version, "1.2.3");
  });
});

describe("setExtensionEnabled", () => {
  it("writes a -path override and can restore with +path", async () => {
    const { home, project } = await makeWorkspace();
    await setExtensionEnabled(home, project, { scope: "user", relativePath: "extensions/alpha.ts" }, false);
    let settings = JSON.parse(await readFile(path.join(home, "agent", "settings.json"), "utf8"));
    assert.deepEqual(settings.extensions, ["-extensions/beta.js", "-extensions/alpha.ts"]);

    await setExtensionEnabled(home, project, { scope: "user", relativePath: "extensions/alpha.ts" }, true);
    settings = JSON.parse(await readFile(path.join(home, "agent", "settings.json"), "utf8"));
    assert.deepEqual(settings.extensions, ["-extensions/beta.js", "+extensions/alpha.ts"]);
  });

  it("toggles builtin extensions and rejects escaping paths", async () => {
    const { home, project } = await makeWorkspace();
    await setExtensionEnabled(home, project, { scope: "user", builtin: true, name: "builtin:mcp" }, false);
    const settings = JSON.parse(await readFile(path.join(home, "agent", "settings.json"), "utf8"));
    assert.deepEqual(settings.extensions, ["-extensions/beta.js", "-builtin:mcp"]);

    await assert.rejects(
      () => setExtensionEnabled(home, project, { scope: "user", relativePath: "../escape.ts" }, false),
      /相对/,
    );
  });
});
