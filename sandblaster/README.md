# gh-pages — опубликованная сборка Sandblaster

Сайт: **https://davidchagalidze.github.io/sandblaster/**

Ветку собирает `tools/publish-pages.mjs` из `HEAD` @ `f65a61febbb41b6aa8252b1740dd67ad7f3c546e`; руками здесь ничего
не редактируется. Публикуется только рантайм по белому списку:
`index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`, `src/`.

## Ключ офлайн-кэша этой сборки

```
const CACHE = 'sandblaster-189ae47ac3cc';
```

Ключ — sha256 опубликованных `ASSETS` (12 hex). Любая правка игрового файла меняет ключ,
и установленный service worker переустанавливает кэш сам. Руками версию поднимать не нужно.

## Обновить Pages после мержа в main

```bash
node tools/publish-pages.mjs
```

Поле `status` в API врёт даже когда сайт отдаётся — проверять только curl и браузером:

```bash
curl -s https://davidchagalidze.github.io/sandblaster/sw.js | grep CACHE
curl -s -o /dev/null -w '%{http_code}\n' https://davidchagalidze.github.io/sandblaster/
```
