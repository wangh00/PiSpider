# Vendored pi-computer-use

- Upstream: https://github.com/injacency/pi-computer-use
- npm package: `@injacency/pi-computer-use@0.5.1`
- License: MIT, copyright (c) 2026 Zane Chee; full text in `LICENSE`
- Source used: npm tarball, because the GitHub source tree does not include
  `prebuilt/windows/windows-bridge.exe` and the current Windows host has no Rust/Cargo.

## Included

- `extensions/computer-use.ts` and `src/` extension runtime
- `scripts/setup-helper.mjs` and helper setup dependencies
- `prebuilt/windows`, `prebuilt/linux`, `prebuilt/macos`
- `native/` source files for future rebuilds

## Local changes

1. `package.json` is reduced to runtime metadata. The upstream `postinstall` script and
   publish/test scripts are removed so the vendored package can never write `~/.pi` by
   accident.
2. `src/platform/windows/helper.ts`, `src/platform/linux/helper.ts`, and
   `scripts/setup-helper.mjs` fall back to `PI_CODING_AGENT_DIR` before `~/.pi/agent`.
   PiSpider also sets explicit helper paths, so the normal launch path is independent of
   the upstream default.
3. No extension logic or tool definitions are changed.

## Loading

The PiSpider launcher adds this extension only when `PISPIDER_COMPUTER_USE` is truthy:

```text
pi -e packages/pispider -e packages/pispider/vendor/pi-computer-use/extensions/computer-use.ts
```

Do not add this path to `packages/pispider/package.json` `pi.extensions`; doing so would
load the 11 computer-use tools in every session.
