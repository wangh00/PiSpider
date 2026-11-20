/**
 * Generate the settings theme-card screenshot baseline.
 *
 * Run with Electron from the desktop app directory:
 *   npm run ui:baseline
 *
 * The gallery uses the real tokens.css / panel.css / theme-card.js. It does not
 * touch the running desktop app or user configuration.
 */

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const outputDir = path.join(repoRoot, "docs", "ui-baseline");
const galleryPath = path.join(appRoot, "test", "ui-gallery.html");

const CUSTOM_THEME = {
  name: "测试灰绿",
  colors: {
    light: {
      "--bg": "#eef3ef",
      "--chat-bg": "#f8fbf9",
      "--panel": "#f3f7f4",
      "--text": "#17251b",
      "--text-soft": "#4d6b58",
      "--accent": "#245c3e",
      "--accent-contrast": "#ffffff",
    },
    dark: {
      "--bg": "#101713",
      "--chat-bg": "#121a15",
      "--panel": "#16211b",
      "--text": "#e4eee7",
      "--text-soft": "#accbb8",
      "--accent": "#b8d8c2",
      "--accent-contrast": "#101713",
    },
  },
};

const SCENARIOS = [
  { name: "theme-card-builtin-light", mode: "light", theme: null, width: 1060, height: 760 },
  { name: "theme-card-builtin-dark", mode: "dark", theme: null, width: 1060, height: 760 },
  { name: "theme-card-custom-light", mode: "light", theme: CUSTOM_THEME, width: 1060, height: 760 },
  { name: "theme-card-custom-dark", mode: "dark", theme: CUSTOM_THEME, width: 1060, height: 760 },
  { name: "theme-card-custom-narrow", mode: "dark", theme: CUSTOM_THEME, width: 360, height: 760 },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderScenario(win, scenario) {
  win.setContentSize(scenario.width, scenario.height);
  await delay(120);

  const metrics = await win.webContents.executeJavaScript(`
    (() => {
      const theme = ${JSON.stringify(scenario.theme)};
      const mode = ${JSON.stringify(scenario.mode)};
      document.documentElement.dataset.theme = mode;
      window.PiSpiderTheme.apply(theme, mode);
      const card = window.PiSpiderThemeCard.html(theme);
      document.getElementById("gallery").innerHTML =
        '<div class="settings-page panel-page">' + card + '</div>';
      const cardElement = document.querySelector(".theme-card");
      const rect = cardElement.getBoundingClientRect();
      return {
        swatches: cardElement.querySelectorAll(".theme-swatch").length,
        name: cardElement.querySelector(".theme-name")?.textContent || "",
        cardLeft: rect.left,
        cardTop: rect.top,
        cardWidth: rect.width,
        cardHeight: rect.height,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()
  `);

  if (metrics.scrollWidth > metrics.clientWidth + 1) {
    throw new Error(`${scenario.name} 出现横向溢出：${metrics.scrollWidth} > ${metrics.clientWidth}`);
  }
  if (metrics.cardWidth <= 0 || metrics.cardHeight <= 0) {
    throw new Error(`${scenario.name} 主题卡尺寸无效：${metrics.cardWidth}x${metrics.cardHeight}`);
  }

  // capturePage reads the last painted frame; wait for two animation frames so
  // the scenario's DOM/theme change is visible instead of the previous card.
  await win.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  await delay(80);

  const captureRect = {
    x: Math.max(0, Math.floor(metrics.cardLeft) - 4),
    y: Math.max(0, Math.floor(metrics.cardTop) - 4),
    width: Math.ceil(metrics.cardWidth) + 8,
    height: Math.ceil(metrics.cardHeight) + 8,
  };
  const image = await win.webContents.capturePage(captureRect);
  const png = image.toPNG();
  if (!png.length) throw new Error(`${scenario.name} 截图为空`);
  await fs.writeFile(path.join(outputDir, `${scenario.name}.png`), png);

  return {
    name: scenario.name,
    mode: scenario.mode,
    theme: scenario.theme ? scenario.theme.name : "builtin",
    width: scenario.width,
    height: scenario.height,
    swatches: metrics.swatches,
    nameText: metrics.name,
    cardWidth: metrics.cardWidth,
    cardHeight: metrics.cardHeight,
    file: `${scenario.name}.png`,
  };
}

app.whenReady().then(async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const win = new BrowserWindow({
    show: true,
    width: 1060,
    height: 760,
    backgroundColor: "#121212",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await win.loadFile(galleryPath);
    await win.webContents.executeJavaScript("document.fonts.ready");
    const results = [];
    for (const scenario of SCENARIOS) {
      results.push(await renderScenario(win, scenario));
    }
    const report = { generator: "apps/pispider-desktop/test/ui-baseline.cjs", scenarios: results };
    await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    app.quit();
  } catch (error) {
    console.error(error.stack || error.message);
    app.exit(1);
  }
});
