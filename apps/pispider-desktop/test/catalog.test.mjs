/**
 * Catalog manifest tests. The desktop app ships a single catalog.json for MCP
 * presets; these tests keep the normalized API stable.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MCP_CATALOG,
  findCatalogEntry,
  getCatalogDiagnostics,
  loadCatalog,
  describeCatalogInputs,
  resolveCatalogInvocation,
  buildManagedMcpServer,
  isManagedCatalogServer,
  preserveManagedCatalogMetadata,
} = require("../mcp-catalog.cjs");

test("catalog manifest exposes the Chrome DevTools and Context7 presets", () => {
  assert.equal(MCP_CATALOG.length, 2);
  assert.deepEqual(
    MCP_CATALOG.map((entry) => entry.id),
    ["chrome-devtools", "context7"],
  );
  const entry = findCatalogEntry("chrome-devtools");
  assert.ok(entry);
  assert.equal(entry.transport, "stdio");
  assert.equal(entry.packageName, "chrome-devtools-mcp");
  assert.equal(entry.version, "1.13.0");
  assert.equal(entry.binName, "chrome-devtools-mcp");
  assert.equal(entry.exposure, "codemode");
  assert.deepEqual(entry.mcpArgs, ["--no-usage-statistics", "--no-performance-crux"]);
  const context7 = findCatalogEntry("context7");
  assert.ok(context7);
  assert.equal(context7.transport, "http");
  assert.equal(context7.packageName, "");
  assert.equal(context7.url, "https://mcp.context7.com/mcp");
  assert.equal(context7.exposure, "direct");
  assert.deepEqual(getCatalogDiagnostics().errors, []);
});

test("HTTP catalog entries resolve headers and build a remote config", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pispider-catalog-http-"));
  try {
    const entry = {
      id: "demo-http",
      transport: "http",
      inputs: [
        {
          id: "apiKey",
          label: "API Key",
          kind: "text",
          default: "anonymous",
          required: true,
        },
      ],
      url: "https://example.com/mcp/${input.apiKey}",
      headers: { Authorization: "Bearer ${input.apiKey}" },
      mcpArgs: [],
      env: {},
    };
    const invocation = resolveCatalogInvocation(entry, { home: root, workspace: root });
    assert.equal(invocation.url, "https://example.com/mcp/anonymous");
    assert.deepEqual(invocation.headers, { Authorization: "Bearer anonymous" });
    const server = buildManagedMcpServer(entry, { binPath: "" }, "node", invocation);
    assert.equal(server.url, "https://example.com/mcp/anonymous");
    assert.deepEqual(server.headers, { Authorization: "Bearer anonymous" });
    assert.equal(server.command, undefined);
    assert.equal(server.enabled, true);
    assert.equal(server.catalogId, "demo-http");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("future catalog entries can resolve input placeholders", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pispider-catalog-inputs-"));
  try {
    const paths = { home: root, workspace: root };
    const entry = {
      id: "demo",
      inputs: [
        {
          id: "workspace",
          label: "可访问目录",
          kind: "directory",
          default: "${WORKSPACE}",
          required: true,
        },
      ],
      mcpArgs: ["${input.workspace}"],
      env: { DEMO_HOME: "${PISPIDER_AGENT_DIR}${PATH_SEP}demo.jsonl" },
    };
    const described = describeCatalogInputs(entry, paths);
    assert.equal(described[0].default, root);
    const invocation = resolveCatalogInvocation(entry, paths);
    assert.deepEqual(invocation.args, [root]);
    assert.deepEqual(invocation.inputs, { workspace: root });
    assert.equal(path.normalize(invocation.env.DEMO_HOME), path.join(root, "agent", "demo.jsonl"));

    const server = buildManagedMcpServer(entry, { binPath: "demo.js" }, "node", invocation);
    assert.deepEqual(server.args, ["demo.js", root]);
    assert.equal(path.normalize(server.env.DEMO_HOME), path.join(root, "agent", "demo.jsonl"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("catalog placeholders honor an explicit agent directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pispider-catalog-agent-dir-"));
  try {
    const agentDir = path.join(root, "agent-custom");
    const paths = { home: root, agentDir, workspace: root };
    const entry = {
      id: "demo",
      inputs: [
        {
          id: "agent",
          label: "Agent 目录",
          kind: "text",
          default: "${PISPIDER_AGENT_DIR}",
          required: true,
        },
      ],
      mcpArgs: ["${input.agent}"],
      env: { AGENT_HOME: "${PISPIDER_AGENT_DIR}" },
    };
    const described = describeCatalogInputs(entry, paths);
    assert.equal(described[0].default, agentDir);
    const invocation = resolveCatalogInvocation(entry, paths);
    assert.deepEqual(invocation.args, [agentDir]);
    assert.equal(path.normalize(invocation.env.AGENT_HOME), path.normalize(agentDir));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed catalog metadata survives edits and only exact ids match", () => {
  const entry = { id: "demo" };
  const previous = {
    managedBy: "pispider",
    catalogId: "demo",
    packageName: "demo-mcp",
    packageVersion: "1.0.0",
  };
  assert.equal(isManagedCatalogServer(previous, entry), true);
  assert.equal(isManagedCatalogServer({ ...previous, catalogId: "other" }, entry), false);
  assert.equal(isManagedCatalogServer({ managedBy: "user", catalogId: "demo" }, entry), false);
  assert.equal(isManagedCatalogServer(previous, null), false);

  const next = preserveManagedCatalogMetadata({ command: "node", args: ["demo.js"] }, previous, entry);
  assert.deepEqual(next, {
    command: "node",
    args: ["demo.js"],
    managedBy: "pispider",
    catalogId: "demo",
    packageName: "demo-mcp",
    packageVersion: "1.0.0",
  });
  assert.equal(preserveManagedCatalogMetadata({ url: "https://example.com" }, { managedBy: "user" }, entry).managedBy, undefined);
});

test("directory input rejects a missing path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pispider-catalog-missing-"));
  try {
    const entry = {
      id: "demo",
      inputs: [
        {
          id: "workspace",
          label: "可访问目录",
          kind: "directory",
          default: "${WORKSPACE}",
          required: true,
        },
      ],
      mcpArgs: ["${input.workspace}"],
      env: {},
    };
    assert.throws(
      () => resolveCatalogInvocation(entry, { home: root, workspace: root }, { workspace: path.join(root, "missing") }),
      /不存在/,
    );
    assert.throws(() => resolveCatalogInvocation(entry, { home: root, workspace: root }, { workspace: "" }), /请填写/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop package files include the catalog and loader", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageJson.files.includes("mcp-catalog.cjs"));
  assert.ok(packageJson.files.includes("catalog/**/*"));
});

