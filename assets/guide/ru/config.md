---
title: Настройка
summary: Основные ключи openspec/sdlc.yaml и кто может их менять.
---
# Настройка

`openspec/sdlc.yaml` настраивает процесс. **Правит его только человек**: хук запрещает агенту правки, потому что файл
управляет и самим контролем.

| Ключ | Что делает |
|---|---|
| `gates.<gate>` | `required`, `approvers` (роли), `high_risk_approvers`, `min_approvals`, `auto_waive` (виды, треки; только intent, spec, plan; вид, выбранный агентом, не считается) |
| `rework.max_cycles` | сколько возвратов одного гейта до того, как `next` позовёт человека (по умолчанию 3) |
| `verify.commands` | проверки проекта: `{ name, run, required }` |
| `verify.mcp`, `release.mcp` | проверки, которые CLI вызывает на MCP-сервере, для гейтов проверки и релиза |
| `project.name` | имя проекта в MCP и событиях (по умолчанию — имя папки) |
| `events` | получатели событий процесса: `{ server, tool, on, args }` |
| `gates.<gate>.overdue_hours` | через сколько часов ожидающий гейт даёт событие просрочки |
| `review` | `policy` (REVIEW.md), `passes`, `lenses`, `base`, `block_on` |
| `release.commands` | регулярные выражения продакшен-команд, которые агенту нельзя до утверждения релиза |
| `enforcement.mode` | `off`, `warn` (напоминать), `block` (запрещать по правилам процесса); жёсткие правила действуют и в warn |
| `enforcement.protected_paths` | пути, которые агенту нельзя трогать никогда |
| `enforcement.test_paths` | что считается тестом (для блокировки тестов) |
| `enforcement.secret_allow` | пути, где тестовые данные могут содержать похожие на настоящие ключи |
| `mcp.serve`, `mcp.servers` | свой MCP-сервер sdlc, серверы команды |
| `stages.<стадия>` | навыки и субагенты стадии |
| `cli` | как агенты вызывают sdlc (`sdlc` или `npx --no-install sdlc`) |
| `tools` | claude, opencode |

## После изменения

Выполните `sdlc update`, чтобы перегенерировать файлы агентов и хуки. `sdlc doctor` проверит установку.

## В сессии агента

`sdlc init` и `sdlc update` по-прежнему восстанавливают сгенерированные файлы, но не дают ослабить контроль: понизить
режим, убрать инструменты, указать `--no-hooks` или другой `--cli`. `sdlc uninstall` — команда человека.

Контекст проекта и правила для артефактов — в `openspec/config.yaml` (`context:`, `rules.<artifact>`), как в OpenSpec.
