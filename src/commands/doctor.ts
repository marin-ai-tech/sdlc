import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { loadConfig } from '../core/config.js';
import { listActiveChanges } from '../core/changes.js';
import { isFile, readText } from '../core/fs-utils.js';
import { gitIdentity, isGitRepo } from '../core/git.js';
import { currentLocale, t, type Locale } from '../core/i18n.js';
import { evaluateChange } from '../core/lifecycle.js';
import { openspecVersion, resolveOpenSpec, runOpenSpec } from '../core/openspec.js';
import { findProjectRoot, projectPaths } from '../core/project.js';
import { readYamlObject } from '../core/yaml-io.js';
import { harnessStamp, INSTALL_COMMAND, REQUIRED_NOTICE } from '../core/license.js';
import { LOG_PATH, readLog } from '../core/log.js';
import { assessLicense, detectProjectLicense } from '../core/project-license.js';
import { detectDependencies } from '../core/dependencies.js';
import { harnessVersion } from '../core/version.js';
import { readRolesFile } from '../core/roles.js';
import { readManifest, sha256 } from '../integrations/manifest.js';
import { SETTINGS_PATH } from '../integrations/settings.js';
import { hooksDisabledFiles } from '../core/user-guard.js';

interface Check {
  check: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

function versionAtLeast(version: string, min: [number, number, number]): boolean {
  const parts = version.replace(/^v/, '').split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i += 1) {
    const a = parts[i] ?? 0;
    if (a > min[i]) return true;
    if (a < min[i]) return false;
  }
  return true;
}

function onPath(bin: string): boolean {
  const probe = process.platform === 'win32'
    ? spawnSync('where', [bin], { encoding: 'utf-8' })
    : spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf-8' });
  return probe.status === 0;
}

