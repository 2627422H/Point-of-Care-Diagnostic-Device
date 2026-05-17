import React, { useRef, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { IntensityPoint } from '../hooks/useStreamSession';

interface Props {
  streamUrl: string;
  onFrame: (point: IntensityPoint) => void;
  onError: (msg: string) => void;
}

// Runs inside the WebView: fetches the MJPEG stream, parses JPEG frames,
// draws each frame to a canvas, and posts mean R/G/B values back to React Native.
const ANALYZER_HTML = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<canvas id="c" width="160" height="120" style="display:none"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

function uint8ToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function analyzeJpeg(bytes) {
  const b64 = uint8ToBase64(bytes);
  const img = new Image();
  img.onload = function() {
    ctx.drawImage(img, 0, 0, 160, 120);
    const d = ctx.getImageData(0, 0, 160, 120).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
    const n = d.length / 4;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      r: r/n, g: g/n, b: b/n, t: Date.now()
    }));
    URL.revokeObjectURL(img.src);
  };
  img.src = 'data:image/jpeg;base64,' + b64;
}

async function startStream(url) {
  try {
    const res = await fetch(url);
    const reader = res.body.getReader();
    let buf = new Uint8Array(0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf); next.set(value, buf.length);
      buf = next;

      // Scan for complete JPEG (FF D8 ... FF D9)
      let s = -1, e = -1;
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0xFF && buf[i+1] === 0xD8) { s = i; break; }
      }
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i-1] === 0xFF && buf[i] === 0xD9) { e = i; break; }
      }
      if (s !== -1 && e !== -1 && e > s) {
        analyzeJpeg(buf.slice(s, e + 1));
        buf = buf.slice(e + 1);
      }
    }
  } catch(err) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ error: String(err) }));
  }
}

document.addEventListener('message', (e) => startStream(e.data));
window.addEventListener('message', (e) => startStream(e.data));
</script></body></html>
`;

export default function MjpegAnalyzer({ streamUrl, onFrame, onError }: Props) {
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    // Send the stream URL to the WebView once it's loaded
    const timer = setTimeout(() => {
      webRef.current?.postMessage(streamUrl);
    }, 300);
    return () => clearTimeout(timer);
  }, [streamUrl]);

  function handleMessage(event: { nativeEvent: { data: string } }) {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload.error) {
        onError(payload.error);
      } else {
        onFrame(payload as IntensityPoint);
      }
    } catch {}
  }

  return (
    <WebView
      ref={webRef}
      source={{ html: ANALYZER_HTML }}
      style={styles.hidden}
      onMessage={handleMessage}
      originWhitelist={['*']}
      mixedContentMode="always"
      javaScriptEnabled
    />
  );
}

const styles = StyleSheet.create({
  hidden: {
    width: 0,
    height: 0,
    opacity: 0,
  },
});
