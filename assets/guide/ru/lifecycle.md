---
title: Жизненный цикл и стадии
summary: Стадии изменения, артефакты каждой и как изменение движется дальше.
---
# Жизненный цикл и стадии

```
explore → intent → spec → plan → build → verify → review → (release) → archive
  Plan      Plan    Design  Build  Build   Test     Deploy    Deploy     Maintain
```

| Стадия | Что пишется | Гейт в конце |
|---|---|---|
| plan | `intent.md`: проблема, результат, мера успеха | intent (владелец продукта) |
| design | `proposal.md`, `specs/`, `design.md` | spec (владелец продукта; техлид при высоком риске) |
| build | `plan.md`, `tasks.md`, потом код | plan (инженер), до любого кода |
| test | `verification.md` из `sdlc verify` | verify (доказательства должны быть свежими) |
| deploy | `review.md`, потом `release.md` | review (владелец кода), release (релиз-менеджер) |
| maintain | `sdlc archive` вливает дельты спецификаций в живые спецификации | — |

## Как изменение движется

- Стадия вычисляется по гейтам, вручную её никто не ставит. `sdlc status --change <id>` показывает шаги.
- Гейт открывается, когда есть его артефакты и пройдены предыдущие гейты.
- Утверждение привязано к содержимому: правка утверждённого артефакта делает утверждение устаревшим, и гейт ждёт нового.
  Исправление опечатки тоже считается.
- После ревью (и релиза, если он обязателен) `sdlc archive` закрывает изменение.

## Процессы

Процессы агента идут по стадиям: explore, intent, spec, plan, build, verify, review, release, archive и triage для
инцидентов. `sdlc next` всегда говорит, какой следующий.

См. также: `sdlc guide gates`, `sdlc guide tracks`.
