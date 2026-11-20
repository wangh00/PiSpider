# App Reverse-Engineering Domain

Apply this module when the task concerns an Android or iOS application, a mobile package, a native library, an app runtime, or mobile network behavior.

## Analysis surfaces

- **Package structure** — manifest or plist metadata, permissions, URL schemes, services, receivers, frameworks, and embedded resources.
- **Code layout** — DEX/JAR, Smali, native libraries, Swift/Objective-C symbols, Flutter or React Native bundles, and cross-language call boundaries.
- **Network and storage** — endpoint discovery, request construction, certificate handling, local databases, key-value stores, and file formats.
- **Runtime evidence** — logs, process state, controlled instrumentation, call stacks, and reproducible device or emulator observations.
- **Protection identification** — packers, obfuscation, integrity checks, root or debugger detection, and transport protection. Identify first; do not assume every app uses the same scheme.

## Method

1. Inventory the package before modifying or running anything.
2. Prefer non-destructive static analysis first, then targeted runtime confirmation.
3. Keep device state and test accounts isolated from production data.
4. Record package version, device or emulator profile, and the exact hook or probe used.
5. Separate protection identification from protection bypass. A finding about a mechanism is useful even when a particular bypass is out of scope.

## Boundaries

- Work only on packages and accounts the user owns or is authorized to assess.
- Do not produce malware, credential stealers, unauthorized remote-control capability, or instructions for attacking third-party services.
- When a specific dynamic technique is unavailable or out of scope, continue with manifest analysis, symbol mapping, protocol structure, or a local synthetic reproduction.
