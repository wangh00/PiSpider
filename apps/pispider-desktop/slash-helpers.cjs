/**
 * Pure helpers for the PiSpider desktop main process slash-command IPC channels.
 * Kept free of Electron imports so the functions are exercisable under node --test.
 */

const path = require("node:path");

/**
 * Validate an optional HTML export destination.
 *
 * Returns null when omitted so the existing default flow (runtime-chosen path)
 * is preserved. A provided value must be an absolute path ending in .html;
 * otherwise an Error with a user-facing message is thrown.
 */
function validateHtmlExportPath(requestedPath) {
  if (requestedPath === null || requestedPath === undefined) return null;
  const raw = String(requestedPath).trim();
  if (!raw) return null;
  if (!path.isAbsolute(raw)) throw new Error("导出路径必须是绝对路径");
  if (!raw.toLowerCase().endsWith(".html")) throw new Error("导出文件必须以 .html 结尾");
  return path.resolve(raw);
}

/**
 * Candidate locations for the core CHANGELOG.md, most specific first.
 * The cached runtime package lives under the core cache root's node_modules;
 * the local repo copy covers source checkouts.
 */
function changelogCandidates({ cacheRoot, repoRoot }) {
  const candidates = [];
  if (cacheRoot) {
    candidates.push(
      path.join(cacheRoot, "node_modules", "@earendil-works", "pi-coding-agent", "CHANGELOG.md"),
    );
  }
  if (repoRoot) {
    candidates.push(path.join(repoRoot, "packages", "coding-agent", "CHANGELOG.md"));
  }
  return candidates;
}

/** Return the first candidate whose file exists, or null. `exists` is async. */
async function locateChangelog({ candidates, exists }) {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Read the located changelog markdown and the version from its sibling
 * package.json, falling back to fallbackVersion when the manifest is missing
 * or unreadable.
 */
async function readChangelogFile({ changelogPath, fallbackVersion, readFile, readJson }) {
  const content = await readFile(changelogPath);
  let version = fallbackVersion || "";
  try {
    const pkg = await readJson(path.join(path.dirname(changelogPath), "package.json"));
    if (pkg && typeof pkg.version === "string" && pkg.version) version = pkg.version;
  } catch {
    // Keep the fallback version when package.json is missing or unreadable.
  }
  return { version, content: String(content), path: changelogPath };
}

module.exports = {
  validateHtmlExportPath,
  changelogCandidates,
  locateChangelog,
  readChangelogFile,
};
