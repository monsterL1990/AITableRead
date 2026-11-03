# 围读（WeiDu）

围读是跑在你自己机器上的 AI 小说工作流：一节一节地写，再交给 AI 读者看，按意见改。仓库名是 [AITableRead](https://github.com/monsterL1990/AITableRead)。产品名仍是围读。

这一版按**一个人、一台机器**来用。默认接你自己的 OpenAI 兼容接口（`OPENAI_BASE_URL` 和 `OPENAI_API_KEY`）。两项都空着时是演示稿，不会去打模型。自建 DSH 是以后的可选项，三项 `DSH_*` 留空即可。DSH 上装什么插件是你自己的事，围读不要求 purge，也不附带插件。

本地：

```bash
cp .env.example .env.local
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:4721 ，用账号 `local` 和 `APP_PASSWORD` 登录。开发环境没设口令时是 `changeme`，生产环境不会退回这个口令。

英文说明和许可证见 [README.md](README.md) 与 [LICENSE](LICENSE)（MIT，copyright 2026 monsterL1990）。

账号页和预设 Grok / 预设 DeepSeek 还留在代码里，不是本机的默认用法。P1 再收成单一本地用户，并改掉界面上的「CLIProxy」叫法。