export async function doctorCommand(opts: { json?: boolean }): Promise<void> {
  try {
    // JSON payloads stay English in every locale; text uses the active locale.
    const loc: Locale = opts.json ? 'en' : currentLocale();
    const tt = (key: string, params?: Record<string, string | number>) => t(key, params, loc);
    const checks: Check[] = [];
    const add = (check: string, status: Check['status'], message: string, fix?: string) =>
      checks.push({ check, status, message, ...(fix ? { fix } : {}) });

    add(
      'node',
      versionAtLeast(process.versions.node, [20, 19, 0]) ? 'ok' : 'error',
      tt('doctor.node', { version: process.versions.node }),
      tt('doctor.fix.node'),
    );
    add('harness', 'ok', tt('doctor.harness', { version: harnessVersion() }));

    const root = findProjectRoot();
    const bin = resolveOpenSpec();
    const osVersion = openspecVersion(root ?? process.cwd());
    if (!osVersion) {
      add(
        'openspec',
        'error',
        tt('doctor.openspecMissing', { source: bin.source, command: bin.command }),
        tt('doctor.fix.openspec'),
      );
    } else {
      add(
        'openspec',
        versionAtLeast(osVersion, [1, 13, 2]) ? 'ok' : 'warn',
        tt('doctor.openspecVersion', { version: osVersion, source: bin.source }),
        tt('doctor.openspecOld'),
      );
    }

    const depRoot = root ?? process.cwd();
    const optional = detectDependencies(depRoot);
    const openspecCli = optional.find((d) => d.id === 'openspec')!;
    if (openspecCli.found) {
      add('openspec cli', 'ok', openspecCli.version ?? tt('doctor.installed'));
    } else {
      add(
        'openspec cli',
        'warn',
        tt('doctor.openspecCliOptional'),
        openspecCli.install.join(' '),
      );
    }
    const codegraph = optional.find((d) => d.id === 'codegraph')!;
    if (codegraph.found) {
      const indexed = codegraph.indexed
        ? tt('doctor.codegraphIndexed')
        : tt('doctor.codegraphNotIndexed');
      add(
        'codegraph',
        'ok',
        tt('doctor.codegraphOk', { version: codegraph.version ?? tt('doctor.installed'), indexed }),
      );
    } else {
      add('codegraph', 'warn', tt('doctor.notOnPath'), codegraph.install.join(' '));
    }

    if (!root) {
      add('project', 'error', tt('doctor.noProject'), tt('doctor.fix.init'));
    } else {
      const paths = projectPaths(root);
      add('project', 'ok', tt('doctor.root', { root }));
      const roles = readRolesFile(root);
      if (roles) add('approval signing', 'ok', tt('doctor.signingMode', { mode: roles.signing }));
      let config;
      try {
        config = loadConfig(paths.sdlcConfig);
        add(
          'sdlc.yaml',
          isFile(paths.sdlcConfig) ? 'ok' : 'error',
          isFile(paths.sdlcConfig)
            ? tt('doctor.enforcementTools', {
              mode: config.enforcement.mode,
              tools: config.tools.join(', ') || tt('init.none'),
            })
            : tt('doctor.sdlcMissing'),
          tt('doctor.fix.init'),
        );
      } catch (error) {
        add('sdlc.yaml', 'error', error instanceof Error ? error.message : String(error));
      }
      const osConfig = (() => {
        try { return readYamlObject(paths.openspecConfig); } catch { return undefined; }
      })();
      add(
        'openspec config',
        osConfig ? 'ok' : 'warn',
        osConfig
          ? tt('doctor.schemaDefault', { schema: String(osConfig.schema ?? 'spec-driven') })
          : tt('doctor.openspecConfigMissing'),
      );

      if (isFile(path.join(paths.schemasDir, 'sdlc', 'schema.yaml'))) {
        const r = runOpenSpec(['schema', 'validate', 'sdlc'], { cwd: root });
        add(
          'sdlc schema',
          r.ok ? 'ok' : 'error',
          r.ok
            ? tt('doctor.schemaValid')
            : (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' '),
        );
      } else {
        add('sdlc schema', 'error', tt('doctor.schemaMissing'), tt('doctor.fix.update'));
      }

      const manifest = readManifest(root);
      const entries = Object.entries(manifest.files);
      const missing = entries.filter(([rel]) => !isFile(path.join(root, rel))).map(([rel]) => rel);
      const edited = entries.filter(([rel, e]) => {
        const text = readText(path.join(root, rel));
        return text !== undefined && sha256(text) !== e.sha256;
      }).map(([rel]) => rel);
      const outdated = manifest.harness !== harnessVersion() ||
        (config !== undefined && manifest.license !== undefined &&
          manifest.license !== harnessStamp(config).license);
      const licensePart = manifest.license
        ? tt('doctor.licensePart', { license: manifest.license })
        : '';
      const by = outdated
        ? tt('doctor.generatedBy', { harness: manifest.harness, license: licensePart })
        : '';
      add(
        'generated files',
        missing.length > 0
          ? 'error'
          : edited.length > 0 || (outdated && entries.length > 0)
            ? 'warn'
            : entries.length > 0 ? 'ok' : 'warn',
        tt('doctor.generatedSummary', {
          tracked: entries.length,
          missing: missing.length,
          edited: edited.length,
        }) + by,
        missing.length > 0 || outdated
          ? tt('doctor.fix.update')
          : edited.length > 0 ? tt('doctor.fix.edited') : undefined,
      );

      if (config) {
        const license = assessLicense(config.license, detectProjectLicense(root), loc);
        add('license', license.status, license.message, license.fix);
        add(
          'project log',
          'ok',
          config.log.enabled
            ? tt('doctor.logEntries', { count: readLog(root).length, path: LOG_PATH })
            : tt('doctor.logOff'),
        );
        if (config.tools.includes('claude')) {
          const settings = readText(path.join(root, SETTINGS_PATH)) ?? '';
          const hasHooks = /hook pre-tool/.test(settings);
          add(
            'claude hooks',
            hasHooks ? 'ok' : 'warn',
            hasHooks
              ? tt('doctor.hooksInstalled', { path: SETTINGS_PATH })
              : tt('doctor.hooksMissing', { path: SETTINGS_PATH }),
            tt('doctor.fix.update'),
          );
        }
        if (config.tools.includes('opencode')) {
          add(
            'opencode plugin',
            isFile(path.join(root, '.opencode', 'plugins', 'sdlc.js')) ? 'ok' : 'warn',
            '.opencode/plugins/sdlc.js',
            tt('doctor.fix.update'),
          );
        }
        const cliBin = config.cli.split(/\s+/)[0];
        const on = onPath(cliBin);
        add(
          'cli on PATH',
          on ? 'ok' : 'warn',
          tt(on ? 'doctor.cliOnPath' : 'doctor.cliNotOnPath', { bin: cliBin, cli: config.cli }),
          tt('doctor.fix.cli', { install: INSTALL_COMMAND }),
        );
        add(
          'verify commands',
          config.verify.commands.length > 0 ? 'ok' : 'warn',
          config.verify.commands.length > 0
            ? tt('doctor.verifyNames', {
              names: config.verify.commands.map((v) => v.name).join(', '),
            })
            : tt('doctor.verifyNone'),
          tt('doctor.fix.verify'),
        );
        add(
          'review policy',
          isFile(path.join(root, config.review.policy)) ? 'ok' : 'warn',
          tt('doctor.reviewPolicyFile', { path: config.review.policy }),
          tt('doctor.fix.review'),
        );
        for (const ref of listActiveChanges(paths)) {
          try {
            const view = evaluateChange(root, ref, config, { skipFingerprint: true });
            add(`change ${ref.id}`, 'ok', tt('doctor.changeStage', { stage: view.stage }));
          } catch (error) {
            add(`change ${ref.id}`, 'error', error instanceof Error ? error.message : String(error));
          }
        }
      }
      if (!isGitRepo(root)) {
        add('git', 'warn', tt('doctor.gitNotRepo'), tt('doctor.fix.gitInit'));
      } else {
        const id = gitIdentity(root);
        add(
          'git',
          id.email ? 'ok' : 'warn',
          id.email
            ? tt('doctor.gitIdentity', { name: id.name ?? '', email: id.email })
            : tt('doctor.gitNoEmail'),
          tt('doctor.fix.gitEmail'),
        );
      }
    }

    // A disabled hook cannot say so itself (B42): the user's and the project's settings files.
    for (const file of hooksDisabledFiles(root, process.env)) {
      const fix = tt('doctor.fix.hooksDisabled', { path: file });
      add('hooks disabled', 'warn', tt('doctor.hooksDisabled', { path: file }), fix);
    }

    const errors = checks.filter((ch) => ch.status === 'error').length;
    if (opts.json) {
      printJson({ healthy: errors === 0, checks });
    } else {
      line(c.dim(REQUIRED_NOTICE));
      for (const ch of checks) {
        const icon = ch.status === 'ok' ? c.green('✓') : ch.status === 'warn' ? c.yellow('!') : c.red('✗');
        line(`${icon} ${ch.check.padEnd(16)} ${ch.message}`);
        if (ch.fix && ch.status !== 'ok') {
          line(`  ${''.padEnd(16)} ${c.dim(tt('doctor.fixLabel', { fix: ch.fix }))}`);
        }
      }
    }
    if (errors > 0) process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
