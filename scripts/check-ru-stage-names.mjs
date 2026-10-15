// Finds Russian text that translates the name of a stage or a gate. The owner's rule: in Russian the names of the
// stages (plan, design, build, test, deploy, maintain) and of the gates (intent, spec, plan, verify, qa, review,
// release) stay in English, as identifiers: "гейт intent", "стадия build", "explore → intent → spec → plan".
// usage: node scripts/check-ru-stage-names.mjs <file-or-dir>...   ->  exit 1 when a translated name is found
// A JSON file is read as a locale catalog (its string values); a .md file as text; folders are walked for both.
import * as fs from 'node:fs';
import * as path from 'node:path';

const NAMES = [
  'замысел', 'замысл', 'намерени', 'спецификаци', 'план', 'проверк', 'ревью', 'релиз', 'выпуск', 'сборк',
  'проектировани', 'сопровождени', 'тестировани', 'развёртывани', 'развертывани', 'контрол[ья] качества',
].join('|');
const ROLE = '(?:гейт|гейта|гейту|гейтом|гейте|гейты|гейтов|гейтам|гейтами|ворот|ворота|этап|этапа|этапе|этапом|этапы|'
  + 'этапов|стади[яиюейё]|стадий)';
const PATTERNS = [
  // "гейт замысла", "стадия «Сборка»", "этап проверки"
  new RegExp(`${ROLE}[:\\s]+[«"]?(?:${NAMES})`, 'iu'),
  // "гейт-ревью", "ревью-гейт"
  new RegExp(`(?:${NAMES})[а-яё]*-гейт|гейт-(?:${NAMES})`, 'iu'),
  // a chain of stages or gates written in Russian: "замысел → спецификация → план"
  new RegExp(`(?:${NAMES})[а-яё]*\\s*(?:→|->)\\s*[«"]?(?:${NAMES})`, 'iu'),
  // stage titles of the CLI: "План (замысел)", "Сборка (план + реализация)"
  new RegExp(`(?:План|Проектирование|Сборка|Проверка|Релиз|Сопровождение)\\s*\\((?:${NAMES})`, 'u'),
];

function files(target) {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : files(full);
    return /\.(md|json)$/.test(entry.name) ? [full] : [];
  });
}

function lines(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!file.endsWith('.json')) return text.split(/\r?\n/).map((line, i) => ({ where: `${file}:${i + 1}`, line }));
  const catalog = JSON.parse(text);
  return Object.entries(catalog).filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => ({ where: `${file}#${key}`, line: value }));
}

let found = 0;
for (const target of process.argv.slice(2)) {
  for (const file of files(target)) {
    for (const { where, line } of lines(file)) {
      const hit = PATTERNS.map((pattern) => pattern.exec(line)).find(Boolean);
      if (!hit) continue;
      found += 1;
      if (found <= 400) console.log(`${where}: …${hit[0]}… | ${line.trim().slice(0, 140)}`);
    }
  }
}
console.log(`${found} translated stage or gate name(s)`);
process.exit(found > 0 ? 1 : 0);
