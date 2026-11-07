# gh-pages — опубликованная сборка Dig Deeper

Сайт: **https://davidchagalidze.github.io/dig-deeper/**

Ветку собирает `tools/publish-pages.mjs` из `origin/main` @ `c6ad96c08f3c1ef4ebe8c8d21d443c8888f5381b`; руками здесь ничего
не редактируется. Публикуется только рантайм по белому списку:
`index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/` и `src/`.
`design/`, `tests/`, `tools/`, `docs/` сюда не попадают: модель, которую игра импортирует
в рантайме, лежит в `src/model/model-v1.mjs`, а `design/model-v1.mjs` — шим для design/tools/tests.

## Ключ офлайн-кэша этой сборки

```
const CACHE = 'dig-deeper-9454cf864650';
```

Ключ — отпечаток содержимого опубликованных `ASSETS` (sha256, 12 hex), а не ручной `vN`.
Любая правка игрового файла меняет ключ, и установленный service worker переустанавливает
кэш сам. Руками версию поднимать не нужно и негде.

## Как обновить Pages после мержа в main

Из корня репозитория:

```bash
node tools/publish-pages.mjs
```

Скрипт сам возьмёт `origin/main`, пересоберёт ветку (удалив лишнее), закоммитит и запушит.
Pages подхватит её за минуту. Поле `status` в API врёт (`errored`, `duration 0`) даже
когда сайт отдаётся — проверять только curl и браузером:

```bash
curl -s https://davidchagalidze.github.io/dig-deeper/sw.js | grep CACHE
curl -s -o /dev/null -w '%{http_code}\n' https://davidchagalidze.github.io/dig-deeper/
```

Если в `src/` появился новый модуль — добавить его в `ASSETS` в `sw.js`, иначе он не попадёт
в офлайн-кэш при первой загрузке.
