---
title: Почему хук отказал
summary: Каждое правило хука - почему остановило агента и что делать.
---
# Почему хук отказал

Контроль вашего инструмента проверяет каждую правку, команду оболочки и вызов MCP агента: хуки Claude Code, Cursor,
Codex CLI, Qwen Code и GigaCode или плагин OpenCode. Отказ называет правило в скобках, например `[sdlc:plan-gate]`.
Жёсткие правила действуют и в режиме `warn`; правила процесса запрещают только в режиме `block`, а в `warn`
напоминают.
Отказы и предупреждения хука сначала попадают в игнорируемую локальную очередь. `sdlc log` и `sdlc health` видят их
сразу; следующая команда CLI, которая пишет общий журнал, переносит их туда по порядку.

## plan-gate

Правило процесса. Агент собирался писать код без утверждённого плана. **Что делать:** написать `plan.md` и `tasks.md`
(процесс plan), и человек выполняет `sdlc approve plan --change <id>`. Документация и `openspec/` не проверяются.
Если активно несколько изменений, код можно записывать только в файлы из раздела "## Files that change"
утверждённого плана, включая пути, подходящие под шаблоны; при одном изменении утверждённый план разрешает правки кода.
С 0.14.0 это касается и команд оболочки в любом инструменте. Файлы, которые пишут `>`, `tee`, `cp`, `mv`,
`Set-Content`/`sc`, `Tee-Object`, `Out-File`, `New-Item`, `Copy-Item`/`Move-Item`, `Rename-Item`,
методы записи `.NET File`, `sed -i`, `perl -i`, `touch`, `truncate`, `dd of=`, `git checkout`/`restore`/`mv`/`apply`, `patch`,
`curl -o`, `wget -O`, `Invoke-WebRequest -OutFile`, `node -e`, `python -c`, команды внутри `iex` и `Start-Process`
и `apply_patch`, проверяются как правка.
Чтение файлов под это правило не подпадает.
Инструменты чтения и поиска работают до утверждения plan и во время takeover, даже если указан путь.
Инструменты записи по-прежнему проверяются хуком.

## protected-path

Жёсткое правило. Путь в `enforcement.protected_paths`. **Что делать:** менять его через владеющий процесс, вне сессии
агента.

## tests-locked

Жёсткое правило. При исправлении ошибки тесты заблокированы (`sdlc tests lock`). **Что делать:** исправлять код, а не
тест. Если тест действительно неверен, человек выполняет `sdlc tests unlock --change <id>`.

## state-integrity

Жёсткое правило. `.sdlc.yaml`, `openspec/roles.yaml`, журнал, локальную очередь решений хука
`openspec/.sdlc/hook-log.jsonl`, inbox, запись команды, бэклог,
`openspec/.sdlc/board.json` и его блокировку `openspec/.sdlc/board.lock` записывает только CLI.
Очередь решений хука — защищённый файл состояния. Агент не может её изменять.
Реестр исполнителей `openspec/executors.yaml` редактирует только человек.
**Что делать:** для этих записей использовать `sdlc approve` (человек), `sdlc backlog add|edit` или `sdlc verify`.
Попросить человека изменить реестр; состояние доски менять через `sdlc board`.

## guard-config

Жёсткое правило. Файл настраивает сам контроль: `openspec/sdlc.yaml`, `.claude/settings*.json`, плагин OpenCode,
`.mcp.json`, `opencode.json`, `.cursor/hooks.json`, `.cursor/mcp.json`, `.codex/hooks.json`, `.codex/config.toml`,
`.codex/rules/sdlc.rules`, `.qwen/settings.json`, `.gigacode/settings.json`, манифест, пользовательские настройки
агентов (среди них пользовательские хуки Cursor `~/.cursor/hooks.json`), принятые роли команды в `docs/agents/`,
файлы, которые sdlc генерирует для агентов (субагенты `sdlc-*`, навыки и команды процессов), политика ревью
(`REVIEW.md` или `review.policy`), схема sdlc и `openspec/config.yaml`.
**Что делать:** попросить человека внести изменение; `sdlc update` восстанавливает сгенерированные файлы.

## separation-of-duties

Жёсткое правило. Команда фиксирует решение человека (`sdlc approve`, `sdlc reject`, `sdlc waive`, `sdlc rework`,
`sdlc takeover`, `sdlc track set`, `sdlc backlog move`, `sdlc uninstall`…). **Что делать:** дать человеку точную
команду для его терминала — не команду с `!` в чате агента.

## living-specs

Правило процесса. Живые спецификации в `openspec/specs/` обновляет только `sdlc archive` после утверждения.
**Что делать:** подготовить дельта-спецификацию в `openspec/changes/<id>/specs/<capability>/spec.md`.

## change-not-created

Правило процесса. В папке изменения нет ни `.sdlc.yaml`, ни `.openspec.yaml`.
**Что делать:** создать изменение командой `sdlc new <id>` или `sdlc backlog start B<n> --change <id>`.

## agent-marker

Жёсткое правило. Команда сбрасывает `CLAUDECODE`, `OPENCODE`, `AGENT`, `SDLC_AGENT`, `CURSOR_AGENT`, `CODEX_CI`, `QWEN_CODE` или
`CODEX_SESSION_ID` (`Codex`) или `QWEN_CODE_SESSION_ID` (`Qwen`), и агент сошёл бы за человека.
**Что делать:** выполнить команду, не трогая эти переменные.

## cli-removal

Жёсткое правило. Удаление CLI sdlc выключило бы проверки. **Что делать:** удаляет человек, если это действительно нужно.

## secret-in-edit

Жёсткое правило. Правка добавляет ключ, токен или пароль. **Что делать:** читать его из переменной окружения или
хранилища секретов (`process.env.X`, `${VAR}`). Тестовые данные с правдоподобными ключами — по путям из
`enforcement.secret_allow` (добавляет человек).

## release-gate

Жёсткое правило. Продакшен-команда (`release.commands`) до утверждения релиза. **Что делать:** подготовить
`release.md`; релиз-менеджер выполняет `sdlc approve release --change <id>`.

## takeover

Жёсткое правило. Изменение у человека (`sdlc takeover`). **Что делать:** ждать `sdlc release-control`; команды
только для чтения работают.

## mcp-stage

Правило процесса. MCP-сервер не предназначен для текущей стадии (`mcp.servers.<имя>.stages`). **Что делать:** дождаться
стадии из его списка или попросить человека добавить стадию.
