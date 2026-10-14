---
title: MCP и интеграции
summary: sdlc как MCP-сервер, MCP-серверы команды, проверки и стадии.
---
# MCP и интеграции

sdlc работает с MCP в обе стороны. Через MCP ничего не решается.

## sdlc как сервер

`sdlc init --mcp` регистрирует `sdlc mcp serve` для Claude Code (`.mcp.json`), OpenCode (`opencode.json`), Cursor (`.cursor/mcp.json`), Codex (`.codex/config.toml`), Qwen Code (`.qwen/settings.json`) и GigaCode (`.gigacode/settings.json`). Другие
системы — оркестратор, чат-клиент, ассистент в IDE — читают процесс инструментами `status`, `next`, `instructions`,
`trace`, `audit`, `help` и `guide`. Каждый отвечает тем же, что CLI печатает с `--json`.

- Вне проекта (Claude Desktop): `sdlc mcp serve --project <путь>`, можно несколько раз; при нескольких проектах
  каждый инструмент принимает `project` (`project.name` в `sdlc.yaml`, иначе имя папки).
- Ресурсы, только чтение: `sdlc://context/<файл>`, `sdlc://spec/<capability>`, `sdlc://change/<id>/<артефакт>`,
  `sdlc://doc/<путь>`. Файлы состояния и конфигурации не отдаются никогда.

## Доска задач

`board_list` — всем. По HTTP токен исполнителя даёт `board_claim`, `board_heartbeat`,
`board_release` и `board_submit`. Исполнителя задаёт токен; его выдаёт человек:
`sdlc task executors token <id>`. MCP не назначает, не открывает задачи и не принимает решений.
Для назначения и повторного открытия служит `sdlc board`.

## Серверы команды

```yaml
mcp:
  servers:
    build: { type: stdio, command: [npx, -y, corp-build-mcp], env: { CI_TOKEN: "${CI_TOKEN}" }, stages: [build, test] }
    jira:  { type: http, url: https://mcp.corp.example/jira, headers: { Authorization: "Bearer ${JIRA_TOKEN}" }, stages: [plan, deploy] }
```

- `sdlc update` записывает их в `.mcp.json`, `opencode.json`, `.cursor/mcp.json`, `.codex/config.toml`, `.qwen/settings.json` и `.gigacode/settings.json`; секреты — только ссылками `${VAR}`.
- `sdlc mcp check` перечисляет инструменты каждого сервера и предупреждает о серверах, которые пишут файлы.
- `stages` говорят, когда агенту можно вызывать сервер; вне их хук запрещает (block) или напоминает (warn).

## Проверки и результаты

- Проверки `verify.mcp` вызывает CLI во время `sdlc verify` и записывает как доказательства (`sdlc guide verify`).
- Проверки `release.mcp` выполняются, когда человек утверждает релиз; упавшая проверка отклоняет утверждение.
  `sdlc release check` прогоняет их заранее.
- Результаты запусков вне сессии агента ждут в `sdlc inbox list`.
- `events` отправляют события гейтов и проверок на сервер команды; недоставленные ждут `sdlc events flush`.

## По стадиям

`stages.<стадия>.skills` и `.agents` в `openspec/sdlc.yaml` называют, что использует каждая стадия; генерируемые процессы
перечисляют их вместе с MCP-серверами стадии.

Подробнее: главы документации «Интеграции» и «Работа с sdlc через MCP».
