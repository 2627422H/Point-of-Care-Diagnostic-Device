import React from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Radius } from '../constants/theme';

interface Props {
  streamUrl: string;
}

// iOS WKWebView doesn't support MJPEG in <img> tags.
// Instead: fetch the stream, detect JPEG frame boundaries (FF D8 / FF D9),
// convert each frame to a base64 data URL, and draw it to a canvas.
const viewerHtml = (url: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html, body { margin:0; padding:0; background:#000; overflow:hidden; width:100%; height:100%; }
    canvas { display:block; width:100vw; height:100vh; object-fit:contain; }
  </style>
</head>
<body>
<canvas id="c"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');

function uint8ToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function showFrame(jpeg) {
  const img = new Image();
  img.onload = function() {
    const dpr = window.devicePixelRatio || 1;
    const w   = window.innerWidth  * dpr;
    const h   = window.innerHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }
    // Letterbox: preserve aspect ratio
    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dx = (w - img.naturalWidth  * scale) / 2;
    const dy = (h - img.naturalHeight * scale) / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, dx, dy, img.naturalWidth * scale, img.naturalHeight * scale);
  };
  img.src = 'data:image/jpeg;base64,' + uint8ToBase64(jpeg);
}

async function startStream() {
  try {
    const res    = await fetch('${url}');
    const reader = res.body.getReader();
    let buf = new Uint8Array(0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;

      // Locate complete JPEG: starts FF D8, ends FF D9
      let s = -1;
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0xFF && buf[i+1] === 0xD8) { s = i; break; }
      }
      let e = -1;
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i-1] === 0xFF && buf[i] === 0xD9) { e = i; break; }
      }

      if (s !== -1 && e !== -1 && e > s) {
        showFrame(buf.slice(s, e + 1));
        buf = buf.slice(e + 1);
      }
    }
  } catch (err) {
    // Stream ended or connection lost — leave last frame on screen.
  }
}

startStream();
</script>
</body>
</html>`;

export default function LiveCamera({ streamUrl }: Props) {
  return (
    <View style={styles.container}>
      <WebView
        source={{ html: viewerHtml(streamUrl) }}
        style={styles.webview}
        originWhitelist={['*']}
        mixedContentMode="always"
        javaScriptEnabled
        scrollEnabled={false}
        bounces={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    height: 240,
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
});
