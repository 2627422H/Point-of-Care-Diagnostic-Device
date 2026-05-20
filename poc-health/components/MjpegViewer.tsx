import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Image } from 'react-native';

interface Props {
  streamUrl: string;
  onFrame?: (brightness: number) => void;
  onError?: (msg: string) => void;
  onStatus?: (msg: string) => void;
  onBytes?: (total: number) => void;
}

// Polls /snapshot every 100 ms (10 fps).
// React Native's native Image loader fetches plain JPEG over HTTP with no
// CORS or ATS issues — no WebView, no streaming parser needed.
// streamUrl is e.g. http://192.168.x.x/stream; we replace /stream → /snapshot.
export default function MjpegViewer({ streamUrl, onFrame, onError, onStatus, onBytes }: Props) {
  const [tick, setTick] = useState(0);
  const [reachable, setReachable] = useState(false);
  const liveRef = useRef(true);
  const totalBytesRef = useRef(0);
  const snapshotBase = streamUrl.replace('/stream', '/snapshot');

  useEffect(() => {
    liveRef.current = true;
    totalBytesRef.current = 0;
    setReachable(false);
    setTick(0);

    onStatus?.('Connecting…');

    // Probe once to confirm the device is reachable before starting the poll loop.
    const ctrl = new AbortController();
    fetch(`${snapshotBase}?t=probe`, { signal: ctrl.signal })
      .then((res) => {
        if (!liveRef.current) return;
        if (!res.ok) { onError?.(`Device returned HTTP ${res.status}`); return; }
        // Rough byte count from Content-Length header if present.
        const cl = res.headers.get('content-length');
        if (cl) { totalBytesRef.current += parseInt(cl, 10); onBytes?.(totalBytesRef.current); }
        onStatus?.('Stream connected');
        setReachable(true);
      })
      .catch((e) => {
        if (liveRef.current && e?.name !== 'AbortError') {
          onError?.(`Cannot reach device: ${e?.message ?? 'network error'}`);
        }
      });

    return () => {
      liveRef.current = false;
      ctrl.abort();
    };
  }, [streamUrl]);

  // Tick loop — only runs once reachable is confirmed.
  useEffect(() => {
    if (!reachable) return;
    const id = setInterval(() => {
      if (!liveRef.current) return;
      setTick((t) => t + 1);
      onFrame?.(128);
    }, 100);
    return () => clearInterval(id);
  }, [reachable]);

  const uri = reachable ? `${snapshotBase}?t=${tick}` : null;

  return (
    <View style={styles.container}>
      {uri && (
        <Image
          source={{ uri }}
          style={styles.image}
          resizeMode="contain"
          fadeDuration={0}
          onError={(e) => onError?.(e.nativeEvent.error)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 800 / 640,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
