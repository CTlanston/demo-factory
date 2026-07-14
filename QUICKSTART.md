# QUICKSTART — 5 分钟到第一个 demo

## 需要什么 / Prerequisites

1. **Node.js ≥ 20**(`node --version` 检查)
2. **Claude CLI 已安装并登录**(引擎;本项目不自带模型):
   ```bash
   # 安装见 https://claude.com/claude-code ,装好后登录一次:
   claude
   # 验证可用:
   claude -p "说:好了" --model claude-haiku-4-5-20251001
   ```

## 启动 / Start

最快的一行(不用 clone):

```bash
npx github:CTlanston/demo-factory
# → demo-factory 已启动 → http://localhost:3210
```

或者 clone 后启动:

```bash
git clone https://github.com/CTlanston/demo-factory.git && cd demo-factory
npm start
```

只在你自己的电脑上可访问(只监听 127.0.0.1);会话是本机 `sessions/` 里的 JSON 文件,只保留最近 200 个。macOS / Linux 直接可用;Windows:单元测试与打桩端到端在 CI 的 Windows 上验证,但真实引擎路径还没在 Windows 真机上验证过——遇到问题请开 issue。

没有 `npm install` 这一步——产品零运行时依赖。(`npm test` 也不需要装任何东西;只有跑真实端到端测试 `personas/runner.js` 才需要 `npm install` 装 puppeteer-core。)

## 第一个 demo / Your first demo

1. 打开 `http://localhost:3210`
2. 在框里输入一句话,比如:**我想记一下每天花了多少钱**(右上角可切换 English)
3. 回答几个小问题 → 在 3 个做法里挑一个 → 等 2-5 分钟
4. 页面里直接试用,点 **下载代码(归你)** 拿走 zip(demo.html + 说明)——双击 demo.html 随时能用,不用联网

**成本提示**:每个 demo 走 3 次真实模型调用,约 **$0.4-0.6**(计入你的 Claude 账号用量);访谈/选项用轻量模型,demo 由完整模型构建。

## 常见问题 / Troubleshooting

- **"刚才没成功"** —— 点"再试一次"通常就好;还不行就看终端里 server 的输出。
- **构建很慢** —— 完整模型构建通常 1-4 分钟,页面上有计时,别关窗口。
- **换模型** —— 环境变量:`DEMO_FACTORY_MODEL`(访谈/选项)、`DEMO_FACTORY_BUILD_MODEL`(构建)。
- **跑测试** —— `npm install && npm test`(43 个测试,引擎用本地假桩,不花钱);
  真实端到端:`node personas/runner.js --personas jz1 --seeds 1`(花真钱,见 EVIDENCE.md)。
