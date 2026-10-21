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


## Installing another language locally

1. Copy `assets/locales/en.json` to `assets/locales/xx.json` on your machine.
2. Translate the values. Keep the keys, `{params}` placeholders, command names, flags and ids as they are.
3. Keep the new catalog and any `assets/guide/xx/` or `assets/roles/xx/` files untracked.
   Installed catalogs are discovered at run time; no source change is needed.
4. Run `npm test` to check that installed catalogs have every English key and matching placeholders.
