const { weapi } = require('D:/我的作品/node_modules/NeteaseCloudMusicApi/util/crypto.js');
const form = weapi({});
console.log('PARAMS=' + form.params);
console.log('ENCSECKEY=' + form.encSecKey);