test("loadCatalog keeps valid entries and reports invalid ones", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pispider-catalog-"));
  const catalogPath = path.join(root, "catalog.json");
  try {
    await writeFile(
      catalogPath,
      JSON.stringify({
        version: 1,
        mcp: [
          {
            id: "valid",
            name: "valid",
            package: { name: "valid-mcp", version: "1.0.0" },
          },
          {
            id: "broken",
            name: "broken",
            package: { name: "broken-mcp", version: "1.0.0" },
            exposure: "unsupported",
          },
        ],
      }),
      "utf8",
    );
    const catalog = loadCatalog(catalogPath);
    assert.equal(catalog.mcp.length, 1);
    assert.equal(catalog.mcp[0].id, "valid");
    assert.equal(catalog.errors.length, 1);
    assert.match(catalog.errors[0], /exposure/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("catalog rejects packaged skill declarations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pispider-catalog-skills-"));
  const catalogPath = path.join(root, "catalog.json");
  try {
    await writeFile(
      catalogPath,
      JSON.stringify({
        version: 1,
        mcp: [
          {
            id: "demo",
            name: "demo",
            package: { name: "demo-mcp", version: "1.0.0" },
            skills: [{ id: "demo-skill", source: "skills/demo" }],
          },
        ],
        skills: [{ id: "legacy", source: { type: "mcp-package", catalogId: "demo", path: "skills/demo" } }],
      }),
      "utf8",
    );
    const catalog = loadCatalog(catalogPath);
    assert.equal(catalog.mcp.length, 0);
    assert.match(catalog.errors.join("\n"), /skills 已移除/);
    assert.match(catalog.errors.join("\n"), /catalog\.json\.skills 已移除/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
