# Contributing

Thank you for helping improve scdl.

1. **License agreement first.** scdl is dual-licensed (see [LICENSE](LICENSE)).
   Every contribution must be covered by the
   [Contributor License Agreement](CLA.md). Accept it in your pull request
   description; pull requests without it cannot be merged.
2. **Development.**
   ```bash
   npm install
   npm test            # compiles, then runs unit and end-to-end tests
   ```
   `dist/` is committed so that `npm install -g github:marin-ai-tech/scdl` works
   without a build step: commit the output of `npm run compile` together with
   your source change. After changing workflow, agent or hook templates,
   regenerate the Claude Code plugin with
   `node bin/sdlc.js plugin build plugin --marketplace`.
3. **Notices.** Keep the `Required Notice:` lines in the license files and in
   generated files.
