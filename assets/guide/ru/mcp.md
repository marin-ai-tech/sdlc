---
title: MCP и интеграции
summary: sdlc как MCP-сервер, MCP-серверы команды, проверки и стадии.
---
# MCP и интеграции

sdlc работает с MCP в обе стороны. Через MCP ничего не решается.

## sdlc как сервер

`sdlc init --mcp` регистрирует `sdlc mcp serve` для Claude Code (`.mcp.json`) и OpenCode (`opencode.json`). Другие
системы — оркестратор, чат-клиент, ассистент в IDE — читают процесс инструментами `status`, `next`, `instructions`,
`trace`, `audit`, `help` и `guide`. Каждый отвечает тем же, что CLI печатает с `--json`.

## Серверы команды

```yaml
mcp:
  servers:
    build: { type: stdio, command: [npx, -y, corp-build-mcp], env: { CI_TOKEN: "${CI_TOKEN}" }, stages: [build, test] }
    jira:  { type: http, url: https://mcp.corp.example/jira, headers: { Authorization: "Bearer ${JIRA_TOKEN}" }, stages: [plan, deploy] }
```

- `sdlc update` записывает их в `.mcp.json` и `opencode.json`; секреты — только ссылками `${VAR}`.
- `sdlc mcp check` перечисляет инструменты каждого сервера и предупреждает о серверах, которые пишут файлы.
- `stages` говорят, когда агенту можно вызывать сервер; вне их хук запрещает (block) или напоминает (warn).

## Проверки и результаты

- Проверки `verify.mcp` вызывает CLI во время `sdlc verify` и записывает как доказательства (`sdlc guide verify`).
- Результаты запусков вне сессии агента ждут в `sdlc inbox list`.

## По стадиям

`stages.<стадия>.skills` и `.agents` в `openspec/sdlc.yaml` называют, что использует каждая стадия; генерируемые процессы
перечисляют их вместе с MCP-серверами стадии.

Подробнее: главы документации «Интеграции» и «Работа с sdlc через MCP».
