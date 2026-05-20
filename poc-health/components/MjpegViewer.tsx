import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Image } from 'react-native';

interface Props {
  streamUrl: string;
  onFrame?: (brightness: number) => void;
  onError?: (msg: string) => void;
  onStatus?: (msg: string) => void;
  onBytes?: (total: number) => void;
}

// Convert Uint8Array to base64 in 8 KB chunks to avoid spread-operator stack limits.
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(s);
}

export default function MjpegViewer({ streamUrl, onFrame, onError, onStatus, onBytes }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const liveRef = useRef(true);
  const lastFrameMs = useRef(0);
  const totalBytesRef = useRef(0);

  useEffect(() => {
    liveRef.current = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        onStatus?.('Connecting…');
        const res = await fetch(streamUrl, { signal: ctrl.signal });
        if (!res.body) { if (liveRef.current) onError?.('No stream body'); return; }
        if (liveRef.current) onStatus?.('Stream connected');

        const reader = res.body.getReader();
        // 2 MB working buffer; doubled if needed.
        let buf = new Uint8Array(2 * 1024 * 1024);
        let len = 0;

        while (liveRef.current) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value?.length) continue;

          // Grow buffer if needed.
          if (len + value.length > buf.length) {
            const next = new Uint8Array(Math.max(buf.length * 2, len + value.length));
            next.set(buf.subarray(0, len));
            buf = next;
          }
          buf.set(value, len);
          len += value.length;
          totalBytesRef.current += value.length;
          onBytes?.(totalBytesRef.current);

          // Find the last JPEG EOI marker (FF D9) in the buffer.
          let eoi = -1;
          for (let i = len - 2; i >= 0; i--) {
            if (buf[i] === 0xFF && buf[i + 1] === 0xD9) { eoi = i + 2; break; }
          }
          if (eoi === -1) continue;

          // Find the SOI marker (FF D8) before that EOI.
          let soi = -1;
          for (let i = eoi - 4; i >= 0; i--) {
            if (buf[i] === 0xFF && buf[i + 1] === 0xD8) { soi = i; break; }
          }

          if (soi !== -1) {
            // Throttle display to ~15 fps so JS thread stays responsive.
            const now = Date.now();
            if (now - lastFrameMs.current >= 66) {
              lastFrameMs.current = now;
              const jpeg = buf.subarray(soi, eoi).slice();
              const dataUri = `data:image/jpeg;base64,${toBase64(jpeg)}`;
              if (liveRef.current) {
                setUri(dataUri);
                onFrame?.(128); // brightness placeholder; real values after firmware reflash
              }
            }
          }

          // Retain only bytes after the EOI (start of next frame).
          const remaining = len - eoi;
          if (remaining > 0) buf.copyWithin(0, eoi, len);
          len = Math.max(0, remaining);
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError' && liveRef.current) {
          onError?.(`Stream error: ${e?.message ?? 'unknown'}`);
        }
      }
    })();

    return () => {
      liveRef.current = false;
      ctrl.abort();
    };
  }, [streamUrl]);

  return (
    <View style={styles.container}>
      {uri && (
        <Image
          source={{ uri }}
          style={styles.image}
          resizeMode="contain"
          fadeDuration={0}
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
