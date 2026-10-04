#!/usr/bin/env node
/**
 * Turns a checkout with a built dist/ into the tree of the `release` branch, which installs from git:
 *
 *   npm install -g github:marin-ai-tech/sdlc#release
 *
 * npm 11 breaks installing a git package that needs `prepare` (it leaks `-g` into the dependency install of
 * the clone, which then installs the clone globally on top of the real install). The release branch therefore
 * carries the built dist/ and no `prepare`, so npm has nothing to build. master keeps building from source.
 *
 * Usage (CI, after `npm ci`, which builds dist/): node scripts/release-branch.mjs --in-place
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** package.json of the release branch: the same package without `prepare`. */
export function releasePackageJson(pkg) {
  const scripts = { ...pkg.scripts };
  delete scripts.prepare;
  return { ...pkg, scripts };
}

/** .gitignore of the release branch: dist/ is part of the tree. */
export function releaseGitignore(text) {
  return text.split('\n').filter((line) => line.trim() !== 'dist/' && line.trim() !== '/dist/').join('\n');
}

function main(argv) {
  if (!argv.includes('--in-place')) {
    process.stderr.write('usage: node scripts/release-branch.mjs --in-place  (rewrites package.json and .gitignore here)\n');
    return 2;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (!fs.existsSync(path.join(root, 'dist', 'cli', 'index.js'))) {
    process.stderr.write('dist/ is not built: run npm ci (or npm run compile) first\n');
    return 1;
  }
  const pkgFile = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
  fs.writeFileSync(pkgFile, `${JSON.stringify(releasePackageJson(pkg), null, 2)}\n`);
  const ignoreFile = path.join(root, '.gitignore');
  fs.writeFileSync(ignoreFile, releaseGitignore(fs.readFileSync(ignoreFile, 'utf-8')));
  process.stdout.write(`release tree ready: ${pkg.name}@${pkg.version} with dist/, without prepare\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
