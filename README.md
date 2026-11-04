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

With no model configured, the desk still opens. A banner asks you to configure an API. The writing buttons return editable Chinese placeholder text so you can walk the three steps. Empty keys do not crash the UI.

## Configure it

The one-click scripts copy `.env.example` to `.env` when `.env` is missing. For a manual start, copy it yourself. Do not commit that file. `npm run dev` also reads `.env.local` if you create one; that file overrides `.env`.

The recommended way to get real prose is a **custom OpenAI-compatible API**:

```bash
OPENAI_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-model
```

You can put the same three values in Settings under **自定义 OpenAI 兼容接口** and choose **保存并用于出字**. That copy lives in `data/store.json`, which is gitignored. The key stays on this machine.

Leave the URL and key empty and the app stays up. The home page says **请先配置 API** and links to Settings.

**Optional:** a self-hosted [DSH](https://github.com/deepseek-ai/DeepSeek-Harness) (DeepSeek Harness) instance. In Settings, choose **经 DSH（可选）** or **连接 DSH**. The wizard has four cards:

1. Ask whether you already run a local or self-hosted DSH. If not, it sends you back to the custom OpenAI-compatible API.
2. Paste the browser URL you use to open DSH. WeiDu keeps the origin as the base URL. **探测常见本机端口** tries `127.0.0.1` on `3080`, `3081`, and `3099` (override with `DSH_PROBE_PORTS`). `3080` is what `npx @deepseek-ai/dsh web` prints. A port that does not answer is a miss. The page does not wait forever.
3. Paste the DSH launch token. It is not a model API key. `npx @deepseek-ai/dsh web` prints a line like `dsh web: http://127.0.0.1:3080/?token=…`. The value after `token=` is what the wizard wants; the rest of that URL is the base URL. You can paste the whole line into the token field. The token changes every time `dsh web` starts, so a closed terminal means starting it again. If the server asks for HTTP Basic Auth, fill the username and password separately. **测试连接** lists sessions and, when the kernel allows it, the model catalog.
4. Pick a session and an optional model, then save. The values stay in `data/store.json` on this machine. The success text says plugins are installed by you inside that DSH. WeiDu does not require a purge plugin, does not ship one, and does not install one for you.

You can still set `DSH_BASE_URL`, `DSH_TOKEN`, and `DSH_SESSION_ID` in `.env` instead of the wizard. Optional `DSH_BASIC_USER` and `DSH_BASIC_PASSWORD` are only for a Basic Auth front. A saved wizard connection overrides those three `DSH_*` values. If the template session has an agent preset, a new turn copies that preset. That is all.

If DSH is fully configured (wizard or `.env`) and you have not picked a route in Settings, generation still prefers DSH. That is not the local default. Leave it unset, or pick **OpenAI 兼容接口（.env，推荐）** in Settings.

There is no hosted WeiDu service in this repository, and the defaults do not point at one.

## Windows, one double-click

1. Install [Node.js LTS](https://nodejs.org/) (20.9 or newer; 22, 24, or 26). The installer includes npm.
2. Double-click `start.bat`.

`start.bat` runs `start.ps1`. Together they:

- stop with a clear message if Node.js is missing or is not a supported LTS release (the window stays open)
- create `.env` from `.env.example` when `.env` is missing
- run `npm install` when `node_modules` is missing or older than `package-lock.json`
- start the same server as `npm run dev`
- open http://127.0.0.1:4721 in your browser once that port accepts connections

The desk opens with no login. It listens on `127.0.0.1` only. Set `WEIDU_AUTH=on` in `.env` when you want `APP_PASSWORD` and the session cookie. A fresh `.env` still contains the placeholder password `replace-with-a-password`. If you clear both password variables while login is on in development, the password is `changeme`. That fallback is disabled when `NODE_ENV=production`.

`start.ps1` is the same steps if you prefer PowerShell. Set `WEIDU_NO_BROWSER=1` to skip opening a browser.

## macOS and Linux

```bash
chmod +x start.sh   # once
./start.sh
```

Or, without the script:

```bash
cp .env.example .env   # skip if .env already exists
npm install
npm run dev
```

Open [http://127.0.0.1:4721](http://127.0.0.1:4721). Use that address. The dev server allows `localhost` and `127.0.0.1`.

```bash
npm test
npm run lint
npm run build
npm run start
```

`npm run dev` and `npm run start` listen on **127.0.0.1** port **4721**. Next.js itself defaults to `0.0.0.0`; these scripts pass `--hostname` so a normal launch does not. Set `WEIDU_HOST=0.0.0.0` in the environment, `.env.local`, or `.env` only when you mean to accept connections from other machines. A shell value wins over the files. `PORT` changes the port. `HOSTNAME` is not the listen address.

Check the bind while the app is running:

```bash
# Windows
netstat -ano | findstr 4721
# macOS or Linux
ss -ltnp | grep 4721
```

You should see `127.0.0.1:4721`, not `0.0.0.0:4721`.

Docker, still one machine, with the same variables from a `.env` file next to the compose file:

```bash
cp .env.example .env
docker compose up -d --build
```

The container listens on `0.0.0.0` port 3000 and the compose file publishes it on 4721. That bind is explicit in `docker-entrypoint.sh` so the published port can reach the process. It is not the local default. The image sets `NODE_ENV=production`, so login stays on unless you set `WEIDU_AUTH=off`. Turning auth off on that published port lets anyone who can open it use the desk. Manuscripts are in the `weidu-data` volume (`/app/data/store.json`).

## Data and reset

Manuscripts, readers, prompts, settings, saved API keys, and extra accounts are files under `./data`:

- `data/store.json` — manuscripts and the saved custom API
- `data/accounts.json` — accounts other than the `local` login password (that password is `APP_PASSWORD`)

`./data` is gitignored. The app creates the directory on the first write. A missing folder does not crash startup.

To reset this machine's desk: stop WeiDu, delete the `data` folder, and start again. The next launch creates an empty store. Deleting `data` does not change `.env`.

## Single user

One person on this machine does not sign in. Requests are the `local` owner. `/login` sends you home. Manuscripts, readers, prompts, and settings stay in `data/` on this machine. The Accounts page says the account system is off, and its API refuses to create accounts.

Set `WEIDU_AUTH=on` to bring back the password, the session cookie, and the Accounts page. `APP_PASSWORD` is that password. `npm run dev` and the one-click scripts leave the switch unset, so login stays off. `npm run start` and Docker set `NODE_ENV=production`; login stays on there until you set `WEIDU_AUTH=off`.

Do not set `WEIDU_AUTH=off` if anything other than this machine can open the port. `WEIDU_HOST=0.0.0.0` and the Docker published port are that case. Auth off means the desk is whoever can reach it.

Preset Grok and preset DeepSeek account types are still in the code for the opt-in accounts page. They are not how you install WeiDu.

The environment OpenAI route used to be labeled "CLIProxy" in Settings. That label meant `OPENAI_BASE_URL`. It is not a bundled proxy. Settings now calls it **OpenAI 兼容接口（.env，推荐）**.

## How to verify

On a machine with Node.js LTS:

```bash
npm install
npm test
npm run dev
```

In another terminal, `ss -ltnp | grep 4721` (or `netstat -ano | findstr 4721` on Windows) should show `127.0.0.1:4721`. Open http://127.0.0.1:4721. There is no login page. `/login` returns you to the desk. The home page shows **请先配置 API** when `OPENAI_BASE_URL` and `OPENAI_API_KEY` are empty. `GET /api/config` returns `demoMode: true` and the process keeps running.

`WEIDU_AUTH=on npm run dev` asks for the password again. With the placeholder `.env`, that password is `replace-with-a-password` and the account is `local`.

On Windows, double-click `start.bat` instead of `npm run dev`. It should install dependencies if needed, create `.env` if needed, and open the same URL. Rename `node` out of `PATH` (or run the script on a machine without Node) and the window should say Node.js LTS is not installed, then wait so you can read it.

`WEIDU_HOST=0.0.0.0 npm run dev` is the explicit override and should show `0.0.0.0:4721`.

## Still later

Not in this change:

- Remove preset account types from the opt-in accounts page.
- When DSH is fully set and no route is saved, generation still prefers DSH. The recommended local path is to leave it unset.
- Interface translations.

## Layout

- App routes live in `app/`. Generation and storage live in `lib/`.
- `scripts/serve.mjs` starts Next.js on the loopback address above.
- In-app docs are Chinese markdown in `content/`, with screenshots in `public/docs-assets/`.
- Tests are `npm test` (`tsx --test tests/*.test.ts`).
