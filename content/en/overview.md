# Overview

## What WeiDu is for

Compared with most of the AI-assisted writing plugins and workflows you can get right now, what WeiDu is for really does come down to one word: the AI reader.

In short, after the steps everyone already does — let the AI turn your idea into an outline, the outline into a finished draft, and the draft into a polish — you can set some AI readers who only read that result and comment on it. Those comments can be sent back, in one click, for the AI to revise from. The aim is a large improvement, and to get a small model that is bad at prose to write something you can at least stand to read.

You can set the AI readers you want, freely, or generate one from a single sentence. You can also watch their comments, add your own, or discuss a revision with a reader. The workflow is meant to feel like you and a group of AI readers, each with a different temperament, sitting around the piece together.

A table read has always been a step many writers go through. For a lot of them it is one of the things that actually raises the quality of the work. What I have done is bring that form to you, done entirely with AI.

## How it started

It started, of course, from my own trouble with AI writing. I only began using AI to help me write regularly this year. From the second half of the year I could feel a lot of the labs turning their attention to AI programming and other more technical, more execution-heavy work, and the writing side seemed to stall completely, or even go backwards. New models keep advertising more and more compute, but the writing does not get clearly better. Small models, especially, come back more and more terse, and more and more thin. AI writing is in a harder spot than it has ever been.

At the same time, while I was trying the current ways of writing with AI (DSH, SillyTavern, grok bot, and so on) to find a way through that, I hit the useful point: the same model (grok 4.7) produces a clearly different quality when the text comes from DSH and when it comes from grok bot. grok bot's answer was that DSH (or asking the model to produce the text directly) generates a piece in one go, while grok bot proofreads, reviews, and polishes along the way, so the quality can jump.

After that conclusion I tried making several grok bots. One writer bot, three reader bots with different styles, then a group chat. After the writer finished, the three of them said what they thought, bluntly, and the writer revised until nobody had anything left. I thought the result was actually strong. It beat plain DSH writing by a lot.

Then it occurred to me: this idea doesn't have to be those bots. Window A writes, window B reviews, back to window A to revise. That is the whole thing, isn't it? And DSH can do that now too.

So, from the idea and the spark grok bot gave me, this WeiDu AI table-read workflow came into being.

## What WeiDu is good at, and what it costs

**Advantages**

- A better final piece
- A richer writing process, one you can control and keep a record of
- A large lift for a small model that is otherwise bad at writing

**Disadvantages**

- It spends more tokens (for one piece, produced in a 梁文谷 state, one or two yuan is normal)
- It takes more time (an hour of review and confirmation for one piece is normal; writing a piece of ten or twenty thousand characters can take ten minutes or more, and several readers take several minutes too)
- It is a little more complicated to operate (read these docs first)
