# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is an npm-workspaces monorepo:

- `web/` is the React/Vite frontend. Routes, author pages, CodeMirror editing, Zustand auth state, and API clients live here.
- `server/` is the Express/TypeScript backend. It uses Node 24's built-in `node:sqlite`, session authentication, ownership middleware, and SSE endpoints.
- `desktop/` packages the built frontend and bundled Express server into an Electron Windows portable application.
- `data/` is runtime data for local server development. Do not treat it as source code.

The frontend calls same-origin `/api` endpoints. The server mounts resource routers from `server/src/routes/`, initializes the database in `server/src/db.ts`, and serves `web/dist` in production. Electron starts the bundled server on a loopback port and stores production data beneath Electron's user-data directory.

## Common commands

Run from the repository root:

```bash
npm install
npm run dev -w server
npm run dev -w web
npm run build -w web
npm run build -w server
npm run build:exe
```

`npm run build:exe` builds the frontend, bundles the server, and creates `desktop/release/起笔-1.0.0-portable.exe`.

There is no configured test suite. Use the TypeScript builds as the baseline verification, then manually exercise authentication, chapter/outline persistence, AI SSE output, file import, and the Electron portable build when changing those paths.

## Important implementation details

- The server requires Node 24 because SQLite is imported from `node:sqlite`.
- All resource routes must enforce ownership with the matching middleware (`ownsNovel`, `ownsChapter`, `ownsOutline`, `ownsMap`, or an equivalent user-scoped query). Never infer ownership from an unrelated resource ID.
- JSON requests are limited to 2MB. Large novel materials use the chunked upload endpoints under `/api/skill-authors` and are stored outside SQLite under the configured data directory.
- AI requests support Anthropic native and OpenAI-compatible protocols. Keep the runtime key, base URL, protocol, and model from the same configuration source; never log keys or authorization headers.
- AI responses are streamed as application SSE. Empty upstream output must not overwrite chapter content.
- The editor route deliberately uses a constrained viewport. Preserve `min-h-0` on flex ancestors and let CodeMirror's `.cm-scroller` own scrolling when changing the writing layout.
- The two supplied novel skills are treated as reference material. Do not execute their Python tools or expose Claude Code tool instructions to the browser; application behavior belongs in the Node/SQLite/API adapter.
- Distilled-author inputs must be content the user owns or is authorized to use.

## Desktop packaging

`desktop/build-server.mjs` bundles `server/src/index.ts`, copies `web/dist`, and sets production environment variables. Keep runtime files and dependencies reachable from that bundle and verify the portable executable after changes to either workspace.
