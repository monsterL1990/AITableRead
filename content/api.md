# API 配置

在顶部设置界面需要配置你使用的 API 信息。本机推荐填自定义 OpenAI 兼容接口（接口地址、API Key、模型），或在 `.env` 里填写 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`。两项都空着时页面仍能打开，并提示你去配置 API，不会因此崩溃。

![图7：API 设置](/docs-assets/fig7-api.png)

**DSH + purge 选项**：选择该选项后，出字速度可能会变慢。但是可以一定程度上解除一些模型限制。若不选择该选项则是直接和对应模型对话。
