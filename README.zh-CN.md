# 围读（WeiDu）

围读是跑在你自己机器上的 AI 小说工作流：一节一节地写，再交给 AI 读者看，按意见改。仓库名是 [AITableRead](https://github.com/monsterL1990/AITableRead)。产品名仍是围读。

这一版按**一个人、一台机器**来用。推荐接你自己的 OpenAI 兼容接口：写在 `.env` 的 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`，或在设置里保存「自定义 OpenAI 兼容接口」。两项都空着时页面仍会打开，并提示「请先配置 API」，生成停在可编辑的演示稿，不会崩溃。

自建 DSH 不是默认。三项 `DSH_*` 留空即可。若三项都填了、设置里又没选过路由，出字仍会先走 DSH。DSH 上装什么插件是你自己的事，围读不要求 purge，也不附带插件。

## Windows：双击启动

1. 安装 [Node.js LTS](https://nodejs.org/)（20.9 或更新；22、24、26 都可以）。安装包里带 npm。
2. 双击 `start.bat`。

脚本会检查 Node。没装、或不是可用的 LTS 时，窗口会留下说明，不会一闪而过。没有 `.env` 时会从 `.env.example` 复制一份。需要时执行 `npm install`。然后启动和 `npm run dev` 相同的服务，并打开 http://127.0.0.1:4721 。

用账号 `local` 登录。刚复制的 `.env` 里口令是 `replace-with-a-password`，改 `APP_PASSWORD` 即可。开发环境把两个口令都清空时才是 `changeme`，生产环境不会退回这个口令。

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

账号页和预设 Grok / 预设 DeepSeek 还留在代码里，不是本机的默认用法。设置里原先叫「CLIProxy」的那一条，现在是「OpenAI 兼容接口（.env，推荐）」，不是要另装的代理。
