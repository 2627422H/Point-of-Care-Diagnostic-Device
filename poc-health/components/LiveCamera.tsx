import React from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Radius } from '../constants/theme';

interface Props {
  streamUrl: string;
}

const viewerHtml = (url: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden">
  <img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain">
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
        javaScriptEnabled={false}
        scrollEnabled={false}
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
