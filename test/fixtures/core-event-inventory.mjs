import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const cache = new Map();
function parse(file) {
  if (cache.has(file)) return cache.get(file);
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const bindings = new Map();
  const imported = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      for (const item of node.importClause?.namedBindings?.elements ?? []) {
        if (!from.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), from).replace(/\.js$/, '.ts');
        if (fs.existsSync(target)) imported.set(item.name.text, {file: target, name: item.propertyName?.text ?? item.name.text});
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const result = {source, bindings, imported};
  cache.set(file, result);
  return result;
}
function strings(node, context, seen = new Set()) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return node.head.text ? [node.head.text] : [];
  if (ts.isConditionalExpression(node)) return [...strings(node.whenTrue, context, seen), ...strings(node.whenFalse, context, seen)];
  if (ts.isIdentifier(node)) {
    const key = context.source.fileName + ':' + node.text;
    if (seen.has(key)) return [];
    seen.add(key);
    const local = context.bindings.get(node.text);
    if (local) return strings(local, context, seen);
    const imported = context.imported.get(node.text);
    if (imported) return strings(parse(imported.file).bindings.get(imported.name), parse(imported.file), seen);
  }
  return [];
}
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : file.endsWith('.ts') ? [file] : [];
  });
}
const roots = new Map();
const unresolved = [];
for (const file of files(path.join(repo, 'src'))) {
  if (file.includes(path.sep + 'plugins' + path.sep)) continue;
  const context = parse(file);
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
      let event;
      if (['appendLog', 'appendLocalLog', 'appendHookLog'].includes(name)) {
        const object = node.arguments[2];
        if (object && ts.isObjectLiteralExpression(object)) {
          const property = object.properties.find(item => item.name?.getText(context.source) === 'event');
          event = property?.initializer ?? (property && ts.isShorthandPropertyAssignment(property) ? property.name : undefined);
        }
      }
      if (name === 'recordChangeEvent') event = node.arguments[3];
      if (['logSetup', 'logLayout'].includes(name)) event = node.arguments[2];
      if (name === 'appendHistory') event = node.arguments[1];
      if (event) {
        const line = context.source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const source = path.relative(repo, file).replaceAll('\\', '/') + ':' + line;
        const values = strings(event, context);
        if (!values.length) unresolved.push({source, call: name, expression: event.getText(context.source)});
        for (const value of values) {
          const root = value.split('.')[0];
          if (!roots.has(root)) roots.set(root, []);
          roots.get(root).push({source, event: value, call: name});
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(context.source);
}
console.log(JSON.stringify({namespaces: [...roots].sort((a,b) => a[0].localeCompare(b[0])).map(([name, producers]) => ({name, producers})), unresolved}, null, 2));
