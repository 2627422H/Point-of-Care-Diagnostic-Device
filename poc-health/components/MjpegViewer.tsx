import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StyleSheet, View, Image } from 'react-native';

interface Props {
  streamUrl: string;
  onFrame?: (brightness: number) => void;
  onError?: (msg: string) => void;
  onStatus?: (msg: string) => void;
  onBytes?: (total: number) => void;
}

// Snapshot polling: fetches /snapshot each time the previous image finishes
// loading. This naturally rate-limits to the device's actual throughput —
// if a frame takes 300 ms over WiFi, we don't queue up a backlog of requests.
// streamUrl is e.g. http://192.168.x.x/stream; we replace /stream → /snapshot.
export default function MjpegViewer({ streamUrl, onFrame, onError, onStatus, onBytes }: Props) {
  const [tick, setTick] = useState(0);
  const [reachable, setReachable] = useState(false);
  const liveRef = useRef(true);
  const loadingRef = useRef(false);   // true while a fetch is in flight
  const totalBytesRef = useRef(0);
  const snapshotBase = streamUrl.replace('/stream', '/snapshot');

  useEffect(() => {
    liveRef.current = true;
    loadingRef.current = false;
    totalBytesRef.current = 0;
    setReachable(false);
    setTick(0);

    onStatus?.('Connecting…');

    const ctrl = new AbortController();
    fetch(`${snapshotBase}?t=probe`, { signal: ctrl.signal })
      .then((res) => {
        if (!liveRef.current) return;
        if (!res.ok) { onError?.(`Device returned HTTP ${res.status}`); return; }
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

  // Called when the Image finishes loading — immediately request the next frame.
  const handleLoad = useCallback(() => {
    loadingRef.current = false;
    onFrame?.(128);
    if (liveRef.current) setTick((t) => t + 1);
  }, [onFrame]);

  // Called when the Image fails — wait 200 ms then retry.
  const handleError = useCallback((e: any) => {
    loadingRef.current = false;
    onError?.(e.nativeEvent?.error ?? 'image load error');
    if (liveRef.current) setTimeout(() => { if (liveRef.current) setTick((t) => t + 1); }, 200);
  }, [onError]);

  // Kick off the very first load once reachable.
  useEffect(() => {
    if (!reachable) return;
    loadingRef.current = true;
    setTick(1);
  }, [reachable]);

  const uri = reachable && tick > 0 ? `${snapshotBase}?t=${tick}` : null;

  return (
    <View style={styles.container}>
      {uri && (
        <Image
          source={{ uri }}
          style={styles.image}
          resizeMode="contain"
          fadeDuration={0}
          onLoad={handleLoad}
          onError={handleError}
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
