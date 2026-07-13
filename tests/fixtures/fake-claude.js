#!/usr/bin/env node
'use strict';
// Fake engine CLI for UNIT TESTS ONLY — G2/G3/G4 gates always call the real `claude` CLI.
// Behavior selected via FAKE_CLAUDE_MODE: ok | hang | bad-json | null-json | big-zh | error-result | fail-once | wizard | wizard-badiv | iv-recover
// 'wizard' answers all three wizard prompts (detected from stdin) with valid canned payloads.
// 'iv-recover' returns an invalid interview on the first draw, a valid one on the resample (marker-gated).
const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (mode === 'ok') {
    process.stdout.write(JSON.stringify({
      type: 'result', is_error: false, result: `ECHO:${input.length}`,
      total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 5 },
    }));
    process.exit(0);
  }
  if (mode === 'hang') {
    setTimeout(() => process.exit(0), 60000);
    return;
  }
  if (mode === 'bad-json') {
    process.stdout.write('this is not json');
    process.exit(0);
  }
  if (mode === 'null-json') {
    process.stdout.write('null');
    process.exit(0);
  }
  if (mode === 'big-zh') {
    // >64KB of multibyte text: exercises utf8 decoding across pipe-chunk boundaries.
    // exit only in the write callback — bare process.exit() truncates large pipe writes
    process.stdout.write(JSON.stringify({
      type: 'result', is_error: false, result: '汉字测试'.repeat(30000),
      total_cost_usd: 0.003, usage: { input_tokens: 1, output_tokens: 1 },
    }), () => process.exit(0));
    return;
  }
  if (mode === 'error-result') {
    process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'boom' }));
    process.exit(0);
  }
  if (mode === 'fail-once') {
    const fs = require('fs');
    const marker = process.env.FAKE_CLAUDE_MARKER;
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, '1');
      process.stderr.write('transient failure');
      process.exit(1);
    }
    process.stdout.write(JSON.stringify({
      type: 'result', is_error: false, result: 'second-try',
      total_cost_usd: 0.002, usage: { input_tokens: 1, output_tokens: 1 },
    }));
    process.exit(0);
  }
  if (mode === 'wizard-badiv') {
    // interview whose questions don't end with question marks → server must reject + persist raw
    process.stdout.write(JSON.stringify({
      type: 'result', is_error: false,
      result: JSON.stringify({ questions: Array.from({ length: 6 }, (_, i) => (
        { question: `这是第${i + 1}个陈述句。`, choices: ['一', '二', '三'] })) }),
      total_cost_usd: 0.002, usage: { input_tokens: 1, output_tokens: 1 },
    }), () => process.exit(0));
    return;
  }
  if (mode === 'iv-recover') {
    // interview: first draw invalid (statement), resample draws valid → engineStep must recover
    const fs = require('fs');
    const marker = process.env.FAKE_CLAUDE_MARKER;
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, '1');
      process.stdout.write(JSON.stringify({
        type: 'result', is_error: false,
        result: JSON.stringify({ questions: Array.from({ length: 6 }, (_, i) => (
          { question: `第${i + 1}个陈述句没有问号。`, choices: ['一', '二'] })) }),
        total_cost_usd: 0.002, usage: { input_tokens: 1, output_tokens: 1 },
      }), () => process.exit(0));
      return;
    }
    process.stdout.write(JSON.stringify({
      type: 'result', is_error: false,
      result: JSON.stringify({ questions: Array.from({ length: 6 }, (_, i) => (
        { question: `第${i + 1}个问题给谁用的？`, choices: ['自己', '家人'] })) }),
      total_cost_usd: 0.002, usage: { input_tokens: 1, output_tokens: 1 },
    }), () => process.exit(0));
    return;
  }
  if (mode === 'wizard') {
    const ok = (payload) => {
      process.stdout.write(JSON.stringify({
        type: 'result', is_error: false, result: payload,
        total_cost_usd: 0.002, usage: { input_tokens: 100, output_tokens: 200 },
      }), () => process.exit(0));
    };
    if (input.includes('{"questions"')) {
      return ok(JSON.stringify({ questions: [
        { question: '这个小东西主要是给谁用的?', choices: ['就我自己', '我和家人', '街坊邻居都能用'] },
        { question: '你最想记下来的是什么?', choices: ['花了多少钱', '吃了什么', '去了哪里'] },
        { question: '你最想一眼看到什么?', choices: ['这个月的总数', '最近几笔', '好看的小图'] },
        { question: '平时你会在什么时候用它?', choices: ['早上', '晚上睡前', '想起来就用'] },
        { question: '你喜欢什么样的感觉?', choices: ['清清爽爽', '热热闹闹', '温温柔柔'] },
        { question: '还有什么特别想要的吗?', choices: ['没有了', '要能分门别类', '要能提个醒'] },
      ] }));
    }
    if (input.includes('{"options"')) {
      return ok(JSON.stringify({ options: [
        { title: '只在自己手机上用的小账本', what_you_get: ['随手记一笔花销', '每月自动算出总数', '按吃饭交通分门别类'], what_you_dont_get: ['别人看不到,也没法一起记', '换了手机东西不会跟过去'], effort_cost: '几乎不费劲,不花钱', best_if: '就自己一个人安安静静记' },
        { title: '大家一起填的共享账页', what_you_get: ['全家人都能往里添', '谁花的钱写得清清楚楚', '月底一起看汇总'], what_you_dont_get: ['没法拍照存小票', '离了网就用不了'], effort_cost: '要花点心思拉人进来,小几十块一年', best_if: '一家人搭伙过日子,想把账算清楚' },
        { title: '拍张照就算记完的懒人版', what_you_get: ['对着小票拍一下就行', '照片按日子排好', '翻起来像相册一样'], what_you_dont_get: ['不会自动算总数', '找某一笔要靠翻'], effort_cost: '上手最快,基本不花钱', best_if: '嫌打字麻烦、就想留个底' },
      ] }));
    }
    if (input.includes('<!DOCTYPE html>')) {
      return ok(`<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>我的小账本</title>
<style>body{font-family:sans-serif;margin:2rem}li{margin:.3rem 0}</style></head>
<body><h1>我的小账本</h1><p>今天花了多少钱,记一笔:</p>
<input id="amt" placeholder="金额(元)"><button id="add">记下</button>
<ul id="list"><li>买菜 12 元</li><li>坐车 4 元</li><li>早饭 6 元</li></ul>
<p>合计:<span id="sum">22</span> 元</p>
<script>
var k='demo_ledger';
document.getElementById('add').onclick=function(){
  var v=document.getElementById('amt').value;
  if(!v)return;
  var li=document.createElement('li');li.textContent='新的一笔 '+v+' 元';
  document.getElementById('list').appendChild(li);
  localStorage.setItem(k,v);
};
</script></body></html>`);
    }
    process.stderr.write('wizard fake: unrecognized prompt');
    process.exit(1);
  }
  process.exit(1);
});
