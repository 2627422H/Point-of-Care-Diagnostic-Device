import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  streamUrl: string;
  onFrame?: () => void;
  onError?: (msg: string) => void;
  onStatus?: (msg: string) => void;
}

/*
 * Frame-counting script injected after the stream page loads.
 * The stream URL is loaded directly (not as inline HTML) so WKWebView
 * treats it identically to Safari — same origin, same MJPEG support.
 * We inject JS to sample the canvas and postMessage frame events back.
 */
const INJECTED_JS = `
(function() {
  var img = document.querySelector('img') || document.body;
  var canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 8;
  var ctx = canvas.getContext('2d');
  var last = null;
  var frameCount = 0;

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
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage('frame');
    }
    if (h !== null) last = h;
    requestAnimationFrame(poll);
  }

  poll();
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage('stream_ok');
})();
true;
`;

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
        source={{ uri: streamUrl }}
        style={styles.webview}
        onMessage={handleMessage}
        injectedJavaScript={INJECTED_JS}
        originWhitelist={['*']}
        mixedContentMode="always"
        javaScriptEnabled
        scrollEnabled={false}
        bounces={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        onError={(e) => onError?.(e.nativeEvent.description)}
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
