---
title: Роли и разделение обязанностей
summary: openspec/roles.yaml, кто какой гейт может утвердить, подписанные утверждения.
---
# Роли и разделение обязанностей

Без `openspec/roles.yaml` утвердить может любой с git-идентичностью. С ним утверждения привязаны к конкретным людям.

```yaml
version: 1
signing: warn                 # off | warn | required
people:
  alice: { name: Alice Walker, emails: [alice@corp.example] }
  bob:   { name: Bob Turner,   emails: [bob@corp.example] }
roles:
  product-owner: [alice]
  engineer: [bob]
  code-owner: [bob]
  maintainer: [alice]         # может менять этот файл
separation:
  author_cannot_approve: [review, release]
  distinct_approvers: [[plan, review]]
  max_gates_per_person: 3
```

## Что проверяется при утверждении

- Ваш git-email принадлежит человеку, и у него есть одна из ролей гейта (`approvers` в `sdlc.yaml`).
- **author_cannot_approve**: авторы кода изменения (авторы коммитов и `Co-authored-by`) не утверждают эти гейты.
- **distinct_approvers**: парные гейты утверждают разные люди.
- **max_gates_per_person**: сколько гейтов одного изменения может утвердить один человек.

## Полезные команды

- `sdlc roles who review --change <id>` — кто может утвердить сейчас и почему другие не могут.
- `sdlc roles check` — матрица людей, ролей и гейтов.
- `sdlc review suggest --change <id>` — предложенный ревьюер (сначала владельцы изменённых файлов, никогда не автор).
- `sdlc approvals verify` — каждое утверждение пришло в коммите, подписанном утвердившим (при `signing`).
- `sdlc roles migrate` — перенести `roles:` из `sdlc.yaml` в `roles.yaml` (команда человека).

Агент не может править `roles.yaml`; защитите его ещё и в git через CODEOWNERS и защиту ветки.
