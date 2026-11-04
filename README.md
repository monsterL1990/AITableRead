# 围读（WeiDu）

**中文** · [English](#weidu-english)

## 一句话描述

【围读】是一个通过 AI 读者审核来对写作创作流程进行优化的 AI 创作辅助工具。

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

## Windows：双击启动

1. 装 [Node.js LTS](https://nodejs.org/)（20.9 或更新；22、24、26 都行）。安装包里带 npm。
2. 双击 `start.bat`。

macOS 与 Linux 使用请阅读 [安装与配置说明](SETUP.md)。

---

# WeiDu (English)

[中文](#围读weidu) · **English**

## In one sentence

WeiDu is an AI writing helper that improves the creative process by having AI readers review the work.

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

- More tokens (a single piece normally costs a dollar or two to produce)
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

## Windows: one double-click

1. Install [Node.js LTS](https://nodejs.org/) (20.9 or newer; 22, 24, or 26). The installer includes npm.
2. Double-click `start.bat`.

macOS and Linux: read the [setup guide](SETUP.md).
