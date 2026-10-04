# Contributing

Thank you for helping improve sdlc.

1. **License agreement first.** sdlc is dual-licensed (see [LICENSE](LICENSE)).
   Every contribution must be covered by the
   [Contributor License Agreement](CLA.md). Accept it in your pull request
   description; pull requests without it cannot be merged.
2. **Development.**
   ```bash
   npm install
   npm test            # compiles, then runs unit and end-to-end tests
   ```
   `dist/` is build output and is not committed. Releases are built by CI on a
   version tag (`.github/workflows/release.yml`): the archive is attached to the
   GitHub release and the `release` branch gets the built code for installs from
   git. After changing workflow, agent or hook templates,
   regenerate the Claude Code plugin with
   `node bin/sdlc.js plugin build plugin --marketplace`.
3. **Notices.** Keep the `Required Notice:` lines in the license files and in
   generated files.


## Adding a language (i18n)

1. Copy `assets/locales/en.json` to `assets/locales/<code>.json` (for example `de.json`).
2. Translate the values. Keep the keys, `{params}` placeholders, command names, flags and ids as they are.
3. Add the language code to `LOCALES` in `src/core/i18n.ts`.
4. Run `npm test` — the catalog tests check that every locale has every English key and matching placeholders.
