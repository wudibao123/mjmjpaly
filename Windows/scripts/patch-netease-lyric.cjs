#!/usr/bin/env node
/* 网易云逐字歌词（yrc）补丁
 *
 * 背景：网易云 /api/song/lyric/v1 只有 yv=1 时才返回逐字歌词 yrc，
 *       但 NeteaseCloudMusicApi 的 module/lyric_new.js 把 yv / ytv 写死成 0，
 *       于是前端永远拿不到逐字时间戳，只能按整行时间估算。
 *
 * 因为 node_modules 不入库，这个补丁没法跟着仓库走，所以做成一次性脚本：
 *   npm install 之后执行 —— node scripts/patch-netease-lyric.cjs
 * 脚本是幂等的，重复跑不会改坏文件。
 */
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'NeteaseCloudMusicApi', 'module', 'lyric_new.js');

if (!fs.existsSync(target)) {
  console.error('找不到 NeteaseCloudMusicApi，请先执行 npm install');
  process.exit(1);
}

const before = fs.readFileSync(target, 'utf8');
let after = before
  .replace(/yv:\s*0/, 'yv: query.yv === undefined ? 1 : Number(query.yv)')
  .replace(/ytv:\s*0/, 'ytv: query.ytv === undefined ? 1 : Number(query.ytv)');

if (after !== before) {
  after = after.replace(/yv:\s*0,/, 'yv: query.yv === undefined ? 1 : Number(query.yv),')
    .replace(/ytv:\s*0,/, 'ytv: query.ytv === undefined ? 1 : Number(query.ytv),');
}

if (after === before) {
  console.log('[ok] 已是打过补丁的版本，无需修改');
  process.exit(0);
}

fs.writeFileSync(target, after, 'utf8');
console.log('[ok] 已写入逐字歌词补丁：', target);
