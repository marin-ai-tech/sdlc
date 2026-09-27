# Notices

Required Notice: Copyright (c) 2026 marin-ai technologies (https://github.com/marin-ai-tech/scdl)

scdl is dual-licensed; see [LICENSE](LICENSE).

## OpenSpec (MIT License)

scdl uses OpenSpec (https://github.com/Fission-AI/OpenSpec) unmodified as a
runtime dependency (`@fission-ai/openspec`), and adapts some OpenSpec material:

- `src/core/tasks.ts` reuses OpenSpec's task-checkbox pattern so progress
  counts match OpenSpec exactly;
- the `proposal`, `specs`, `design` and `tasks` instructions and templates in
  `schemas/sdlc/` are adapted from OpenSpec's built-in `spec-driven` schema.

Those portions remain available under the MIT License, reproduced in full in
[LICENSES/MIT-OpenSpec.txt](LICENSES/MIT-OpenSpec.txt):

    Copyright (c) 2024 OpenSpec Contributors

## Runtime dependencies

Installed by npm, not bundled in this repository:

| Package | License |
|---|---|
| @fission-ai/openspec | MIT |
| commander | MIT |
| picomatch | MIT |
| yaml | ISC |

## Methodology

The lifecycle model follows Anthropic's "The AI-Native SDLC playbook"
(https://claude.com/blog/the-ai-native-sdlc-playbook, August 2026).
