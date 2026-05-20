import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  streamUrl: string;
  onFrame?: (brightness: number) => void;
  onError?: (msg: string) => void;
  onStatus?: (msg: string) => void;
}

// HTML is served inline — no HTTP request needed for the page itself.
// The img uses a relative src="/stream" which resolves to http://<ip>/stream
// via the baseUrl, making it same-origin and avoiding all CORS/ATS issues.
// The httpd receives exactly one connection (the stream).
const VIEWER_HTML = `<!DOCTYPE html><html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#000;width:100vw;height:100vh;display:flex;
         align-items:center;justify-content:center;overflow:hidden}
    #s{max-width:100%;max-height:100%;object-fit:contain;display:block}
  </style>
</head>
<body>
<img id="s" src="/stream">
<script>
var img=document.getElementById('s');
var cv=document.createElement('canvas');
cv.width=8;cv.height=8;
var ctx=cv.getContext('2d'),last=null;
function poll(){
  try{
    ctx.drawImage(img,0,0,8,8);
    var d=ctx.getImageData(0,0,8,8).data,h=0;
    for(var i=0;i<d.length;i++)h=(h*31+d[i])|0;
    if(last!==null&&h!==last&&window.ReactNativeWebView){
      var br=0;
      for(var j=0;j<d.length;j+=4)br+=d[j]*299+d[j+1]*587+d[j+2]*114;
      window.ReactNativeWebView.postMessage(JSON.stringify({t:'f',b:Math.round(br/64000)}));
    }
    last=h;
  }catch(e){}
  requestAnimationFrame(poll);
}
img.onload=function(){
  if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({t:'ok'}));
  poll();
};
img.onerror=function(){
  if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({t:'err'}));
};
</script>
</body></html>`;

export default function MjpegViewer({ streamUrl, onFrame, onError, onStatus }: Props) {
  // baseUrl makes relative /stream resolve to http://<ip>/stream (same-origin).
  const baseUrl = streamUrl.replace('/stream', '/');

  function handleMessage(event: { nativeEvent: { data: string } }) {
    const raw = event.nativeEvent.data;
    if (raw === 'frame')     { onFrame?.(128); return; }
    if (raw === 'stream_ok') { onStatus?.('Stream connected'); return; }
    try {
      const payload = JSON.parse(raw);
      if (payload.t === 'f')        onFrame?.(payload.b ?? 0);
      else if (payload.t === 'ok')  onStatus?.('Stream connected');
      else if (payload.t === 'err') onError?.('Stream image failed to load');
      else if (payload.error)       onError?.(payload.error);
    } catch {}
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ html: VIEWER_HTML, baseUrl }}
        style={styles.webview}
        onMessage={handleMessage}
        onError={(e) => onError?.(`Load error: ${e.nativeEvent.description}`)}
        originWhitelist={['*']}
        mixedContentMode="always"
        javaScriptEnabled
        allowUniversalAccessFromFileURLs
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
