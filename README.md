# WeiDu (围读)

WeiDu is a local AI workflow for writing a novel one section at a time, then passing that section to AI readers who review it. You keep the versions, the notes, and the decision about what to change next.

The product name is 围读 (WeiDu). This repository is [AITableRead](https://github.com/monsterL1990/AITableRead). Some internal names are still `gaojian` and `GAOJIAN_*`. Those are leftovers from the earlier desk and are not a second product.

This tree is meant for **one person on one machine**. You run it yourself, point it at an API you control, and keep the manuscript on disk.

Licensed under the [MIT License](LICENSE). Copyright 2026 monsterL1990.

## What you do with it

1. Idea to outline
2. Outline to draft
3. Draft to polish

Each step can be regenerated. Reader reviews are optional. A structural check can compare the draft with the outline and the word-count target. Characters in the story are required to be adults.

With no model configured, the buttons still run and return editable Chinese placeholder text so you can walk the three steps.

## Configure it

Copy `.env.example` to `.env.local`. Do not commit that file.

The default way to get real prose is a **custom OpenAI-compatible API**:

```bash
OPENAI_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-model
```

Leave the URL and key empty and the app stays in demo mode. The key stays on the server. You can also save a base URL, key, and model in Settings; that copy lives in `data/store.json`, which is gitignored.

**Optional, later:** a self-hosted [DSH](https://github.com/deepseek-ai/DeepSeek-Harness) (DeepSeek Harness) instance. Set `DSH_BASE_URL`, `DSH_TOKEN`, and `DSH_SESSION_ID` only if you run one. Plugins on that instance are your business. WeiDu does not require a purge plugin, does not ship one, and does not install one for you. If the template session has an agent preset, a new turn copies that preset. That is all.

There is no hosted WeiDu service in this repository, and the defaults do not point at one.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4721](http://127.0.0.1:4721). Use that address. The dev server allows `localhost` and `127.0.0.1`.

Sign in as `local`. Set `APP_PASSWORD` in `.env.local`. If you leave the password unset in development, the password is `changeme`. That fallback is disabled when `NODE_ENV=production`. Set `APP_SESSION_SECRET` to a long random string before anyone else can open the app.

```bash
npm test
npm run lint
npm run build
npm run start
```

`npm run start` also listens on port 4721.

Docker, still one machine, with the same variables from a `.env` file next to the compose file:

```bash
cp .env.example .env
docker compose up -d --build
```

The container listens on port 3000 and the compose file publishes it on 4721. Manuscripts are in the `weidu-data` volume (`/app/data/store.json`).

## Single user

Use the `local` account. Manuscripts, readers, prompts, and settings for that login stay in `data/` on this machine.

An Accounts page and a few preset account types are still in the code from an earlier multi-user desk. They are not the setup this README describes. Do not treat preset Grok or preset DeepSeek accounts as the way to install WeiDu. Those paths expect a shared DSH and are the wrong default for a local copy.

The settings screen still labels the environment OpenAI-compatible route "CLIProxy". For this release, that label means "the `OPENAI_BASE_URL` you set". It is not a bundled proxy.

## P1

Still to do, and intentionally not in this tree:

- Make the local single user the only account path, and remove preset account types.
- Rename the "CLIProxy" route so the OpenAI-compatible API is the obvious default even when DSH is also configured. Today, if `DSH_*` is fully set and you have not picked a route, generation prefers DSH.
- A small local launcher, a DSH setup wizard, and interface translations.

## Layout

- App routes live in `app/`. Generation and storage live in `lib/`.
- In-app docs are Chinese markdown in `content/`, with screenshots in `public/docs-assets/`.
- Tests are `npm test` (`tsx --test tests/*.test.ts`).
