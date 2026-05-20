import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  streamUrl: string;
  onFrame?: (brightness: number) => void;
  onError?: (msg: string) => void;
  onStatus?: (msg: string) => void;
}

export default function MjpegViewer({ streamUrl, onFrame, onError, onStatus }: Props) {
  // Point at the ESP32's / endpoint which serves the viewer HTML directly.
  // Same-origin img src="/stream" avoids all CORS/ATS issues.
  const viewerUrl = streamUrl.replace('/stream', '/');

  function handleMessage(event: { nativeEvent: { data: string } }) {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload.t === 'f')   onFrame?.(payload.b ?? 0);
      else if (payload.t === 'ok')  onStatus?.('Stream connected');
      else if (payload.t === 'err') onError?.('Stream image failed to load');
      else if (payload.error)       onError?.(payload.error);
    } catch {}
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: viewerUrl }}
        style={styles.webview}
        onMessage={handleMessage}
        onError={(e) => onError?.(`Load error: ${e.nativeEvent.description}`)}
        originWhitelist={['http://*', 'https://*']}
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
