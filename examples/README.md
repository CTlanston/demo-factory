# examples — 5 个真实生成的 demo / 5 real generated demos

每个目录都是一次完整的真实向导流程产物:一句话想法 → 无术语访谈 → 3 个选项 → 单文件 demo.html。
Each folder is the artifact of one full real wizard run: one-line idea → jargon-free interview → 3 options → single-file demo.html.

**双击任何 demo.html 就能打开,不用装任何东西。** Double-click any demo.html — nothing to install.

| # | 想法 / Idea | 用时 | 成本 |
|---|---|---|---|
| 01 | 我想记一下每天花了多少钱 | 227s | $0.48 |
| 02 | I want to track my dog's walks and meals | 391s | $0.48 |
| 03 | 想把我妈的拿手菜记下来 | 296s | $0.57 |
| 04 | 我开奶茶店想要一个能给客人看的价目表 | 360s | $0.63 |
| 05 | I always miss my friends' birthdays | 243s | $0.48 |

模型配置与产品出货配置一致:访谈和选项用轻量模型,demo 由完整模型构建(这也是每个 demo 成本的主要来源)。
Model config = the shipping config: light model for interview/options, the full model builds the demo (which is most of each demo's cost).

所有 demo 都通过了程序化检查:单文件、离线可用、无控制台报错、包含用户要求的功能。
All demos passed programmatic checks: single-file, offline, zero console errors, contain the user's must-have features.
