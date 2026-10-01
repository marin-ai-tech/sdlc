/**
 * The story of the demo deck: which transcript steps each slide shows, and the words (en, ru).
 * The transcript comes from test/e2e-calculator.test.ts; build-deck.mjs renders this file.
 *
 * Slide layouts:
 *   title    — dark cover: title, subtitle, the three people
 *   people   — roles.yaml as people cards (from transcript.people + ROLES below)
 *   flow     — the lifecycle stepper; `highlight` = the stages this part of the story covers;
 *              `groups` = captions under runs of stages (from, to, label, text); `layer` = a note at the bottom
 *   steps    — 1–3 terminal cards (actor chip, command, output excerpt, note)
 *   refusals — a grid of refused commands (exit ≠ 0): who tried, what, why
 *   coverage — stat callouts (steps, commands, refusals, people) + every command used
 *   closing  — dark: the three rules, and the `reproduce` command lines
 * A steps slide may list `more`: steps of the same part shown as small pills, and `highlight` for a mini stepper.
 */

export const LANGS = ['en', 'ru'];

/** Who holds which role in the demo (mirrors openspec/roles.yaml in the scenario). */
export const ROLES = {
  alice: ['product-owner', 'release-manager', 'maintainer'],
  bob: ['engineer', 'tech-lead', 'code-owner'],
  carol: ['engineer', 'code-owner'],
  agent: [],
};

export const ACTOR_LABEL = {
  alice: { en: 'Alice · product owner', ru: 'Алиса · владелец продукта' },
  bob: { en: 'Bob · engineer', ru: 'Боб · инженер' },
  carol: { en: 'Carol · reviewer', ru: 'Кэрол · ревьюер' },
  agent: { en: 'AI agent', ru: 'ИИ-агент' },
};

export const STAGES = ['explore', 'backlog', 'intent', 'spec', 'plan', 'build', 'verify', 'review', 'release', 'archive'];

export const STAGE_LABEL = {
  explore: { en: 'Explore', ru: 'Исследование' },
  backlog: { en: 'Backlog', ru: 'Бэклог' },
  intent: { en: 'Intent', ru: 'Замысел' },
  spec: { en: 'Spec', ru: 'Спецификация' },
  plan: { en: 'Plan', ru: 'План' },
  build: { en: 'Build', ru: 'Сборка' },
  verify: { en: 'Verify', ru: 'Проверка' },
  review: { en: 'Review', ru: 'Ревью' },
  release: { en: 'Release', ru: 'Релиз' },
  archive: { en: 'Archive', ru: 'Архив' },
};

