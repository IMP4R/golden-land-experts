# Golden Land — Experts

Golden Land Experts: source snapshot на базе DeepSeek Harness с дополнительными экспертными модулями.

## Состав

- `.agents`/
- `.editorconfig`
- `.gitattributes`
- `.github`/
- `.gitignore`
- `.gitlab-ci.yml`
- `.jscpd.json`
- `.oxlintrc.json`
- `.oxlintrc.staged.json`
- `.rgignore`
- `AGENTS.md`
- `BENCHMARK.md`
- `BRAND_GUIDELINES.i18n.yaml`
- `BRAND_GUIDELINES.md`
- `BRAND_GUIDELINES.zh.md`
- `CONTRIBUTING.i18n.yaml`
- `CONTRIBUTING.md`
- `CONTRIBUTING.zh.md`
- `LICENSE`
- `PUBLICATION.md`
- `README.i18n.yaml`
- `README.zh.md`
- `SOURCE-FILES.txt`
- `THIRD_PARTY_NOTICES.md`
- `apps`/
- `docs`/
- `examples`/
- `golden-land-overlay`/
- `knip.json`
- `lefthook.yml`

## Документация исходного проекта

Исходный README сохранён без изменений: [docs/ORIGINAL_README.md](docs/ORIGINAL_README.md). Его команды и исторические заявления не являются результатом новой проверки.

Дополнительная документация:
- [native/README.md](native/README.md)
- [python/README.md](python/README.md)
- [examples/README.md](examples/README.md)
- [packages/README.md](packages/README.md)
- [vendor/README.md](vendor/README.md)
- [vendor/logger-console/README.md](vendor/logger-console/README.md)

## Подготовка и запуск

Манифесты зависимостей в этой копии:
- [package.json](package.json)
- [website/package.json](website/package.json)
- [examples/package.json](examples/package.json)
- [vendor/logger-console/package.json](vendor/logger-console/package.json)
- [vendor/group/package.json](vendor/group/package.json)
- [vendor/hmr/package.json](vendor/hmr/package.json)
- [vendor/include/package.json](vendor/include/package.json)
- [vendor/cosmokit/package.json](vendor/cosmokit/package.json)

Объявленные npm scripts: `build`, `build:official`, `build:lib`, `build:lib:host`, `build:lib:client`, `build:web`, `clean`, `change-scope`, `typecheck`, `typecheck:contracts-ready`, `lint`, `lint:contracts-ready`, `lint:fix`, `lint:fix:contracts-ready`, `duplication`, `test`, `test:coverage`, `test:coverage:partitioned`, `test:e2e`, `test:issue-management`, `test:snapshot`, `test:snapshot:record`, `test:snapshot:refresh`, `migrate:packed-session-fixtures`, `test:web`, `test:web:refresh`, `test:web:built`, `test:web:ci`, `test:web:perf`, `test:web:perf:built`, `test:web:stress`, `test:gui`, `check:all`, `check:ci`, `check:ci:linux-primary`, `check:ci:static`, `check:ci:lint:contracts-ready`, `check:ci:coverage`, `check:ci:snapshot`, `check:ci:artifacts`, `check:ci:consumers`, `check:windows-wine`, `check:ci:windows-blocking`, `check:ci:windows-complete`, `check:ci:windows-observational`, `check:node-compat`, `knip`, `publint`, `doc-typecheck`, `doc-typecheck:contracts-ready`, `verify-md-wrap`, `verify-md-links`, `verify-doc-site-fragments`, `verify-public-repository-links`, `verify-doc-refs`, `verify-package-paths`, `verify-dsh-package-licenses`, `verify-config-source-ownership`, `verify-package-invariants`, `verify-built-package-invariants`, `verify-package-readme-model-experience`, `verify-mermaid`, `verify-agent-note-classification`, `verify-agent-note-format`, `verify-archived-agent-notes`, `verify-type-equiv`, `verify-skill-invocation-metadata`, `verify-translation-prompt`, `verify-translation-pairing`, `resolve-translation-pairing-conflicts`, `gen-translation-brief`, `verify-doc-budgets`, `docs:dev`, `docs:build`, `docs:build:mpa`, `docs:preview`, `docs:check`, `website:dev`, `website:build`, `verify-package-readme-limitations`, `verify-node-next-types`, `verify-optional-dependency-imports`, `verify-runtime-closure`, `verify-client-packages`, `verify-vendored-links`, `verify-cordis-config`, `rescope-vendor`, `rescope-vendor:check`, `verify-client-domain-graph`, `gen-cordis-catalog`, `verify-cordis-catalog`, `gen-cordis-api`, `verify-cordis-api`, `gen-client-catalog`, `gen-cordis-inspect-catalog`, `verify-client-catalog`, `verify-export-jsdoc`, `gen-tool-catalog`, `verify-tool-catalog`, `gen-config-catalog`, `verify-config-catalog`, `gen-doc-graphs`, `verify-doc-graphs`, `gen-persistence-catalog`, `verify-persistence-catalog`, `gen-third-party-notices`, `verify-third-party-notices`, `gen-module-graph`, `gen-scoped-events`, `verify-scoped-events`, `verify-module-graph`, `constraints`, `doc-sync`, `hygiene`, `publish:npm-baseline`, `release:dsh`, `release:vendor`, `release:verify`, `release:pack`, `release:verify-packed-install`, `release:publish`, `dsh`, `demo:code-mode`, `demo:cordis`, `demo:acp`, `mock:llm`, `dev:web`, `postinstall`. Перед запуском проверьте `package.json`; установка и scripts при публикации не выполнялись.

Это производный source snapshot, а не официальный релиз DeepSeek. Upstream: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). Разработчики upstream сохраняют авторство своего кода. Дополнения находятся в `plugins/` и `golden-land-overlay/`; перенос не подтверждает их совместимость или готовность к запуску.

Не импортируйте и не запускайте незнакомые модули автоматически: возможны сетевые запросы, платежные операции и другие внешние эффекты. Отсутствующие данные, сервисы и конфигурацию нужно подготовить самостоятельно.

## Ограничения снимка

- Current experts checkout working-tree source, including upstream attribution; not runtime-certified.
- При оформлении репозитория приложение не развёртывалось, платежи и внешние API не запускались; тесты не перепроверялись.

## Происхождение и лицензии

Репозиторий оформлен из исходного ZIP портфолио Moon; это не восстановленная история разработки. Существующие LICENSE, notices и сведения об авторах сохранены. Новая лицензия не назначается; публичный доступ сам по себе не означает разрешение на произвольное использование.

Архив: `golden-land-experts.zip`. SHA-256 исходного ZIP: `630f3ad98524d566a1784f203014728791942f454c745fe172fa2ab77797d96b`.
