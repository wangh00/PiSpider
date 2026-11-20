/**
 * Pi extension and package inventory for the desktop management window.
 *
 * The desktop must show what Pi will actually load: auto-discovered files,
 * configured paths, built-in extensions, and package declarations from both
 * user and project settings. Extension toggles are written as the same
 * `+path` / `-path` / `-builtin:name` entries that Pi's resource loader reads.
 */

import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { homeLayout } from "./home.js";
import { isPlainObject, readJson, writeJsonAtomic } from "./util.js";

const BUILTIN_EXTENSIONS = [
  {
    name: "mcp",
    label: "MCP",
    description: "MCP server bridge and MCP tools",
  },
  {
    name: "llama.cpp",
    label: "llama.cpp",
    description: "Local llama.cpp model integration",
  },
  {
    name: "codemode",
    label: "Code mode",
    description: "Code-mode tool surface",
  },
  {
    name: "tool-search",
    label: "Tool search",
    description: "Deferred tool discovery",
  },
];

const EXTENSION_FILE = /\.(?:ts|js)$/i;

function settingsPaths(home, projectRoot) {
  const layout = homeLayout(home);
  return {
    user: path.join(layout.agent, "settings.json"),
    project: projectRoot ? path.join(path.resolve(projectRoot), ".pi", "settings.json") : null,
  };
}

function extensionDirs(home, projectRoot) {
  const layout = homeLayout(home);
  return {
    user: path.join(layout.agent, "extensions"),
    project: projectRoot ? path.join(path.resolve(projectRoot), ".pi", "extensions") : null,
  };
}

function npmDirs(home, projectRoot) {
  const layout = homeLayout(home);
  return {
    user: path.join(layout.agent, "npm"),
    project: projectRoot ? path.join(path.resolve(projectRoot), ".pi", "npm") : null,
  };
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
}

