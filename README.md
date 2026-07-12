# Onyx Web

A premium, private, **bring-your-own-key** AI assistant that runs entirely in your browser — the
web edition of the [Onyx](https://github.com/Notbangbang-dev) phone & desktop apps.

**▶ Live:** https://notbangbang-dev.github.io/onyx-web/

- Talks **directly** from your browser to the AI provider you configure (OpenAI-compatible,
  Anthropic-compatible, or a custom endpoint) using your own API key.
- Streaming replies, markdown + syntax-highlighted code with copy buttons, conversation history,
  personalities & response styles, image attachments, voice input (STT) and read-aloud (TTS).
- Premium black-and-white theme, accent colours, adjustable font size, mobile-responsive.
- **Optional account sync:** sign in to a self-hosted [Onyx Sync](https://github.com/Notbangbang-dev)
  server to continue the same conversations on your phone and desktop apps.

## Your data
Everything (chats, settings, and API key) is stored in this browser's `localStorage`. Nothing is
sent anywhere except the AI provider you choose — and, if you sign in, your own Onyx Sync server.

## Run locally
It's a static site — no build step:
```bash
# any static server, e.g.
npx serve .
# then open the printed URL
```

## Notes
- **Anthropic** direct-from-browser is enabled via the `anthropic-dangerous-direct-browser-access`
  header. **OpenAI-compatible** endpoints must allow browser CORS (OpenAI itself does).
- Because a hosted page is served over **HTTPS**, an Onyx Sync server you connect to for sync must
  also be **HTTPS** (browsers block mixed content).
- No backend, no tracking, no analytics.

## Tech
Vanilla JS + `marked` + `DOMPurify` + `highlight.js` (via CDN). ~1 file each: `index.html`,
`styles.css`, `app.js`.
