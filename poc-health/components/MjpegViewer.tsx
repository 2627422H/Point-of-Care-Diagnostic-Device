import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  streamUrl: string;
  onFrame?: () => void;
  onError?: (msg: string) => void;
  onStatus?: (msg: string) => void;
}

const makeHtml = (url: string) => `<!DOCTYPE html><html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; width: 100vw; height: 100vh; display: flex;
           align-items: center; justify-content: center; overflow: hidden; }
    #stream { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
  </style>
</head>
<body>
  <img id="stream" src="${url}">
<script>
var img = document.getElementById('stream');
var canvas = document.createElement('canvas');
canvas.width = 8; canvas.height = 8;
var ctx = canvas.getContext('2d');
var last = null;

function poll() {
  try {
    ctx.drawImage(img, 0, 0, 8, 8);
    var d = ctx.getImageData(0, 0, 8, 8).data;
    var h = 0;
    for (var i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0;
    if (last !== null && h !== last) window.ReactNativeWebView.postMessage('frame');
    last = h;
  } catch(e) {}
  requestAnimationFrame(poll);
}

img.onload = function() {
  window.ReactNativeWebView.postMessage('stream_ok');
  poll();
};
img.onerror = function() {
  window.ReactNativeWebView.postMessage(JSON.stringify({ error: 'img load failed: ' + img.src }));
};
</script>
</body></html>`;

export default function MjpegViewer({ streamUrl, onFrame, onError, onStatus }: Props) {
  function handleMessage(event: { nativeEvent: { data: string } }) {
    const data = event.nativeEvent.data;
    if (data === 'frame') {
      onFrame?.();
    } else if (data === 'stream_ok') {
      onStatus?.('Stream connected');
    } else {
      try {
        const payload = JSON.parse(data);
        if (payload.error) onError?.(payload.error);
      } catch {}
    }
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ html: makeHtml(streamUrl) }}
        style={styles.webview}
        onMessage={handleMessage}
        originWhitelist={['*']}
        mixedContentMode="always"
        javaScriptEnabled
        allowUniversalAccessFromFileURLs
        allowFileAccess
        scrollEnabled={false}
        bounces={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 800 / 640,   /* matches CAM_H_RES / CAM_V_RES in camera.c */
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
});
