# 围读 · 安装与配置说明

本文件是 [README.md](README.md) 里放不下的细节：怎么接模型、macOS 和 Linux 怎么起、数据存在哪、怎么验证装好了。只想快点用起来的话，看 README 的「Windows：双击启动」就够了。

## 配置它

一键脚本在缺 `.env` 时会从 `.env.example` 复制一份。手动启动就自己复制。这个文件别提交进仓库。`npm run dev` 也会读 `.env.local`（你自己建的话），那个文件会覆盖 `.env`。

要让模型真出字，推荐走**自定义 OpenAI 兼容接口**：

```bash
OPENAI_BASE_URL=https://api.example.com/v1
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-model
```

同样这三个值也可以填在设置里的 **自定义 OpenAI 兼容接口**，再点 **保存并用于出字**。这份保存在 `data/store.json`，已列进 gitignore。Key 留在这台机器上。

URL 和 Key 都空着，程序也不会挂。首页会写 **请先配置 API**，并给一个去设置的入口。

**可选：** 自建的 [DSH](https://github.com/deepseek-ai/DeepSeek-Harness)（DeepSeek Harness）。设置里选 **经 DSH（可选）** 或 **连接 DSH**。向导是四张卡：

1. 问你是不是已经有本地或自建的 DSH。没有就把你送回自定义 OpenAI 兼容接口。
2. 粘贴你用来打开 DSH 的浏览器地址。围读把 origin 留作 Base URL。**探测常见本机端口** 会在 `127.0.0.1` 上试 `3080`、`3081`、`3099`（可用 `DSH_PROBE_PORTS` 覆盖）。`npx @deepseek-ai/dsh web` 印出来的是 `3080`。没人应的端口就是没命中，页面不会一直等。
3. 粘贴 DSH 启动令牌。它不是模型的 API Key。`npx @deepseek-ai/dsh web` 会印一行 `dsh web: http://127.0.0.1:3080/?token=…`，`token=` 后面那段就是向导要的值，这行 URL 剩下的部分是 Base URL。整行粘进令牌框也行。每次 `dsh web` 启动令牌都会变，终端关了就得重开。现在的 DSH（0.2.x）在 `GET /connect` 兑换令牌；0.1.7 没有 `/connect`（404），改在 `GET /?token=` 兑换。围读先试 `/connect`，只有 404 才回退到印出来的地址。服务器要 HTTP Basic Auth 的话，用户名和密码分开填。**测试连接** 会检查内核并新建一个专用会话；内核允许时也会顺手拉一次模型列表。
4. 围读保存它刚建好的会话。你不用挑已有对话，一个会话都没有的 DSH 也能用。**经 DSH（可选）** 下面那一行只显示 Base URL 和打码的令牌，不显示会话 id。模型列表拉得到时可选一个模型，拉不到也不挡保存。**高级** 里可以粘或选一个会话，让之后的回合继承那个会话的 agentPreset；折叠后的标题会写成「高级：已指定模板会话」，原始 id 只留在那个输入框里。**重新连接 DSH** 会沿用已保存的地址和令牌：会话还在内核上就继续用，没了就新建一个专用会话，不会改用别的已有对话；按钮和提示里都不出现 id。**更改地址或令牌** 会重开向导。成功文案会说明插件要你自己在那台 DSH 里装——围读不要求 purge 插件，不附带，也不会替你装。

也可以在 `.env` 里写 `DSH_BASE_URL`、`DSH_TOKEN`、`DSH_SESSION_ID` 代替向导。可选的 `DSH_BASIC_USER` 和 `DSH_BASIC_PASSWORD` 只给挡了 Basic Auth 的前端用。向导保存过的连接会覆盖这三个 `DSH_*` 值。模板会话带 agentPreset 的话，新回合会复制那份预设，就这样。

DSH 配齐了（向导或 `.env`）、设置里又没选过路由时，出字仍会优先走 DSH。那不是本机默认。留空别选，或者在设置里选 **OpenAI 兼容接口（.env，推荐）**。

这个仓库里没有托管的围读服务，默认配置也不指向任何一个。

## macOS 与 Linux

```bash
chmod +x start.sh   # 一次就够
./start.sh
```

或者不用脚本：

```bash
cp .env.example .env   # 已经有 .env 就跳过
npm install
npm run dev
```

打开 [http://127.0.0.1:4721](http://127.0.0.1:4721)。用这个地址，开发服务器只认 `localhost` 和 `127.0.0.1`。

```bash
npm test
npm run lint
npm run build
npm run start
```

页眉上的 **中文 / English** 会立刻换界面，并把选择写进 `data/store.json` 的 `locale`。没选过时，`WEIDU_LOCALE=zh` 或 `en` 盖过浏览器语言；都没有的话，浏览器偏好英语才用英语，否则中文。

`npm run dev` 和 `npm run start` 监听 **127.0.0.1** 的 **4721** 端口。Next.js 自己默认是 `0.0.0.0`，这两个脚本传了 `--hostname`，所以正常启动不会。只有你确实想接受别的机器连过来时，才在环境变量、`.env.local` 或 `.env` 里设 `WEIDU_HOST=0.0.0.0`。shell 里的值优先于文件。`PORT` 改端口。`HOSTNAME` 不决定监听地址。

程序跑着的时候可以查绑定：

```bash
# Windows
netstat -ano | findstr 4721
# macOS 或 Linux
ss -ltnp | grep 4721
```

应该看到 `127.0.0.1:4721`，不是 `0.0.0.0:4721`。

Docker，还是一台机器，变量写在 compose 文件旁边的 `.env` 里：

```bash
cp .env.example .env
docker compose up -d --build
```

容器里监听 `0.0.0.0` 的 3000 端口，compose 把它发布到 4721。这个绑定是 `docker-entrypoint.sh` 里显式写的，好让发布出来的端口能进到进程。它不是本机默认。稿子在 `weidu-data` 这个卷里（`/app/data/store.json`）。

## 数据与清空

稿子、读者、提示词、设置里保存的 API Key 都在 `./data`：

- `data/store.json` — 稿子和保存的自定义 API

`./data` 已列进 gitignore。第一次写入时程序会自己建这个目录。目录不存在不影响启动。

要清空这台机器上的稿房：停掉围读，删掉 `data` 文件夹，再启动。下次会新建一个空稿库。删 `data` 不会动 `.env`。

## 怎么验证

在一台装了 Node.js LTS 的机器上：

```bash
npm install
npm test
npm run dev
```

另开一个终端，`ss -ltnp | grep 4721`（Windows 上是 `netstat -ano | findstr 4721`）应该显示 `127.0.0.1:4721`。打开 http://127.0.0.1:4721。没有登录页，`/login` 会把你送回稿房。`OPENAI_BASE_URL` 和 `OPENAI_API_KEY` 空着时，首页显示 **请先配置 API**。`GET /api/config` 返回 `demoMode: true`，进程照常跑着。

在 Windows 上，双击 `start.bat` 代替 `npm run dev`。它应该按需装依赖、按需建 `.env`、打开同一个地址。把 `node` 从 `PATH` 里挪走（或者在一台没装 Node 的机器上跑），窗口应该说 Node.js LTS 没装，然后停下来等你看。

`WEIDU_HOST=0.0.0.0 npm run dev` 是显式覆盖，应该显示 `0.0.0.0:4721`。

## 以后再做

这次改动里还没有的：

- 界面多语言。
- DSH 配齐、又没存路由时，出字仍会优先走 DSH。本机推荐的做法是留空。

## 目录结构

- 应用路由在 `app/`，生成和存储在 `lib/`。
- `scripts/serve.mjs` 把 Next.js 起在上面那个回环地址上。
- 站内文档是 `content/` 里的中文 markdown，配图在 `public/docs-assets/`。
- 测试是 `npm test`（`tsx --test tests/*.test.ts`）。

---

# WeiDu: setup and configuration

This file holds the detail that does not belong on the project front page: how to point WeiDu at a model, starting it on macOS and Linux, where data lives, and how to check an install.

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
3. Paste the DSH launch token. It is not a model API key. `npx @deepseek-ai/dsh web` prints a line like `dsh web: http://127.0.0.1:3080/?token=…`. The value after `token=` is what the wizard wants; the rest of that URL is the base URL. You can paste the whole line into the token field. The token changes every time `dsh web` starts, so a closed terminal means starting it again. Current DSH (0.2.x) exchanges that token at `GET /connect`. 0.1.7 does not serve `/connect` (404) and exchanges it at `GET /?token=` instead. WeiDu tries `/connect` first and, only on 404, the printed URL. If the server asks for HTTP Basic Auth, fill the username and password separately. **测试连接** checks the kernel and creates a dedicated session. It also loads the model catalog when the kernel allows it.
4. WeiDu saves the session it just created. You do not pick an existing chat, and a DSH with zero sessions still works. The saved line under **经 DSH（可选）** shows the base URL and a masked token. It does not show the session id. You can optionally pick a model when the catalog loads; a missing catalog does not block save. **高级** can paste or choose a session if later turns should copy that session's agent preset. The collapsed label then says a template session is pinned, and the raw id stays inside that field. **重新连接 DSH** uses the saved address and token again. If that session is still on the kernel, WeiDu keeps it. If it is gone, WeiDu creates a new dedicated session and does not switch to some other existing chat. The button and the toast do not show the id. **更改地址或令牌** opens the wizard. The success text says plugins are installed by you inside that DSH. WeiDu does not require a purge plugin, does not ship one, and does not install one for you.

You can still set `DSH_BASE_URL`, `DSH_TOKEN`, and `DSH_SESSION_ID` in `.env` instead of the wizard. Optional `DSH_BASIC_USER` and `DSH_BASIC_PASSWORD` are only for a Basic Auth front. A saved wizard connection overrides those three `DSH_*` values. If the template session has an agent preset, a new turn copies that preset. That is all.

If DSH is fully configured (wizard or `.env`) and you have not picked a route in Settings, generation still prefers DSH. That is not the local default. Leave it unset, or pick **OpenAI 兼容接口（.env，推荐）** in Settings.

There is no hosted WeiDu service in this repository, and the defaults do not point at one.

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

The **中文 / English** control in the header switches the interface immediately and writes the choice to `locale` in `data/store.json`. Before anyone chooses, `WEIDU_LOCALE=zh` or `en` overrides the browser. If that is unset too, a browser that prefers English gets English; everything else gets Chinese.

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

The container listens on `0.0.0.0` port 3000 and the compose file publishes it on 4721. That bind is explicit in `docker-entrypoint.sh` so the published port can reach the process. It is not the local default. Manuscripts are in the `weidu-data` volume (`/app/data/store.json`).

## Data and reset

Manuscripts, readers, prompts, settings, and saved API keys are files under `./data`:

- `data/store.json` — manuscripts and the saved custom API

`./data` is gitignored. The app creates the directory on the first write. A missing folder does not crash startup.

To reset this machine's desk: stop WeiDu, delete the `data` folder, and start again. The next launch creates an empty store. Deleting `data` does not change `.env`.

## How to verify

On a machine with Node.js LTS:

```bash
npm install
npm test
npm run dev
```

In another terminal, `ss -ltnp | grep 4721` (or `netstat -ano | findstr 4721` on Windows) should show `127.0.0.1:4721`. Open http://127.0.0.1:4721. There is no login page. `/login` returns you to the desk. The home page shows **请先配置 API** when `OPENAI_BASE_URL` and `OPENAI_API_KEY` are empty. `GET /api/config` returns `demoMode: true` and the process keeps running.

On Windows, double-click `start.bat` instead of `npm run dev`. It should install dependencies if needed, create `.env` if needed, and open the same URL. Rename `node` out of `PATH` (or run the script on a machine without Node) and the window should say Node.js LTS is not installed, then wait so you can read it.

`WEIDU_HOST=0.0.0.0 npm run dev` is the explicit override and should show `0.0.0.0:4721`.

## Still later

Not in this change:

- Interface translations.
- When DSH is fully set and no route is saved, generation still prefers DSH. The recommended local path is to leave it unset.

## Layout

- App routes live in `app/`. Generation and storage live in `lib/`.
- `scripts/serve.mjs` starts Next.js on the loopback address above.
- In-app docs are Chinese markdown in `content/`, with screenshots in `public/docs-assets/`.
- Tests are `npm test` (`tsx --test tests/*.test.ts`).
