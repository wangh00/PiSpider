import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { html: themeCardHtml } = require("../renderer/theme-card.js");

test("renders the built-in theme without swatches or a reset action", () => {
  const html = themeCardHtml(null);
  assert.match(html, /内置黑白主题/);
  assert.match(html, /亮色 \/ 暗色/);
  assert.match(html, /id="importThemeButton"/);
  assert.doesNotMatch(html, /theme-swatch"/);
  assert.doesNotMatch(html, /resetThemeButton/);
});

test("renders both palettes and their colors for a custom theme", () => {
  const html = themeCardHtml({
    name: "测试灰绿",
    colors: {
      light: { "--bg": "#eef3ef", "--text": "#17251b", "--accent": "#245c3e" },
      dark: { "--bg": "#101713", "--text": "#e4eee7", "--accent": "#b8d8c2" },
    },
  });
  assert.match(html, /测试灰绿/);
  assert.match(html, /亮色 · 暗色/);
  assert.equal((html.match(/class="theme-swatch"/g) || []).length, 2);
  assert.match(html, /background:#eef3ef;color:#17251b/);
  assert.match(html, /background:#101713;color:#e4eee7/);
  assert.match(html, /id="resetThemeButton"/);
});

test("renders a single presented palette only", () => {
  const html = themeCardHtml({
    name: "仅暗色",
    colors: { dark: { "--bg": "#101713" } },
  });
  assert.match(html, /仅暗色/);
  assert.match(html, /暗色/);
  assert.equal((html.match(/class="theme-swatch"/g) || []).length, 1);
  assert.match(html, /background:#101713;color:var\(--text\)/);
});

test("escapes theme names and never emits raw markup", () => {
  const html = themeCardHtml({
    name: '<img src=x onerror="alert(1)">',
    colors: { light: { "--bg": "transparent" } },
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});
