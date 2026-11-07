# gh-pages — опубликованная сборка Sandblaster

Сайт: **https://davidchagalidze.github.io/sandblaster/**

Ветку собирает `tools/publish-pages.mjs` из `HEAD` @ `6ab21c82934d59d862a7ed770308949ade5bb893`; руками здесь ничего
не редактируется. Публикуется только рантайм по белому списку:
`index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`, `src/`.

## Ключ офлайн-кэша этой сборки

```
const CACHE = 'sandblaster-2c18b7ae91d6';
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
