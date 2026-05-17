import React, { useRef, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  streamUrl: string;
  onFrame: () => void;
  onError: (msg: string) => void;
}

// Hidden WebView: fetches MJPEG stream, detects each complete JPEG frame,
// and notifies React Native so it can count frames and calculate fps.
const COUNTER_HTML = `
<!DOCTYPE html><html><body>
<script>
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
      // Extract every complete JPEG (FF D8 ... FF D9) from buf.
      while (true) {
        let s = -1;
        for (let i = 0; i < buf.length - 1; i++) {
          if (buf[i] === 0xFF && buf[i+1] === 0xD8) { s = i; break; }
        }
        if (s === -1) { buf = new Uint8Array(0); break; }
        let e = -1;
        for (let i = s + 2; i < buf.length - 1; i++) {
          if (buf[i] === 0xFF && buf[i+1] === 0xD9) { e = i + 1; break; }
        }
        if (e === -1) { buf = buf.slice(s); break; }
        window.ReactNativeWebView.postMessage('frame');
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
    const timer = setTimeout(() => {
      webRef.current?.postMessage(streamUrl);
    }, 300);
    return () => clearTimeout(timer);
  }, [streamUrl]);

  function handleMessage(event: { nativeEvent: { data: string } }) {
    const data = event.nativeEvent.data;
    if (data === 'frame') {
      onFrame();
    } else {
      try {
        const payload = JSON.parse(data);
        if (payload.error) onError(payload.error);
      } catch {}
    }
  }

  return (
    <WebView
      ref={webRef}
      source={{ html: COUNTER_HTML }}
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