export const SLIDES = [
  {
    id: 'cover', layout: 'title',
    title: { en: 'Building a calculator with scdl', ru: 'Разработка калькулятора с scdl' },
    subtitle: {
      en: 'Every command of the SDLC harness, on one small real project. People decide, agents do the work.',
      ru: 'Все команды SDLC-харнесса на одном маленьком проекте. Решают люди, работу делают агенты.',
    },
    notes: {
      en: 'A three-person team builds a till calculator with AI agents. Everything shown was produced by an automated end-to-end test, so the outputs are real.',
      ru: 'Команда из трёх человек делает калькулятор для кассы вместе с ИИ-агентами. Всё на слайдах получено автоматическим сквозным тестом, вывод команд настоящий.',
    },
  },
  {
    id: 'team', layout: 'people',
    title: { en: 'The team and who may approve what', ru: 'Команда и кто что утверждает' },
    lead: {
      en: 'Roles live in openspec/roles.yaml, versioned in git. The file names people, their emails and signing keys, and the separation rules.',
      ru: 'Роли лежат в openspec/roles.yaml под git. В файле люди, их почта и ключи подписи, правила разделения обязанностей.',
    },
    steps: ['roles-check', 'roles-migrate'],
    notes: {
      en: 'Separation rules: the author of the code does not approve its review or release; spec and review, plan and review need different people; at most three gates per person. An agent cannot edit the file.',
      ru: 'Правила: автор кода не утверждает его ревью и релиз; спецификацию и ревью, план и ревью утверждают разные люди; не больше трёх гейтов на человека. Агент не может менять файл.',
    },
  },
  {
    id: 'map', layout: 'flow', highlight: STAGES,
    layer: {
      en: 'Spec layer: OpenSpec (changes, delta specs, validation, living specs). scdl adds the people, gates, evidence and guardrails around it.',
      ru: 'Слой спецификаций — OpenSpec (изменения, дельты, валидация, живые спецификации). scdl добавляет вокруг него людей, гейты, доказательства и защитные правила.',
    },
    groups: [
      {
        from: 'explore', to: 'backlog', label: { en: 'Idea', ru: 'Идея' },
        text: {
          en: 'Research the idea, then plan it as backlog items with an outcome and acceptance criteria.',
          ru: 'Исследовать идею и спланировать её задачами бэклога с результатом и критериями приёмки.',
        },
      },
      {
        from: 'intent', to: 'review', label: { en: 'Gates approved by people', ru: 'Гейты утверждают люди' },
        text: {
          en: 'Agents write intent, spec, plan, code, evidence and review; a person with the right role approves each.',
          ru: 'Агенты пишут замысел, спецификацию, план, код, доказательства и ревью; каждое утверждает человек с нужной ролью.',
        },
      },
      {
        from: 'release', to: 'archive', label: { en: 'Release', ru: 'Релиз' },
        text: {
          en: 'The release manager authorises; the delta merges into the living spec.',
          ru: 'Релиз-менеджер разрешает выпуск; дельта вливается в живую спецификацию.',
        },
      },
    ],
    title: { en: 'The path of a change', ru: 'Путь изменения' },
    lead: {
      en: 'An idea is explored, lands in the backlog, becomes a change and passes gates. Each gate is approved by a person, bound to the exact content.',
      ru: 'Идею исследуют, кладут в бэклог, превращают в изменение и проводят через гейты. Каждый гейт утверждает человек, и утверждение привязано к содержимому.',
    },
    notes: {
      en: 'If an approved artifact changes, the approval goes stale and must be given again.',
      ru: 'Если утверждённый артефакт меняется, утверждение устаревает, и его нужно дать заново.',
    },
  },
  {
    id: 'setup', layout: 'steps',
    title: { en: 'Setup: one command, two tools', ru: 'Установка: одна команда, два инструмента' },
    lead: {
      en: 'Alice installs scdl for Claude Code and OpenCode; an agent makes the repository AI-ready.',
      ru: 'Алиса ставит scdl для Claude Code и OpenCode; агент готовит репозиторий к работе с ИИ.',
    },
    steps: ['init', 'layout-check', 'layout-scaffold'],
    more: ['doctor', 'license', 'help', 'layout-adapt', 'layout-convert', 'update'],
  },
  {
    id: 'explore', layout: 'steps',
    title: { en: 'Explore before committing', ru: 'Сначала исследование' },
    lead: {
      en: 'Does the till need its own calculator? The agent researches and writes a recommendation; nothing is decided yet.',
      ru: 'Нужен ли кассе свой калькулятор? Агент исследует вопрос и пишет рекомендацию; решение пока не принято.',
    },
    steps: ['explore', 'explore-list'],
  },
  {
    id: 'backlog', layout: 'steps',
    title: { en: 'The backlog: agents propose, people prioritise', ru: 'Бэклог: агенты предлагают, люди расставляют приоритеты' },
    lead: {
      en: 'Items carry an outcome, acceptance criteria and dependencies. Moving and dropping items is a product decision.',
      ru: 'У задачи есть результат, критерии приёмки и зависимости. Порядок и удаление задач решает продукт.',
    },
    steps: ['add-b1', 'move-agent', 'list'],
    more: ['epic-add', 'add-b2', 'add-b3', 'move', 'add-b4', 'drop', 'backlog-next'],
  },
  {
    id: 'start', layout: 'steps',
    title: { en: 'From item to change', ru: 'Из задачи в изменение' },
    lead: {
      en: '`next` points at the ready item; the change starts with a draft intent. The track is suggested, but only a person may choose it.',
      ru: '`next` указывает на готовую задачу; изменение стартует с черновиком замысла. Трек предлагается, но выбрать его может только человек.',
    },
    steps: ['next-empty', 'start', 'status'],
    more: ['track-agent', 'instructions'],
  },
  {
    id: 'gates', layout: 'steps',
    title: { en: 'Gates: the right person, or no one', ru: 'Гейты: нужный человек или никто' },
    lead: {
      en: 'The agent cannot approve. Bob is not the product owner. Alice approves the intent and the spec; Bob, the engineer, the plan.',
      ru: 'Агент утверждать не может. Боб не владелец продукта. Алиса утверждает замысел и спецификацию, инженер Боб — план.',
    },
    steps: ['approve-intent-agent', 'approve-intent-bob', 'approve-intent'],
    more: ['approve-spec', 'approve-plan'],
  },
  {
    id: 'openspec-change', layout: 'steps',
    title: { en: 'OpenSpec underneath: the change is an OpenSpec change', ru: 'Под капотом OpenSpec: обычное изменение OpenSpec' },
    lead: {
      en: 'scdl does not fork OpenSpec. The change lives in openspec/changes and OpenSpec reads it as its own: list, status, deltas.',
      ru: 'scdl не форкает OpenSpec. Изменение лежит в openspec/changes, и OpenSpec читает его как своё: список, статус, дельты.',
    },
    steps: ['os-list', 'os-status', 'os-show'],
    notes: {
      en: 'OpenSpec does the spec work through its JSON CLI: changes, artifact instructions, validation and the delta merge on archive. /opsx:* commands keep working on the same folder.',
      ru: 'Всю работу со спецификациями OpenSpec делает через свой JSON CLI: изменения, инструкции к артефактам, валидация и слияние дельт при архивации. Команды /opsx:* работают с той же папкой.',
    },
  },
  {
    id: 'openspec-validate', layout: 'steps',
    title: { en: 'Delta specs and strict validation', ru: 'Дельты спецификаций и строгая валидация' },
    lead: {
      en: 'Requirements change as deltas (ADDED, MODIFIED, REMOVED). A requirement without a scenario is refused before anyone approves the spec.',
      ru: 'Требования меняются дельтами (ADDED, MODIFIED, REMOVED). Требование без сценария отклоняется ещё до утверждения спецификации.',
    },
    steps: ['validate-bad', 'validate', 'os-schema'],
    notes: {
      en: 'sdlc validate runs openspec validate --strict and adds checks OpenSpec lacks: delta targets exist, ADDED does not collide, overlaps between open changes.',
      ru: 'sdlc validate запускает openspec validate --strict и добавляет проверки, которых нет в OpenSpec: цели дельт существуют, ADDED не конфликтует, пересечения между открытыми изменениями.',
    },
  },
  {
    id: 'build', layout: 'steps', highlight: ['build', 'verify'],
    title: { en: 'Build and verify with evidence', ru: 'Сборка и проверка с доказательствами' },
    lead: {
      en: 'Bob writes the code on a branch. `verify` runs the real checks and records the evidence; every spec scenario needs a row.',
      ru: 'Боб пишет код в ветке. `verify` запускает настоящие проверки и записывает доказательства; для каждого сценария спецификации нужна строка.',
    },
    steps: ['verify', 'verify-check'],
  },
  {
    id: 'review', layout: 'steps',
    title: { en: 'Review: lenses, a deferred finding, and not your own code', ru: 'Ревью: линзы, отложенная находка и не свой код' },
    lead: {
      en: 'Every pass and lens is covered or says what was checked. One finding is deferred to the registry. Bob wrote the code, so Carol approves.',
      ru: 'Каждый проход и линза либо дают находки, либо говорят, что проверено. Одна находка отложена в реестр. Код писал Боб, поэтому утверждает Кэрол.',
    },
    steps: ['roles-who', 'approve-review-bob', 'approve-review'],
    more: ['review-context', 'defer', 'review-check', 'defer-list'],
  },
  {
    id: 'release', layout: 'steps',
    title: { en: 'Release and signed approvals', ru: 'Релиз и подписанные утверждения' },
    lead: {
      en: 'Alice authorises the release. Every approval is checked against the commit that brought it: signed by the person who approved.',
      ru: 'Алиса разрешает релиз. Каждое утверждение сверяется с коммитом, который его принёс: подписан ли он тем, кто утвердил.',
    },
    steps: ['approve-release', 'approvals-verify'],
    notes: {
      en: 'Signing modes: off (no signatures), warn (report), required (CI fails). A commit signed by Bob with Alice\'s email is reported as wrong-signer.',
      ru: 'Режимы подписи: off (без подписей), warn (предупреждать), required (CI падает). Коммит, подписанный Бобом с почтой Алисы, помечается как wrong-signer.',
    },
  },
  {
    id: 'openspec-living', layout: 'steps',
    title: { en: 'Archive: the delta becomes the living spec', ru: 'Архив: дельта становится живой спецификацией' },
    lead: {
      en: 'sdlc archive re-checks the gates, then OpenSpec merges the delta into openspec/specs. The requirement now lives in the spec; B1 closes.',
      ru: 'sdlc archive перепроверяет гейты, затем OpenSpec вливает дельту в openspec/specs. Требование теперь живёт в спецификации; B1 закрывается.',
    },
    steps: ['archive', 'openspec', 'os-spec-show'],
    more: ['list-after'],
  },
  {
    id: 'safety', layout: 'refusals',
    title: { en: 'Safety nets: what agents cannot do', ru: 'Страховка: чего агенты не могут' },
    lead: {
      en: 'Every refusal in the demo, with the reason the CLI gave. Decisions stay with people and are recorded.',
      ru: 'Все отказы в демо с причиной, которую дал CLI. Решения остаются за людьми и записываются.',
    },
  },
  {
    id: 'bugfix', layout: 'steps',
    title: { en: 'A bug fix, a rejected idea, a waiver', ru: 'Исправление бага, отклонённая идея, исключение' },
    lead: {
      en: 'Bug fixes go on the lite track with tests locked first. Alice rejects voice input with a reason and waives the release step for an internal fix.',
      ru: 'Исправления идут по облегчённому треку, тесты сначала блокируются. Алиса отклоняет голосовой ввод с причиной и снимает шаг релиза для внутреннего исправления.',
    },
    steps: ['tests-lock', 'reject', 'waive'],
    more: ['new-fix', 'track', 'tests-unlock-agent', 'tests-unlock', 'new-idea', 'defer-close', 'backlog-done'],
  },
  {
    id: 'bmad', layout: 'steps',
    title: { en: 'BMAD planning comes in as backlog items', ru: 'Планирование BMAD превращается в задачи бэклога' },
    lead: {
      en: 'An epic and its tickets from BMAD-METHOD become backlog items with their dependencies.',
      ru: 'Эпик и тикеты из BMAD-METHOD становятся задачами бэклога вместе с зависимостями.',
    },
    steps: ['import'],
  },
  {
    id: 'visibility', layout: 'steps',
    title: { en: 'The whole picture, always current', ru: 'Вся картина, всегда актуальная' },
    lead: {
      en: 'Status, a report with diagrams, an offline dashboard, metrics and a log. A background script keeps the dashboard page fresh.',
      ru: 'Статус, отчёт с диаграммами, офлайн-дашборд, метрики и журнал. Фоновый скрипт держит страницу дашборда свежей.',
    },
    steps: ['status-all', 'audit', 'log'],
    more: ['status-md', 'report', 'dashboard', 'statusline', 'hook', 'plugin', 'uninstall'],
    notes: {
      en: 'scripts/examples/dashboard-watch.mjs watches openspec/ and rebuilds reports/dashboard.html; examples run it as a Windows task, a systemd or launchd service, or a CI step.',
      ru: 'scripts/examples/dashboard-watch.mjs следит за openspec/ и пересобирает reports/dashboard.html; в примерах он запускается задачей Windows, сервисом systemd или launchd, или шагом CI.',
    },
  },
  {
    id: 'coverage', layout: 'coverage',
    title: { en: 'Every command, one scenario', ru: 'Все команды в одном сценарии' },
    lead: {
      en: 'The demo is an acceptance test: it fails if a command is missing from the story.',
      ru: 'Демо — это приёмочный тест: он падает, если какая-то команда не попала в сценарий.',
    },
  },
  {
    id: 'closing', layout: 'closing',
    title: { en: 'People decide. Agents do. Git remembers.', ru: 'Решают люди. Делают агенты. Помнит git.' },
    points: {
      en: [
        'Approvals come from people in roles.yaml, bound to content, optionally signed.',
        'Nobody pushes through their own work: authors do not approve their review or release.',
        'Everything is files in the repository: backlog, specs, evidence, decisions.',
      ],
      ru: [
        'Утверждают люди из roles.yaml; утверждение привязано к содержимому и может быть подписано.',
        'Никто не протолкнёт свою работу: автор не утверждает своё ревью и релиз.',
        'Всё — файлы в репозитории: бэклог, спецификации, доказательства, решения.',
      ],
    },
    reproduce: [
      'npx vitest run test/e2e-calculator.test.ts',
      'npm run demo:deck',
    ],
  },
];