function toPosix(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function normalizedPath(value) {
  return toPosix(path.resolve(value)).replace(/\/+$/u, "").toLowerCase();
}

function exactReferenceMatches(reference, pattern, baseDir, absolutePath) {
  const normalizedPattern = normalizedPath(pattern.startsWith("./") ? path.join(baseDir, pattern.slice(2)) : path.isAbsolute(pattern) ? pattern : path.join(baseDir, pattern));
  return normalizedPattern === normalizedPath(absolutePath) || toPosix(reference).toLowerCase() === toPosix(pattern).toLowerCase();
}

function globToRegExp(pattern) {
  const escaped = toPosix(pattern)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\\\*/gu, "*");
  let source = "";
  for (let index = 0; index < escaped.length; index += 1) {
    const char = escaped[index];
    if (char === "*") {
      if (escaped[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`, "i");
}

function patternMatches(reference, pattern, baseDir, absolutePath) {
  const normalizedPattern = toPosix(pattern);
  const relative = toPosix(reference);
  if (globToRegExp(normalizedPattern).test(relative)) return true;
  const absolutePattern = path.isAbsolute(pattern) ? pattern : path.join(baseDir, pattern);
  return globToRegExp(toPosix(path.resolve(absolutePattern))).test(toPosix(path.resolve(absolutePath)));
}

function hasOverride(reference, absolutePath, entries, baseDir) {
  return entries.some((entry) => {
    if (entry.startsWith("!")) return patternMatches(reference, entry.slice(1), baseDir, absolutePath);
    if (entry.startsWith("+") || entry.startsWith("-")) {
      return exactReferenceMatches(reference, entry.slice(1), baseDir, absolutePath);
    }
    return false;
  });
}

function applyOverrides(reference, absolutePath, entries, baseDir) {
  let enabled = true;
  for (const entry of entries) {
    if (entry.startsWith("!") && patternMatches(reference, entry.slice(1), baseDir, absolutePath)) {
      enabled = false;
    }
  }
  for (const entry of entries) {
    if (entry.startsWith("+") && exactReferenceMatches(reference, entry.slice(1), baseDir, absolutePath)) {
      enabled = true;
    }
  }
  for (const entry of entries) {
    if (entry.startsWith("-") && exactReferenceMatches(reference, entry.slice(1), baseDir, absolutePath)) {
      enabled = false;
    }
  }
  return enabled;
}

function packageJsonExtensionEntries(packageRoot, manifest) {
  const pi = isPlainObject(manifest?.pi) ? manifest.pi : null;
  if (!pi || !Array.isArray(pi.extensions)) return null;
  return pi.extensions
    .filter((entry) => typeof entry === "string" && entry.trim() && !entry.startsWith("!") && !entry.startsWith("+") && !entry.startsWith("-"))
    .filter((entry) => !entry.includes("*") && !entry.includes("?"))
    .map((entry) => path.resolve(packageRoot, entry));
}

async function resolveExtensionEntries(directory) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    const manifestEntries = packageJsonExtensionEntries(directory, packageJson);
    if (manifestEntries) return manifestEntries;
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }

  for (const name of ["index.ts", "index.js"]) {
    const candidate = path.join(directory, name);
    try {
      if ((await stat(candidate)).isFile()) return [candidate];
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function collectExtensionFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const rootEntries = await resolveExtensionEntries(directory);
    if (rootEntries) return rootEntries;

    const files = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(directory, entry.name);
      let isFile = entry.isFile();
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          const info = await stat(fullPath);
          isFile = info.isFile();
          isDirectory = info.isDirectory();
        } catch {
          continue;
        }
      }
      if (isFile && EXTENSION_FILE.test(entry.name)) {
        files.push(fullPath);
      } else if (isDirectory) {
        const nested = await resolveExtensionEntries(fullPath);
        if (nested) files.push(...nested);
      }
    }
    return files;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function configuredExtensionEntries(entries) {
  return entries.filter(
    (entry) =>
      !entry.startsWith("!") &&
      !entry.startsWith("+") &&
      !entry.startsWith("-") &&
      !entry.startsWith("builtin:"),
  );
}

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function extensionRow({ scope, source, name, filePath, relativePath, enabled, loaded, builtin = false }) {
  const reference = builtin
    ? (String(name).startsWith("builtin:") ? String(name) : `builtin:${name}`)
    : toPosix(relativePath);
  return {
    id: `${scope}:${reference}`,
    name,
    scope,
    source,
    builtin,
    path: filePath,
    relativePath: toPosix(relativePath),
    enabled,
    loaded,
  };
}

async function listScopedExtensions({ scope, directory, baseDir, entries, loaded }) {
  if (!directory || !baseDir) return [];
  const files = await collectExtensionFiles(directory);
  const rows = [];
  const seen = new Set();

  for (const filePath of files.sort((left, right) => left.localeCompare(right))) {
    const relativePath = path.relative(baseDir, filePath);
    const row = extensionRow({
      scope,
      source: "auto",
      name: path.basename(filePath),
      filePath,
      relativePath,
      enabled: applyOverrides(relativePath, filePath, entries, baseDir),
      loaded,
    });
    rows.push(row);
    seen.add(normalizedPath(filePath));
  }

  for (const entry of configuredExtensionEntries(entries)) {
    const resolved = path.isAbsolute(entry) ? entry : path.resolve(baseDir, entry);
    const exists = await fileExists(resolved);
    const row = extensionRow({
      scope,
      source: "settings",
      name: path.basename(resolved),
      filePath: resolved,
      relativePath: path.relative(baseDir, resolved),
      enabled: applyOverrides(path.relative(baseDir, resolved), resolved, entries, baseDir),
      loaded,
    });
    row.exists = exists;
    if (!seen.has(normalizedPath(resolved))) {
      rows.push(row);
      seen.add(normalizedPath(resolved));
    }
  }
  return rows;
}

function builtinRow(name, entries, baseDir, scope, loaded) {
  const reference = `builtin:${name}`;
  return {
    ...extensionRow({
      scope,
      source: "builtin",
      name: reference,
      filePath: reference,
      relativePath: reference,
      enabled: applyOverrides(reference, path.join(baseDir, reference), entries, baseDir),
      loaded,
      builtin: true,
    }),
    label: BUILTIN_EXTENSIONS.find((item) => item.name === name)?.label || name,
    description: BUILTIN_EXTENSIONS.find((item) => item.name === name)?.description || "",
  };
}

function listBuiltinExtensions(userEntries, projectEntries, userBase, projectBase, projectTrusted) {
  return BUILTIN_EXTENSIONS.map((item) => {
    const userRow = builtinRow(item.name, userEntries, userBase, "user", true);
    const projectRow = projectEntries
      ? builtinRow(item.name, projectEntries, projectBase, "project", projectTrusted)
      : null;
    const projectOverride =
      projectRow &&
      hasOverride(projectRow.relativePath, path.join(projectBase, projectRow.relativePath), projectEntries, projectBase);
    const row = projectOverride ? projectRow : userRow;
    return {
      ...row,
      loaded: true,
      overrideScope: projectOverride ? "project" : "user",
    };
  });
}

function parsePackageName(source) {
  if (typeof source !== "string" || !source.startsWith("npm:")) return null;
  const spec = source.slice(4);
  if (!spec) return null;
  if (spec.startsWith("@")) {
    const parts = spec.split("@");
    if (parts.length < 3) return null;
    return `${parts[0]}@${parts[1]}`;
  }
  const name = spec.split("@")[0];
  return name || null;
}

function packageFilters(pkg) {
  const filters = {};
  for (const key of ["extensions", "skills", "prompts", "themes"]) {
    if (Array.isArray(pkg?.[key])) filters[key] = pkg[key].filter((entry) => typeof entry === "string");
  }
  return filters;
}

function isLocalPackageSource(source) {
  return (
    path.isAbsolute(source) ||
    /^\.\.?[\\/]/u.test(source) ||
    source.startsWith(".\\") ||
    source.startsWith("../") ||
    source.startsWith("./")
  );
}

async function installedPackageInfo(source, scope, baseDir, home, projectRoot) {
  const npmName = parsePackageName(source);
  if (npmName) {
    const npmRoot = npmDirs(home, projectRoot)[scope];
    const installPath = path.join(npmRoot, "node_modules", npmName);
    if (!(await fileExists(installPath))) return { installed: false, installPath };
    try {
      const packageJson = JSON.parse(await readFile(path.join(installPath, "package.json"), "utf8"));
      return { installed: true, installPath, version: packageJson.version || null };
    } catch {
      return { installed: true, installPath };
    }
  }
  if (isLocalPackageSource(source)) {
    const resolved = path.isAbsolute(source) ? source : path.resolve(baseDir, source);
    const installed = await fileExists(resolved);
    return { installed, installPath: resolved, removeSource: resolved };
  }
  return { installed: null, installPath: null };
}

async function listPackagesForScope({ scope, settingsPath, settings, baseDir, home, projectRoot, loaded }) {
  const entries = Array.isArray(settings.packages) ? settings.packages : [];
  const rows = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      rows.push({
        id: `${scope}:${entry}`,
        source: entry,
        scope,
        settingsPath,
        loaded,
        autoload: true,
        filters: {},
        error: null,
        ...(await installedPackageInfo(entry, scope, baseDir, home, projectRoot)),
      });
      continue;
    }
    if (!isPlainObject(entry) || typeof entry.source !== "string" || !entry.source.trim()) {
      rows.push({
        id: `${scope}:invalid`,
        source: "—",
        scope,
        settingsPath,
        loaded,
        autoload: true,
        filters: {},
        error: "package 条目缺少 source",
      });
      continue;
    }
    const source = entry.source.trim();
    rows.push({
      id: `${scope}:${source}`,
      source,
      scope,
      settingsPath,
      loaded,
      autoload: entry.autoload !== false,
      filters: packageFilters(entry),
      error: null,
      ...(await installedPackageInfo(source, scope, baseDir, home, projectRoot)),
    });
  }
  return rows;
}

function packageScopeLoaded(scope, projectTrusted) {
  return scope === "user" || projectTrusted;
}

export async function listExtensionInventory(home, projectRoot = null, options = {}) {
  const projectTrusted = options.projectTrusted === true;
  const paths = settingsPaths(home, projectRoot);
  const dirs = extensionDirs(home, projectRoot);
  const userSettings = await readJson(paths.user, {});
  const projectSettings = paths.project ? await readJson(paths.project, {}) : {};
  const userEntries = stringArray(userSettings.extensions);
  const projectEntries = stringArray(projectSettings.extensions);
  const userBase = path.dirname(paths.user);
  const projectBase = paths.project ? path.dirname(paths.project) : null;

  const [userExtensions, projectExtensions] = await Promise.all([
    listScopedExtensions({
      scope: "user",
      directory: dirs.user,
      baseDir: userBase,
      entries: userEntries,
      loaded: true,
    }),
    dirs.project
      ? listScopedExtensions({
          scope: "project",
          directory: dirs.project,
          baseDir: projectBase,
          entries: projectEntries,
          loaded: projectTrusted,
        })
      : Promise.resolve([]),
  ]);

  const builtins = listBuiltinExtensions(
    userEntries,
    projectTrusted ? projectEntries : [],
    userBase,
    projectBase,
    projectTrusted,
  );

  const packages = [
    ...(await listPackagesForScope({
      scope: "user",
      settingsPath: paths.user,
      settings: userSettings,
      baseDir: userBase,
      home,
      projectRoot,
      loaded: true,
    })),
    ...(paths.project
      ? await listPackagesForScope({
          scope: "project",
          settingsPath: paths.project,
          settings: projectSettings,
          baseDir: projectBase,
          home,
          projectRoot,
          loaded: packageScopeLoaded("project", projectTrusted),
        })
      : []),
  ];

  return {
    extensions: [...userExtensions, ...projectExtensions, ...builtins],
    packages,
    dirs: {
      user: dirs.user,
      project: dirs.project,
      userNpm: npmDirs(home, projectRoot).user,
      projectNpm: npmDirs(home, projectRoot).project,
    },
    settings: {
      user: paths.user,
      project: paths.project,
      projectTrusted,
    },
  };
}

function validToggleReference(reference) {
  if (typeof reference !== "string" || !reference.trim()) throw new Error("缺少扩展路径");
  const value = reference.trim();
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) throw new Error("扩展路径包含非法字符");
  if (value.startsWith("builtin:")) {
    if (!/^builtin:[a-zA-Z0-9._-]+$/u.test(value)) throw new Error("内置扩展名称无效");
  } else if (path.isAbsolute(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error("扩展路径必须是相对于 Pi 配置目录的路径");
  }
  return value;
}

export async function setExtensionEnabled(home, projectRoot, target = {}, enabled) {
  const scope = target.scope === "project" ? "project" : "user";
  if (scope === "project" && !projectRoot) throw new Error("缺少项目路径");
  const paths = settingsPaths(home, projectRoot);
  const settingsPath = paths[scope];
  const reference = validToggleReference(target.builtin ? `builtin:${String(target.name || "").replace(/^builtin:/u, "")}` : target.relativePath);
  const settings = await readJson(settingsPath, {});
  const entries = stringArray(settings.extensions);
  const managed = entries.filter((entry) => {
    if (!entry.startsWith("+") && !entry.startsWith("-")) return true;
    return !exactReferenceMatches(reference, entry.slice(1), path.dirname(settingsPath), path.resolve(path.dirname(settingsPath), reference));
  });
  managed.push(`${enabled ? "+" : "-"}${reference}`);
  settings.extensions = managed;
  await writeJsonAtomic(settingsPath, settings);
  return {
    ok: true,
    scope,
    settingsPath,
    reference,
    enabled: Boolean(enabled),
  };
}

export { BUILTIN_EXTENSIONS };
