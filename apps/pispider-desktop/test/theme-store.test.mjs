import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeCustomTheme, themeVariablesForMode } = require("../theme-store.cjs");

test("normalizes camelCase keys and both light and dark palettes", () => {
  const theme = normalizeCustomTheme({
    name: "  Paper  ",
    colors: {
      light: { bg: "#f7f7f2", chatBg: "#ffffff", text: "#1a1a1a", accent: "rgb(20, 20, 20)" },
      dark: { "--bg": "#101010", "--text": "#f0f0f0" },
    },
  });
  assert.equal(theme.name, "Paper");
  assert.deepEqual(theme.colors.light, {
    "--bg": "#f7f7f2",
    "--chat-bg": "#ffffff",
    "--text": "#1a1a1a",
    "--accent": "rgb(20, 20, 20)",
  });
  assert.deepEqual(theme.colors.dark, { "--bg": "#101010", "--text": "#f0f0f0" });
  assert.equal(theme.defaultMode, "");
});

test("uses the only palette as the default mode", () => {
  const theme = normalizeCustomTheme({ colors: { dark: { bg: "#111111", text: "#eeeeee" } } });
  assert.equal(theme.name, "自定义主题");
  assert.equal(theme.defaultMode, "dark");
});

test("honors an explicit mode only when that palette exists", () => {
  const both = normalizeCustomTheme({
    mode: "dark",
    colors: {
      light: { bg: "#ffffff", text: "#111111" },
      dark: { bg: "#111111", text: "#eeeeee" },
    },
  });
  assert.equal(both.defaultMode, "dark");

  const missing = normalizeCustomTheme({
    mode: "dark",
    colors: { light: { bg: "#ffffff", text: "#111111" } },
  });
  assert.equal(missing.defaultMode, "light");
});

test("rejects unknown variables and unsafe color values", () => {
  assert.throws(
    () => normalizeCustomTheme({ colors: { light: { bg: "url(https://example.com/x.png)" } } }),
    /不是有效颜色/,
  );
  assert.throws(() => normalizeCustomTheme({ colors: { light: { "--font-ui": "#fff" } } }), /不支持的主题变量/);
  assert.throws(() => normalizeCustomTheme({ colors: { light: { bg: "#fff; color: red" } } }), /不是有效颜色/);
});

test("rejects malformed theme documents", () => {
  assert.throws(() => normalizeCustomTheme(null), /JSON 对象/);
  assert.throws(() => normalizeCustomTheme({ name: "x" }), /缺少/);
  assert.throws(() => normalizeCustomTheme({ colors: {} }), /需要在/);
  assert.throws(() => normalizeCustomTheme({ colors: { light: {} } }), /至少需要一个/);
});

test("themeVariablesForMode returns only the selected palette", () => {
  const theme = normalizeCustomTheme({
    colors: {
      light: { bg: "#ffffff", text: "#111111" },
      dark: { bg: "#111111", text: "#eeeeee" },
    },
  });
  assert.deepEqual(themeVariablesForMode(theme, "light"), { "--bg": "#ffffff", "--text": "#111111" });
  assert.deepEqual(themeVariablesForMode(theme, "dark"), { "--bg": "#111111", "--text": "#eeeeee" });
  assert.deepEqual(themeVariablesForMode(theme, "sepia"), {});
});
