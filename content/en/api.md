# API setup

On the settings screen at the top, fill in the API you use. On this machine the recommended choice is a custom OpenAI-compatible API (base URL, API key, and model), or `OPENAI_BASE_URL` and `OPENAI_API_KEY` in `.env`. If both are empty the page still opens, tells you to configure an API, and does not crash because of it.

![Figure 7: API settings](/docs-assets/fig7-api.png)

**Optional self-hosted DSH**: in Settings, open the connection wizard and paste the browser address you use to open DSH, and the token. WeiDu creates its own session. You do not pick an existing chat. When the model catalog loads, you can pick a model. The saved line shows only the address and the end of the token, not the session id. Writing is slower. You install the plugin yourself on that DSH. WeiDu does not require purge. When DSH is not connected, writing goes straight to the OpenAI-compatible API you configured.
