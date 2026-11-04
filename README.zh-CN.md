# 围读（WeiDu）

围读是跑在你自己机器上的 AI 小说工作流：一节一节地写，再交给 AI 读者看，按意见改。仓库名是 [AITableRead](https://github.com/monsterL1990/AITableRead)。产品名仍是围读。

这一版按**一个人、一台机器**来用。推荐接你自己的 OpenAI 兼容接口：写在 `.env` 的 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`，或在设置里保存「自定义 OpenAI 兼容接口」。两项都空着时页面仍会打开，并提示「请先配置 API」，生成停在可编辑的演示稿，不会崩溃。

自建 DSH 不是默认。设置里的「连接 DSH」向导分四步：有没有自己的 DSH、粘贴浏览器地址、填写启动令牌（需要时再填 Basic Auth）并测试连接、围读自己新建专用会话并可选模型。不用选已有对话；「高级」里才粘贴会话 id，用来继承那个会话的 agentPreset，折叠标题写成「高级：已指定模板会话」，id 只留在那个输入框里。已保存的那一行只显示地址和令牌末尾，不显示会话 id。「重新连接 DSH」沿用已保存的地址和令牌；原来的会话还在就继续用，不在就新建一个，不会改用别的已有对话，提示里也不出现会话 id。令牌不是模型的 API Key，是终端里 `npx @deepseek-ai/dsh web` 印出的 `dsh web: http://127.0.0.1:3080/?token=…` 里 `token=` 的值，每次启动都会变。0.2 在 `GET /connect` 兑换；0.1.7 没有这条路径（404），改在 `GET /?token=` 兑换。围读先试 `/connect`，只有 404 才改走启动地址。探测端口默认是 `3080,3081,3099`。也可以把 `DSH_BASE_URL`、`DSH_TOKEN`、`DSH_SESSION_ID` 写在 `.env`，向导保存的连接优先。插件要你自己装在那台 DSH 上，围读不要求 purge，也不附带插件。若 DSH 已配齐、设置里又没选过路由，出字仍会先走 DSH。

## Windows：双击启动

1. 安装 [Node.js LTS](https://nodejs.org/)（20.9 或更新；22、24、26 都可以）。安装包里带 npm。
2. 双击 `start.bat`。

脚本会检查 Node。没装、或不是可用的 LTS 时，窗口会留下说明，不会一闪而过。没有 `.env` 时会从 `.env.example` 复制一份。需要时执行 `npm install`。然后启动和 `npm run dev` 相同的服务，并打开 http://127.0.0.1:4721 。

本机打开即用，没有登录页。只听 `127.0.0.1`。要口令时在 `.env` 里设 `WEIDU_AUTH=on`，口令是 `APP_PASSWORD`（刚复制的文件里是 `replace-with-a-password`）。开发环境把两个口令都清空、又开了登录时才是 `changeme`。`npm run start` 和 Docker 是生产环境，登录默认开着，除非明确写 `WEIDU_AUTH=off`。关了登录又让别的机器能访问，稿子就暴露了。

`start.ps1` 是同一套步骤。不想自动开浏览器时设置 `WEIDU_NO_BROWSER=1`。

## macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

也可以：

```bash
cp .env.example .env
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:4721 。`npm run dev` 和 `npm run start` 默认只听 `127.0.0.1`，不是 `0.0.0.0`。要给别的机器用，再设 `WEIDU_HOST=0.0.0.0`。`HOSTNAME` 不决定监听地址。Docker 镜像在容器里显式绑定 `0.0.0.0`，这样映射出来的端口才进得去，那不是本机默认。

## 数据与清空

稿子、读者、提示词、设置里保存的 API Key、额外账号都在 `./data`（`data/store.json` 和 `data/accounts.json`）。这个目录已在 `.gitignore` 里。目录不存在不会让程序起不来。

清空这台机器上的稿房：先停掉围读，删掉 `data` 文件夹，再启动。下次会新建空稿库。删 `data` 不会改 `.env`。`local` 的登录口令仍是 `APP_PASSWORD`。

英文说明、校验方法和许可证见 [README.md](README.md) 与 [LICENSE](LICENSE)（MIT，copyright 2026 monsterL1990）。

账号页要 `WEIDU_AUTH=on` 才工作。没开时打开 `/admin` 只会看到说明，接口也不会建账号。预设 Grok / 预设 DeepSeek 仍留在那一页的代码里，不是本机的默认用法。设置里原先叫「CLIProxy」的那一条，现在是「OpenAI 兼容接口（.env，推荐）」，不是要另装的代理。
