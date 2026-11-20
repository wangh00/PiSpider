/**
 * Validate and normalize PiSpider custom theme files.
 *
 * Themes only override design tokens from tokens.css. Keeping the allowlist
 * here prevents imported JSON from injecting arbitrary CSS declarations.
 */

const THEME_VARIABLES = new Set([
  "--bg",
  "--chat-bg",
  "--panel",
  "--sidebar",
  "--panel-soft",
  "--text",
  "--text-soft",
  "--muted",
  "--muted-2",
  "--border",
  "--border-soft",
  "--hairline",
  "--accent",
  "--accent-strong",
  "--accent-soft",
  "--accent-contrast",
  "--danger",
  "--danger-soft",
  "--success",
  "--warning",
  "--code-bg",
  "--scrim",
]);

const COLOR_PATTERN =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\(\s*[-+0-9.%/, ]+\s*\)|transparent)$/iu;

function normalizeVariableName(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("--")) return THEME_VARIABLES.has(raw) ? raw : "";
  const kebab = raw.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const variable = `--${kebab}`;
  return THEME_VARIABLES.has(variable) ? variable : "";
}

function normalizeColor(value) {
  const text = String(value ?? "").trim();
  return COLOR_PATTERN.test(text) ? text : "";
}

function normalizeMode(colors, mode) {
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) {
    throw new Error(`${mode} 颜色必须是对象`);
  }
  const normalized = {};
  for (const [key, value] of Object.entries(colors)) {
    const variable = normalizeVariableName(key);
    if (!variable) throw new Error(`不支持的主题变量：${key}`);
    const color = normalizeColor(value);
    if (!color) throw new Error(`${variable} 不是有效颜色：${value}`);
    normalized[variable] = color;
  }
  if (!Object.keys(normalized).length) throw new Error(`${mode} 至少需要一个颜色变量`);
  return normalized;
}

function normalizeCustomTheme(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("主题文件必须是 JSON 对象");
  }
  const name = String(raw.name ?? "").trim().slice(0, 60) || "自定义主题";
  const source = raw.colors;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error('主题文件缺少 "colors"');
  }

  const colors = {};
  for (const mode of ["light", "dark"]) {
    if (source[mode] === undefined) continue;
    colors[mode] = normalizeMode(source[mode], mode === "light" ? "亮色" : "暗色");
  }
  if (!Object.keys(colors).length) {
    throw new Error('主题文件需要在 "colors.light" 或 "colors.dark" 中提供颜色');
  }

  const requestedMode = raw.mode === "light" || raw.mode === "dark" ? raw.mode : "";
  const onlyMode = Object.keys(colors).length === 1 ? Object.keys(colors)[0] : "";
  return {
    name,
    colors,
    defaultMode: requestedMode && colors[requestedMode] ? requestedMode : onlyMode,
  };
}

function themeVariablesForMode(theme, mode) {
  if (!theme || typeof theme !== "object" || !theme.colors) return {};
  return theme.colors[mode] ?? {};
}

module.exports = { normalizeCustomTheme, themeVariablesForMode, THEME_VARIABLES };
