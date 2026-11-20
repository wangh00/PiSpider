/**
 * Render the settings "外观主题" card.
 *
 * This module is shared by the panel renderer and the UI component tests. It
 * only builds markup; applying the selected palette stays in theme.js.
 */

(() => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function themeSettingsCardHtml(theme) {
    const hasTheme = Boolean(theme && typeof theme === "object");
    const modes = hasTheme
      ? ["light", "dark"].filter((mode) => theme.colors && theme.colors[mode])
      : [];
    const modeLabel = (mode) => (mode === "light" ? "亮色" : "暗色");
    const swatch = (mode) => {
      const colors = theme?.colors?.[mode] || {};
      const background = escapeHtml(colors["--bg"] || "var(--bg)");
      const text = escapeHtml(colors["--text"] || "var(--text)");
      const accent = escapeHtml(colors["--accent"] || "var(--accent)");
      return `<div class="theme-swatch" style="background:${background};color:${text}">
      <span>Aa</span>
      <i style="background:${accent}"></i>
      <small>${modeLabel(mode)}</small>
    </div>`;
    };
    return `
    <section class="settings-card theme-card">
      <div class="settings-section-head">外观主题</div>
      <div class="theme-summary">
        <span class="theme-name">${hasTheme ? escapeHtml(theme.name) : "内置黑白主题"}</span>
        <span class="theme-modes">${
          hasTheme && modes.length ? modes.map(modeLabel).join(" · ") : "亮色 / 暗色"
        }</span>
      </div>
      ${
        hasTheme && modes.length
          ? `<div class="theme-swatches">${modes.map(swatch).join("")}</div>`
          : ""
      }
      <div class="model-hint">导入 JSON 主题文件，支持 light / dark 两套颜色变量；导入后立即生效，并写入 desktop.json。</div>
      <div class="model-actions">
        <button class="panel-action" id="importThemeButton" type="button">导入主题文件</button>
        ${
          hasTheme
            ? '<button class="text-button" id="resetThemeButton" type="button">恢复内置主题</button>'
            : ""
        }
      </div>
    </section>
  `;
  }

  const api = { html: themeSettingsCardHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.PiSpiderThemeCard = api;
})();
