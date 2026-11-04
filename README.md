# 围读（WeiDu）

**中文** · [English](#weidu-english)

---

## 【围读】的核心特点

相比目前市面上的绝大部分 AI 辅助写作的 DSH 插件和工作流，【围读】的核心特点其实基本可以用一个词来概括。那就是 **AI 读者**。

简单来说，在大家都会的那套流程——把你的想法让 AI 优化成大纲、大纲让 AI 优化成成稿、成稿让 AI 润色——出结果之后，你可以设置一些 **AI 读者**，只针对这个结果阅读审阅、提出意见。然后这些意见可以一键让 AI 根据意见重新优化生成。从而让作品得到大幅优化，让不擅长写文的小模型也能把文写得多少能看。

你可以自由设置、甚至一句话生成你想要的 AI 读者，也可以围观 AI 读者的意见，甚至自己提意见、跟读者讨论修改意见。通过这个工作流，真正达到你和很多“性格各异”的 AI 读者一起围读作品的感觉。

其实作品围读一直是很多写作创作者都经历过的一环。对很多创作者来说，作品围读都是能实打实地提升作品质量的活动。而现在，我把这个形式，通过全 AI 的方案，带到了你面前。

## 【围读】的优势与劣势

**优势**

- 更优质的最终产出成果
- 更丰富、更可控、可记录的创作过程优化
- 极大提升本不擅长写作的小模型的创作能力
- 可以接你自己搭建的 DSH，带什么插件功能、开到什么程度，都由你自由设定

**劣势**

- 消耗更多的 token（一篇文正常产出，花掉一两块钱很正常）
- 消耗更多的时间（来回审核确认花上一小时很常见；写一篇一两万字的文也要十几分钟，多个读者阅读又要几分钟）
- 操作相对复杂一点点（建议先读本说明）

## 起因·经过·结果

事情的起因，自然是关于 AI 写作的痛点：作为一个今年开始经常接触 AI 辅助写作的用户，从今年下半年开始，我能感觉到大量 AI 厂商把目光转向 AI 编程这类更工科、更技术、更执行的方向之后，AI 写作这个方向的进展似乎完全停滞了，甚至倒退。各种新模型吹嘘的算力越来越高，但写作能力并没有显著增长，尤其是小模型执行写作任务时，越来越多地更加简洁、更加缺斤少两。这让 AI 写作面临的困境前所未有地艰巨。

与此同时，在尝试新时代 AI 写作的各种方法（包括 DSH、酒馆、grok bot 等等）、试图找出破解这一困境的方案时，我发现了一个华点：相同的模型（grok4.7），通过 dsh 生文和通过 grok bot 生文，产出的内容质量有明显差距。而 grok bot 给我的答案是：因为 dsh（或者说直接让模型产出）生文是直接生成一个作品，但 grok bot 生文的过程中会有一个自我校对、审核、润色的环节，所以质量可以直接有显著提升。

得到这个结论之后，我尝试创建多个 grok bot，比如一个写手 bot、三个不同风格来提意见的读者 bot，然后拉了个 bot 群聊，让写手 bot 写完文之后 3 个 bot 锐评，评完写手 bot 再改，直到大家没有意见为止。最后产出的效果我自己认为还是比较厉害的，至少完爆了之前纯 DSH 生文的效果。

然后我就忽然意识到：这个思路，是不是可以不用非得用现在的 bot？A 窗口写作 → B 窗口审阅 → 返回 A 窗口修改，本质其实就是这件事吧？那按说现在 DSH 也可以做到啊——

于是，基于 grok bot 带给我的思路和灵感，这个「围读·AI 写作围读工作流」就这么诞生了。

---

## 围读是什么

围读是跑在你自己机器上的 AI 小说工作流：一节一节地写，再把这一节交给 AI 读者审阅。版本、笔记、下一步改什么，都留在你手里。

产品名是围读（WeiDu），仓库是 [AITableRead](https://github.com/monsterL1990/AITableRead)。

这一版按**一个人、一台机器**来用。你自己运行它，指向你自己控制的 API，稿子留在磁盘上。

MIT 许可证，版权 2026 monsterL1990。

## 怎么用它

1. 想法到大纲
2. 大纲到初稿
3. 初稿到润色

每一步都能重来。读者审阅是可选的。结构化检查会拿稿子跟大纲、目标字数比一遍。

没配模型时，稿房照样打开。横幅提示你去配置 API。写作按钮返回可编辑的中文占位稿，好让你把三步都走一遍。空 Key 不会让界面崩掉。

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

## Windows：双击启动

1. 装 [Node.js LTS](https://nodejs.org/)（20.9 或更新；22、24、26 都行）。安装包里带 npm。
2. 双击 `start.bat`。

`start.bat` 会跑 `start.ps1`。两个一起做这几件事：

- Node.js 没装、或不是支持的 LTS 版本时，说一句明确的话就停（窗口留着，不会一闪而过）
- 缺 `.env` 时从 `.env.example` 建一份
- `node_modules` 不在、或比 `package-lock.json` 旧时跑一遍 `npm install`
- 起一个和 `npm run dev` 相同的服务
- 端口通了之后，用浏览器打开 http://127.0.0.1:4721

稿房打开不用登录，只听 `127.0.0.1`。

喜欢 PowerShell 的话，`start.ps1` 是同一套步骤。设 `WEIDU_NO_BROWSER=1` 可以不自动开浏览器。

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

# WeiDu (English)

[中文](#围读weidu) · **English**

## The core idea: AI readers

Compared with most AI-assisted writing DSH plugins and workflows on the market, WeiDu's core idea comes down to one word: **AI readers**.

The usual pipeline is the same as everyone else's. Your idea goes to the model and comes back as an outline; the outline comes back as a draft; the draft comes back polished. What WeiDu adds happens after that result exists: you set up **AI readers** who read only that result and give opinions. Then one click sends those opinions back to the model to regenerate. The work gets substantially better, and a small model that is bad at writing can still turn out something readable.

You can define your readers yourself, even generate one from a single sentence. You can watch what they say, add your own opinion, or discuss a change with them. That is what this workflow is for: you and a roomful of AI readers with different personalities, reading the work around the same table.

A table read is something most writers have been through, and for most of them it genuinely improves the work. What this project does is bring that format to you entirely through AI.

## Strengths and weaknesses

**Pros**

- A better final result
- A richer writing process that is controllable and recorded
- A large lift for small models that are not good at writing
- It runs against a DSH you host yourself, and which plugins that DSH carries, and how far they go, is yours to decide

**Cons**

- More tokens (a piece run through a cheap model such as DeepSeek costs a dollar or two, which is normal)
- More time (an hour of back-and-forth review is normal; a 10,000–20,000 word piece takes a dozen minutes to write, and several readers take a few more minutes to read it)
- Slightly more operations than a one-click generator (read this document first)

## Origin, process, result

It starts with a pain point about AI writing. As someone who began using AI to help write through this year, from the second half of it I could feel that once the big labs turned their attention to AI coding and other more engineering-heavy directions, progress in AI writing had stalled, or even gone backwards. Every new model advertises more compute, but writing ability has not grown noticeably, and small models doing writing tasks come back thinner and thinner. The difficulty facing AI writing has never been greater.

While trying the various methods of this era (DSH, SillyTavern, grok bot and others) to find a way out, I hit one observation: the same model (grok4.7) produced noticeably different quality through dsh than through grok bot. grok bot's answer was that dsh, or asking a model for a piece directly, generates the work in one pass, while grok bot has a step where it checks, reviews and polishes its own output, so quality jumps.

From there I built several grok bots: one writer bot, three reader bots with different tastes, and a group chat for them. The writer finished a piece, the three readers tore into it, the writer revised, and this repeated until nobody had anything left to say. I think the result was genuinely strong, at least well past what plain DSH generated.

Then it hit me: this does not need to be bots. Write in window A, review in window B, go back to window A to revise — that is the whole mechanism, and DSH can already do it.

That idea, borrowed from grok bot, is how WeiDu — the AI table-read workflow — came to exist.

---

## What WeiDu is

WeiDu is a local AI workflow for writing a novel one section at a time, then passing that section to AI readers who review it. You keep the versions, the notes, and the decision about what to change next.

The product name is 围读 (WeiDu). This repository is [AITableRead](https://github.com/monsterL1990/AITableRead).

This tree is meant for **one person on one machine**. You run it yourself, point it at an API you control, and keep the manuscript on disk.

Licensed under the [MIT License](LICENSE). Copyright 2026 monsterL1990.

## What you do with it

1. Idea to outline
2. Outline to draft
3. Draft to polish

Each step can be regenerated. Reader reviews are optional. A structural check can compare the draft with the outline and the word-count target.

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
3. Paste the DSH launch token. It is not a model API key. `npx @deepseek-ai/dsh web` prints a line like `dsh web: http://127.0.0.1:3080/?token=…`. The value after `token=` is what the wizard wants; the rest of that URL is the base URL. You can paste the whole line into the token field. The token changes every time `dsh web` starts, so a closed terminal means starting it again. Current DSH (0.2.x) exchanges that token at `GET /connect`. 0.1.7 does not serve `/connect` (404) and exchanges it at `GET /?token=` instead. WeiDu tries `/connect` first and, only on 404, the printed URL. If the server asks for HTTP Basic Auth, fill the username and password separately. **测试连接** checks the kernel and creates a dedicated session. It also loads the model catalog when the kernel allows it.
4. WeiDu saves the session it just created. You do not pick an existing chat, and a DSH with zero sessions still works. The saved line under **经 DSH（可选）** shows the base URL and a masked token. It does not show the session id. You can optionally pick a model when the catalog loads; a missing catalog does not block save. **高级** can paste or choose a session if later turns should copy that session's agent preset. The collapsed label then says a template session is pinned, and the raw id stays inside that field. **重新连接 DSH** uses the saved address and token again. If that session is still on the kernel, WeiDu keeps it. If it is gone, WeiDu creates a new dedicated session and does not switch to some other existing chat. The button and the toast do not show the id. **更改地址或令牌** opens the wizard. The success text says plugins are installed by you inside that DSH. WeiDu does not require a purge plugin, does not ship one, and does not install one for you.

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

The desk opens with no login. It listens on `127.0.0.1` only.

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
