import { readJson, writeJsonAtomic } from "./util.js";
import { homeLayout } from "./home.js";

export const DOMAINS = ["auto", "js", "app"];

export function defaultConfig() {
  return {
    version: "0.1.0",
    domain: "auto",
    activeRule: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeConfig(value) {
  const base = defaultConfig();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const domain = DOMAINS.includes(value.domain) ? value.domain : "auto";
  const activeRule =
    typeof value.activeRule === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.activeRule)
      ? value.activeRule
      : null;
  return {
    ...base,
    ...value,
    version: "0.1.0",
    domain,
    activeRule,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : base.updatedAt,
  };
}

export async function loadConfig(home) {
  const layout = homeLayout(home);
  const existing = await readJson(layout.config, null);
  const config = normalizeConfig(existing);
  if (!existing) await writeJsonAtomic(layout.config, config);
  return config;
}

export async function saveConfig(home, config) {
  const next = normalizeConfig({ ...config, updatedAt: new Date().toISOString() });
  await writeJsonAtomic(homeLayout(home).config, next);
  return next;
}

export async function setDomain(home, domain) {
  if (!DOMAINS.includes(domain)) throw new Error(`domain must be one of: ${DOMAINS.join(", ")}`);
  return saveConfig(home, { ...(await loadConfig(home)), domain });
}

export async function setActiveRule(home, ruleId) {
  return saveConfig(home, { ...(await loadConfig(home)), activeRule: ruleId });
}

export function resolveDomain(setting, text = "") {
  if (DOMAINS.includes(setting) && setting !== "auto") return setting;
  const value = String(text ?? "").toLowerCase();
  const jsScore = countMatches(value, [
    /\bjavascript\b/g,
    /\bjs\b/g,
    /\bnode(?:\.?js)?\b/g,
    /\bwebpack\b/g,
    /\bvite\b/g,
    /\bpuppeteer\b/g,
    /\bplaywright\b/g,
    /\bdevtools\b/g,
    /sourcemap/g,
    /浏览器/g,
    /前端/g,
  ]);
  const appScore = countMatches(value, [
    /\bandroid\b/g,
    /\bios\b/g,
    /\bipa\b/g,
    /\bapk\b/g,
    /\bapp\b/g,
    /\bdex\b/g,
    /\bjadx\b/g,
    /\bfrida\b/g,
    /\bobjection\b/g,
    /\bflutter\b/g,
    /\breact native\b/g,
    /安卓/g,
    /应用逆向/g,
    /移动端/g,
  ]);
  if (appScore > jsScore && appScore > 0) return "app";
  if (jsScore > appScore && jsScore > 0) return "js";
  return "general";
}

function countMatches(text, patterns) {
  let score = 0;
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) score += Math.min(3, matches.length);
  }
  return score;
}
