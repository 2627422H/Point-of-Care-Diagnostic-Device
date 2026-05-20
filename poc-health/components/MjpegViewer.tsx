import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { Colors, FontSize } from '../constants/theme';

interface Props {
  streamUrl: string;
  onFrame?: () => void;
  onError?: (msg: string) => void;
  onStatus?: (msg: string) => void;
}

/**
 * MjpegViewer — a VISIBLE WebView that:
 *  1. Shows the MJPEG stream full-width using an <img> tag (WKWebView / Safari
 *     engine handles MJPEG natively, same as tapping the URL in Safari)
 *  2. Uses canvas pixel sampling to detect frame changes and reports them
 *     back via postMessage so the parent can track FPS
 */
const makeHtml = (url: string) => `<!DOCTYPE html><html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    #stream {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      display: block;
    }
    #status {
      position: fixed;
      bottom: 8px;
      left: 0; right: 0;
      text-align: center;
      color: rgba(255,255,255,0.6);
      font-family: -apple-system, sans-serif;
      font-size: 12px;
    }
    #error {
      display: none;
      color: #ff6b6b;
      font-family: -apple-system, sans-serif;
      font-size: 14px;
      text-align: center;
      padding: 20px;
    }
  </style>
</head>
<body>
  <img id="stream" src="${url}">
  <canvas id="canvas" width="8" height="8" style="display:none"></canvas>
  <div id="status">Connecting…</div>
  <div id="error"></div>
<script>
var img    = document.getElementById('stream');
var canvas = document.getElementById('canvas');
var status = document.getElementById('status');
var errorDiv = document.getElementById('error');
var ctx    = canvas.getContext('2d');
var last   = null;
var frameCount = 0;
var pollStarted = false;

function sample() {
  try {
    ctx.drawImage(img, 0, 0, 8, 8);
    var d = ctx.getImageData(0, 0, 8, 8).data;
    var h = 0;
    for (var i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0;
    return h;
  } catch(e) { return null; }
}

function poll() {
  var h = sample();
  if (h !== null && last !== null && h !== last) {
    frameCount++;
    status.textContent = 'Frame ' + frameCount;
    window.ReactNativeWebView.postMessage('frame');
  }
  if (h !== null) last = h;
  requestAnimationFrame(poll);
}

img.onload = function() {
  status.textContent = 'Stream connected';
  window.ReactNativeWebView.postMessage('stream_ok');
  if (!pollStarted) { pollStarted = true; poll(); }
};

img.onerror = function() {
  img.style.display = 'none';
  errorDiv.style.display = 'block';
  errorDiv.textContent = 'Could not load stream. Make sure your phone and device are on the same WiFi network.';
  status.style.display = 'none';
  window.ReactNativeWebView.postMessage(JSON.stringify({ error: 'Stream failed to load: ' + img.src }));
};
</script>
</body></html>`;

export default function MjpegViewer({ streamUrl, onFrame, onError, onStatus }: Props) {
  /* Derive the base URL (e.g. http://172.20.10.13) from the stream URL.
   * Passing it as baseUrl gives the WebView the same origin as the ESP32,
   * so the <img> request is same-origin and CORS is never involved. */
  const baseUrl = streamUrl.replace(/\/[^/]*$/, '');

  function handleMessage(event: { nativeEvent: { data: string } }) {
    const data = event.nativeEvent.data;
    if (data === 'frame') {
      onFrame?.();
    } else if (data === 'stream_ok') {
      onStatus?.('Stream connected');
    } else {
      try {
        const payload = JSON.parse(data);
        if (payload.error) {
          onError?.(payload.error);
          onStatus?.('error: ' + payload.error);
        }
      } catch {}
    }
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ html: makeHtml(streamUrl), baseUrl }}
        style={styles.webview}
        onMessage={handleMessage}
        originWhitelist={['*']}
        mixedContentMode="always"
        javaScriptEnabled
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
