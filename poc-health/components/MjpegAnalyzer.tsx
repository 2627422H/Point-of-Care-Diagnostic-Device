import React from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  streamUrl: string;
  onFrame: (brightness: number) => void;
  onError: (msg: string) => void;
  onStatus?: (msg: string) => void;
}

// Hidden WebView: loads the MJPEG URL into an <img> tag (WKWebView renders
// MJPEG natively — same engine as Safari) and uses canvas pixel sampling at
// ~30 fps to detect frame changes. Avoids fetch() which buffers
// multipart/x-mixed-replace on iOS and never delivers chunks to JS.
const makeHtml = (url: string) => `<!DOCTYPE html><html>
<head><meta charset="utf-8"></head>
<body style="margin:0;background:#000;overflow:hidden">
<img id="s" crossorigin="anonymous"
     src="${url}"
     style="position:fixed;left:-9999px;width:1px;height:1px">
<canvas id="c" width="8" height="8" style="display:none"></canvas>
<script>
var img = document.getElementById('s');
var ctx = document.getElementById('c').getContext('2d');
var last = null;
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
  if (h !== null) {
    if (last !== null && h !== last) {
      window.ReactNativeWebView.postMessage('frame');
    }
    last = h;
  }
  requestAnimationFrame(poll);
}

img.onload = function() {
  window.ReactNativeWebView.postMessage('stream_ok');
  if (!pollStarted) { pollStarted = true; poll(); }
};
img.onerror = function() {
  window.ReactNativeWebView.postMessage(JSON.stringify({ error: 'img failed to load: ' + img.src }));
};
</script>
</body></html>`;

export default function MjpegAnalyzer({ streamUrl, onFrame, onError, onStatus }: Props) {
  function handleMessage(event: { nativeEvent: { data: string } }) {
    const raw = event.nativeEvent.data;
    if (raw === 'frame')     { onFrame(128); return; }
    if (raw === 'stream_ok') { onStatus?.('img loaded — counting frames'); return; }
    try {
      const payload = JSON.parse(raw);
      if (payload.t === 'f')        onFrame(payload.b ?? 0);
      else if (payload.t === 'ok')  onStatus?.('img loaded — counting frames');
      else if (payload.t === 'err') { onError('img load failed'); onStatus?.('error: img load failed'); }
      else if (payload.error)       { onError(payload.error); onStatus?.('error: ' + payload.error); }
    } catch {}
  }

  return (
    <WebView
      source={{ html: makeHtml(streamUrl) }}
      style={styles.hidden}
      onMessage={handleMessage}
      originWhitelist={['*']}
      mixedContentMode="always"
      javaScriptEnabled
    />
  );
}

const styles = StyleSheet.create({
  hidden: { width: 0, height: 0, opacity: 0 },
});
