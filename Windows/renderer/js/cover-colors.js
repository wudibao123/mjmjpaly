/* MJMJ · 封面取色（Folia 官方实现）
   -------------------------------------------------------------------------
   上游：
     src/utils/colorExtractor.ts   loadImagePixels / extractRepresentativeColors
     src/utils/colorPalette.ts     extractRepresentativeColorsFromPixels（加权中位切分）

   latent 背景的 colorSource 默认是 'cover-theme'，也就是说它的网点与网格颜色
   来自当前歌曲封面，不是界面主题色。这里把同一套取色搬过来，供隐现与粒子共用。

   跨域：主进程已给 music.126.net / music.163.com 补了 Access-Control-Allow-Origin，
   正常走 crossOrigin=anonymous 就能读像素；读不到时退回同源 /proxy 取图再解码。
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var QUANTIZATION_SHIFT = 4;
  var MIN_ALPHA = 128;

  function channelRange(colors, ch) {
    var min = 255, max = 0;
    for (var i = 0; i < colors.length; i++) {
      if (colors[i][ch] < min) min = colors[i][ch];
      if (colors[i][ch] > max) max = colors[i][ch];
    }
    return max - min;
  }

  function splitBucket(bucket) {
    if (bucket.colors.length < 2) return null;
    var ranges = {
      r: channelRange(bucket.colors, 'r'),
      g: channelRange(bucket.colors, 'g'),
      b: channelRange(bucket.colors, 'b')
    };
    var channel = ranges.r >= ranges.g && ranges.r >= ranges.b ? 'r' : (ranges.g >= ranges.b ? 'g' : 'b');
    var sorted = bucket.colors.slice().sort(function (a, b) { return a[channel] - b[channel]; });
    var midpoint = bucket.weight / 2;
    var acc = 0, splitIndex = 1;
    for (var i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i].weight;
      splitIndex = i + 1;
      if (acc >= midpoint) break;
    }
    var left = sorted.slice(0, splitIndex);
    var right = sorted.slice(splitIndex);
    var lw = 0, rw = 0;
    left.forEach(function (c) { lw += c.weight; });
    right.forEach(function (c) { rw += c.weight; });
    return [{ colors: left, weight: lw }, { colors: right, weight: rw }];
  }

  function averageBucket(bucket) {
    var tr = 0, tg = 0, tb = 0;
    bucket.colors.forEach(function (c) {
      tr += c.r * c.weight;
      tg += c.g * c.weight;
      tb += c.b * c.weight;
    });
    return {
      r: Math.round(tr / bucket.weight),
      g: Math.round(tg / bucket.weight),
      b: Math.round(tb / bucket.weight),
      weight: bucket.weight
    };
  }

  function toHex(c) {
    var r = Math.max(0, Math.min(255, c.r)).toString(16).padStart(2, '0');
    var g = Math.max(0, Math.min(255, c.g)).toString(16).padStart(2, '0');
    var b = Math.max(0, Math.min(255, c.b)).toString(16).padStart(2, '0');
    return '#' + r + g + b;
  }

  /* 加权中位切分：封面里占面积大的颜色权重更高，不是只挑最艳的 */
  function representative(pixels, count) {
    count = count || 5;
    if (count <= 0) return [];
    var histogram = new Map();
    for (var i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < MIN_ALPHA) continue;
      var r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      var key = ((r >> QUANTIZATION_SHIFT) << 8) | ((g >> QUANTIZATION_SHIFT) << 4) | (b >> QUANTIZATION_SHIFT);
      var cur = histogram.get(key);
      if (cur) { cur.r += r; cur.g += g; cur.b += b; cur.weight += 1; }
      else histogram.set(key, { r: r, g: g, b: b, weight: 1 });
    }

    var colors = [];
    histogram.forEach(function (c) {
      colors.push({ r: Math.round(c.r / c.weight), g: Math.round(c.g / c.weight), b: Math.round(c.b / c.weight), weight: c.weight });
    });
    if (!colors.length) return [];

    var total = 0;
    colors.forEach(function (c) { total += c.weight; });
    var buckets = [{ colors: colors, weight: total }];

    while (buckets.length < Math.min(count, colors.length)) {
      var idx = -1, best = -1;
      for (var k = 0; k < buckets.length; k++) {
        var bkt = buckets[k];
        if (bkt.colors.length < 2) continue;
        var widest = Math.max(
          channelRange(bkt.colors, 'r'),
          channelRange(bkt.colors, 'g'),
          channelRange(bkt.colors, 'b')
        );
        var score = widest * Math.sqrt(bkt.weight);
        if (score > best) { best = score; idx = k; }
      }
      if (idx < 0) break;
      var sp = splitBucket(buckets[idx]);
      if (!sp) break;
      buckets.splice(idx, 1, sp[0], sp[1]);
    }

    return buckets.map(averageBucket).sort(function (a, b) { return b.weight - a.weight; }).map(toHex);
  }

  function pixelsFromImage(img) {
    var canvas = document.createElement('canvas');
    canvas.width = 50;
    canvas.height = 50;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try {
      ctx.drawImage(img, 0, 0, 50, 50);
      return ctx.getImageData(0, 0, 50, 50).data;
    } catch (e) {
      return null;
    }
  }

  /* 缩到 50×50 读像素；跨域读不到就同源 /proxy 再取一次 */
  function loadImagePixels(url) {
    return new Promise(function (resolve) {
      if (!url) { resolve(null); return; }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(pixelsFromImage(img)); };
      img.onerror = function () { resolve(null); };
      img.src = url;
    }).then(function (px) {
      if (px) return px;
      return fetch('/proxy?url=' + encodeURIComponent(url), { credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.blob() : null; })
        .then(function (blob) { return blob ? createImageBitmap(blob) : null; })
        .then(function (bmp) { return bmp ? pixelsFromImage(bmp) : null; })
        .catch(function () { return null; });
    });
  }

  var cache = new Map();

  function extract(url, count) {
    if (!url) return Promise.resolve([]);
    var key = url + '|' + (count || 5);
    if (cache.has(key)) return cache.get(key);
    var p = loadImagePixels(url).then(function (px) {
      return px ? representative(px, count || 5) : [];
    }).catch(function () { return []; });
    cache.set(key, p);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return p;
  }

  window.MJMJCoverColors = { extract: extract, representative: representative, loadImagePixels: loadImagePixels };
})();