/** Russian notes for the steps (the English note comes from the transcript). */
export const STEP_NOTE_RU = {
  init: 'Алиса ставит scdl для Claude Code и OpenCode, со строкой статуса.',
  doctor: 'Проверка установки.',
  license: 'Под какой лицензией проект использует scdl.',
  help: 'Каталог: процессы, команды и решения, которые принимают только люди.',
  'layout-check': 'Готов ли проект к работе с ИИ? Пока нет.',
  'layout-scaffold': 'Агент создаёт AGENTS.md, CLAUDE.md и каркас документации.',
  'layout-adapt': 'Адаптировать нечего: всё на своих местах.',
  'layout-convert': 'Конвертировать нечего (пробный прогон).',
  update: 'Сгенерированные файлы актуальны.',
  'roles-check': 'Кто какую роль держит.',
  'roles-migrate': 'Агент не может писать файл ролей.',
  explore: 'Агент открывает исследование: нужен ли кассе свой калькулятор?',
  'explore-list': 'Исследования в проекте.',
  'epic-add': 'Эпик.',
  'add-b1': 'Первая задача, из исследования.',
  'add-b2': 'Зависит от B1.',
  'add-b3': 'Зависит от B1.',
  'move-agent': 'Приоритет решает человек: агенту отказано.',
  move: 'Алиса ставит память раньше процентов.',
  'add-b4': 'Сырая идея без результата.',
  drop: 'Алиса её убирает.',
  list: 'Бэклог с готовностью и прогрессом эпика.',
  'backlog-next': 'Первая готовая задача.',
  'next-empty': 'Активного изменения нет: next предлагает задачу из бэклога.',
  start: 'Изменение с черновиком замысла из задачи.',
  'track-agent': 'Агент не может выбрать облегчённый трек.',
  status: 'Степпер: текущий шаг — замысел.',
  instructions: 'Что должно быть в замысле.',
  'approve-intent-agent': 'Агент не может утверждать.',
  'approve-intent-bob': 'Боб не владелец продукта.',
  'approve-intent': 'Алиса утверждает замысел.',
  validate: 'Со сценариями строгая валидация OpenSpec и проверки целей дельт проходят.',
  'approve-spec': 'Алиса утверждает спецификацию.',
  'approve-plan': 'Боб, инженер, утверждает план.',
  verify: 'Настоящие проверки, записанные доказательства.',
  'verify-check': 'У каждого сценария есть доказательство.',
  'review-context': 'Проходы, линзы и отклонения от плана.',
  defer: 'Отложенная находка уходит в реестр.',
  'review-check': 'Покрыты все проходы и линзы, ссылка на отложенное верна.',
  'defer-list': 'Реестр отложенного.',
  'roles-who': 'Кто может утвердить ревью: не Боб, код писал он.',
  'approve-review-bob': 'Боб — автор: отказ.',
  'approve-review': 'Кэрол утверждает ревью.',
  'approve-release': 'Алиса разрешает релиз.',
  'approvals-verify': 'Проверка подписей (режим warn): Алиса и Кэрол подписывают; утверждение плана Бобом без подписи — предупреждение, не блокировка.',
  archive: 'Дельта вливается в живую спецификацию; B1 закрывается.',
  'validate-bad': 'В первом черновике требование без сценария: строгая валидация его отклоняет.',
  'os-schema': 'Схема sdlc — стандартная схема OpenSpec.',
  'os-list': 'OpenSpec показывает изменение, как любое своё.',
  'os-status': 'Готовность артефактов по схеме sdlc считает OpenSpec.',
  'os-show': 'Изменение глазами OpenSpec: добавленное требование и его сценарии.',
  'os-spec-show': 'В живой спецификации теперь есть требование, которое добавило изменение.',
  openspec: 'Возможность calculator стала живой спецификацией.',
  'list-after': 'Теперь готовы B3 и B2.',
  'new-fix': 'Исправление бага: CLI предлагает облегчённый трек, решает человек.',
  track: 'Боб подтверждает облегчённый трек.',
  'tests-lock': 'Тесты заблокированы: падающий тест — доказательство.',
  'tests-unlock-agent': 'Разблокировку решает человек.',
  'tests-unlock': 'Боб разблокирует.',
  'new-idea': 'Агент предлагает голосовой ввод.',
  reject: 'Алиса отклоняет с причиной.',
  waive: 'Записанное исключение.',
  'defer-close': 'Отложенную находку закрывают, когда её решили.',
  'backlog-done': 'Задачу можно закрыть без изменения.',
  import: 'Эпик и тикеты из BMAD становятся задачами бэклога.',
  'status-all': 'Все активные изменения.',
  'status-md': 'Отчёт для pull request.',
  report: 'Отчёт о прогрессе с диаграммами Mermaid.',
  dashboard: 'Дашборд — одна офлайн-страница HTML.',
  audit: 'Время прохождения и доля проверок с первого раза.',
  log: 'Кто что сделал, с версией scdl и лицензией.',
  statusline: 'Строка статуса Claude Code.',
  hook: 'Что агент узнаёт при старте сессии.',
  plugin: 'Те же процессы как плагин Claude Code.',
  uninstall: 'Удаление сохраняет все файлы планирования.',
};
