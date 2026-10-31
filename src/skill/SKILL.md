---
name: dsh-adaptive-learn
description: 遇到没有现成材料、需要查网页或看图片/视频/听音频才能解决的问题时使用。
---

# 自适应学习

当问题依赖**你没有的、会变的事实**（某个库的最新 API、一份文档、一张截图、一段会议录音）时，按下面的顺序做，不要凭记忆作答。

## 流程

1. **先查已有知识**：`self_learn_wiki_recall`。命中就直接用命中的结论，并把它当成已有材料。
2. **读网页**：`self_learn_fetch`。只引用你**实际打开过**的链接；提取失败就换一个来源，不要编造页面内容。
3. **看图片/视频**：`self_learn_vision`。插件内部会自动选本地 OCR 或云端视觉模型，你不要预设走哪条路。
   - 返回 `vision_api_key_missing` 时，把 `userActionRequired` 和 `freeOptions` 原样转述给用户，等用户配置后再继续。
4. **听音频**：`self_learn_audio`。短音频会走本地转写，长音频直接走云端（插件自己判断，不要劝用户切路径）。
   - 返回 `audio_api_key_missing` 时，同样把 `userActionRequired` 和 `freeOptions` 转述给用户。
5. **视频**：走 `self_learn_vision`；密钥缺失时提示用户，或建议用户自己抽几帧关键画面当图片发来。
6. **写草稿**：把结论和来源用 `self_learn_wiki_stage` 写进 staged。来源必须写清楚 `type`（web/image/video/audio）、`ref`、`engine`。
7. **回到原任务**：用刚学到的内容继续回答。确认有效后调用 `self_learn_wiki_commit` 升入正式知识库；如果发现结论不对，回到第 2 步重查，**最多 3 轮**。

## 硬性禁止

- 凭记忆回答可变事实。
- 引用没有打开过的链接。
- 查完不写（不调用 `self_learn_wiki_stage`）。
- 把本地文件路径当成"已经读过的证据"。
- 密钥缺失时猜测图片/音频里的内容。
- 本地推理失败（`available: false`）时假装成功。
