// Stage the PiSpider launcher closure and core runtime cache for packaged builds.
//
// Frozen layout contract (under build/packaged/):
//   launcher/scripts/run-pispider.mjs
//   launcher/scripts/pispider-launcher.mjs
//   launcher/packages/pispider/{package.json,src/,resources/,vendor/}
//   runtime/core-1.5.2/... (complete copy of the per-version core cache).
//   npm/ (npm 10.9.8 CLI plus its node_modules dependencies).
//   The versioned subdirectory keeps the bundled node_modules out of the
//   extraResources source root, which electron-builder excludes by default.
//
// Idempotent: the staging root is removed and recreated on every run. A missing
// core cache fails with a readable error. The script runs its own staging
// self-test before exiting; non-zero exit means the layout is incomplete.

import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveHome } from "../../../packages/pispider/src/home.js";

const CORE_VERSION = "1.5.2";
const BUNDLED_NPM_VERSION = "10.9.8";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");

const stagingRoot = path.join(desktopDir, "build", "packaged");
const launcherStage = path.join(stagingRoot, "launcher");
const runtimeStage = path.join(stagingRoot, "runtime");
const npmStage = path.join(stagingRoot, "npm");

const launcherScriptNames = ["run-pispider.mjs", "pispider-launcher.mjs"];
const pispiderPackageParts = ["package.json", "src", "resources", "vendor"];

function fail(message) {
	console.error(`prepare-packaged-runtime: ${message}`);
	process.exit(1);
}

function requireExisting(target, label) {
	if (!existsSync(target)) fail(`${label} not found: ${target}`);
}

async function copyEntry(source, target) {
	const sourceStat = await stat(source);
	await cp(source, target, { recursive: true, force: true });
	if (sourceStat.isDirectory()) {
		console.error(`  dir  ${path.relative(repoRoot, target)}`);
	} else {
		console.error(`  file ${path.relative(repoRoot, target)}`);
	}
}

function resolveNpmPackageRoot() {
	const candidates = [];
	const npmExecPath = String(process.env.npm_execpath ?? "").trim();
	if (npmExecPath) {
		candidates.push(path.dirname(path.dirname(path.resolve(npmExecPath))));
	}
	const nodeDir = path.dirname(process.execPath);
	candidates.push(path.join(nodeDir, "node_modules", "npm"));
	candidates.push(path.join(nodeDir, "..", "lib", "node_modules", "npm"));
	for (const candidate of candidates) {
		const manifestPath = path.join(candidate, "package.json");
		if (existsSync(manifestPath) && existsSync(path.join(candidate, "bin", "npm-cli.js"))) {
			const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
			if (version !== BUNDLED_NPM_VERSION) {
				fail(`bundled npm must be ${BUNDLED_NPM_VERSION}, found ${version} at ${candidate}`);
			}
			return candidate;
		}
	}
	fail(`npm CLI package not found; build with npm ${BUNDLED_NPM_VERSION} so npm_execpath is available. Tried: ${candidates.join(", ")}`);
}

async function main() {
	const sourceScriptsDir = path.join(repoRoot, "scripts");
	const sourcePispiderPkg = path.join(repoRoot, "packages", "pispider");
	const coreCacheSource = path.join(resolveHome(), "runtime", `core-${CORE_VERSION}`);
	const npmSource = resolveNpmPackageRoot();
	const coreCliSource = path.join(
		coreCacheSource,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"bundle",
		"cli.js",
	);

	for (const name of launcherScriptNames) {
		requireExisting(path.join(sourceScriptsDir, name), "launcher script");
	}
	requireExisting(path.join(sourcePispiderPkg, "package.json"), "pispider package manifest");
	for (const part of ["src", "resources", "vendor"]) {
		requireExisting(path.join(sourcePispiderPkg, part), `pispider package ${part}`);
	}
	if (!existsSync(coreCacheSource)) {
		fail(
			`core runtime cache not found: ${coreCacheSource}\n` +
				`  Run \`npm run pispider:setup\` to install core ${CORE_VERSION} before packaging.`,
		);
	}
	requireExisting(coreCliSource, "core CLI bundle");

	// Idempotent staging: wipe the whole packaged root, then recreate both facets.
	await rm(stagingRoot, { recursive: true, force: true });
	await mkdir(path.join(launcherStage, "scripts"), { recursive: true });
	await mkdir(path.join(launcherStage, "packages", "pispider"), { recursive: true });
	await mkdir(path.join(runtimeStage, `core-${CORE_VERSION}`), { recursive: true });

	console.error("Staging launcher closure:");
	for (const name of launcherScriptNames) {
		await copyEntry(
			path.join(sourceScriptsDir, name),
			path.join(launcherStage, "scripts", name),
		);
	}
	for (const part of pispiderPackageParts) {
		await copyEntry(
			path.join(sourcePispiderPkg, part),
			path.join(launcherStage, "packages", "pispider", part),
		);
	}

	console.error("Staging core runtime cache:");
	await copyEntry(coreCacheSource, path.join(runtimeStage, `core-${CORE_VERSION}`));

	console.error(`Staging bundled npm CLI (${npmSource}):`);
	await copyEntry(npmSource, npmStage);

	await selfTest();
}

async function selfTest() {
	const stagedScriptsDir = path.join(launcherStage, "scripts");
	const stagedPkgRoot = path.join(launcherStage, "packages", "pispider");
	const stagedCoreRoot = path.join(runtimeStage, `core-${CORE_VERSION}`);

	const checks = [
		[path.join(stagedScriptsDir, "run-pispider.mjs"), "staged runner script"],
		[path.join(stagedScriptsDir, "pispider-launcher.mjs"), "staged launcher script"],
		[path.join(stagedPkgRoot, "package.json"), "staged pispider manifest"],
		[path.join(stagedPkgRoot, "src", "index.js"), "staged pispider extension entry"],
		[path.join(stagedPkgRoot, "src", "home.js"), "staged pispider home module"],
		[path.join(stagedPkgRoot, "resources", "prompts", "core.md"), "staged prompt resource"],
		[
			path.join(stagedPkgRoot, "vendor", "pi-computer-use", "extensions", "computer-use.ts"),
			"vendored computer-use extension",
		],
		[
			path.join(stagedCoreRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"),
			"staged core CLI bundle",
		],
		[path.join(npmStage, "bin", "npm-cli.js"), "staged npm CLI"],
		[path.join(npmStage, "package.json"), "staged npm package manifest"],
		[path.join(npmStage, "LICENSE"), "staged npm license"],
	];

	for (const [target, label] of checks) {
		requireExisting(target, label);
	}

	// Launcher closure: relative imports must resolve inside the staged tree.
	const closureRelativeImports = [
		["run-pispider.mjs", "../packages/pispider/src/home.js"],
		["run-pispider.mjs", "./pispider-launcher.mjs"],
		["pispider-launcher.mjs", "../packages/pispider/src/home.js"],
	];
	for (const [scriptName, specifier] of closureRelativeImports) {
		const resolved = path.resolve(path.join(stagedScriptsDir, scriptName), "..", specifier);
		requireExisting(resolved, `closure import of ${scriptName} -> ${specifier}`);
	}

	// test/ must not travel with the packaged pispider package.
	const stagedTestDir = path.join(stagedPkgRoot, "test");
	if (existsSync(stagedTestDir)) {
		fail(`staged pispider package must exclude test/: ${stagedTestDir}`);
	}

	console.error("Self-test passed: launcher closure, runtime cache and npm CLI are complete.");
	console.error(`  staging root: ${stagingRoot}`);
}

main().catch((error) => {
	fail(error instanceof Error ? error.message : String(error));
});
