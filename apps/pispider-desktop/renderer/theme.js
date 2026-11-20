/**
 * Apply validated custom theme variables to the shared renderer root.
 *
 * The main process decides which color variables are allowed; this helper only
 * writes those values inline so both windows can switch palettes immediately.
 */

(() => {
  const VARIABLES = [
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
  ];

  function apply(theme, mode) {
    const root = document.documentElement;
    for (const variable of VARIABLES) root.style.removeProperty(variable);
    const colors = theme?.colors?.[mode];
    if (!colors || typeof colors !== "object") return;
    for (const variable of VARIABLES) {
      const value = colors[variable];
      if (typeof value === "string" && value) root.style.setProperty(variable, value);
    }
  }

  window.PiSpiderTheme = { apply };
})();
