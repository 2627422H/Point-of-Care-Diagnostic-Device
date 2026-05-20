import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../constants/theme';

interface Props {
  onColor: (r: number, g: number, b: number) => void;
  status?: string | null;
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbStr(r: number, g: number, b: number) {
  return `rgb(${r},${g},${b})`;
}

const HUE_STEPS  = 24;
const BRIGHT_STEPS = 7;
const HUES = Array.from({ length: HUE_STEPS }, (_, i) => Math.round((i / HUE_STEPS) * 360));
const BRIGHTS = Array.from({ length: BRIGHT_STEPS }, (_, i) =>
  parseFloat(((i + 1) / BRIGHT_STEPS).toFixed(2))
);

// White + Off shortcuts
const SHORTCUTS = [
  { label: 'Off',   r: 0,   g: 0,   b: 0   },
  { label: 'White', r: 255, g: 255, b: 255  },
];

export default function LedColorPicker({ onColor, status }: Props) {
  const [hue,        setHue]        = useState(0);
  const [brightness, setBrightness] = useState(1.0);

  const [selR, selG, selB] = hsvToRgb(hue, 1, brightness);

  const handleHue = useCallback((h: number) => {
    setHue(h);
    const [r, g, b] = hsvToRgb(h, 1, brightness);
    onColor(r, g, b);
  }, [brightness, onColor]);

  const handleBright = useCallback((v: number) => {
    setBrightness(v);
    const [r, g, b] = hsvToRgb(hue, 1, v);
    onColor(r, g, b);
  }, [hue, onColor]);

  return (
    <View style={styles.container}>
      {/* Hue strip */}
      <Text style={styles.label}>HUE</Text>
      <View style={styles.strip}>
        {HUES.map((h) => {
          const [r, g, b] = hsvToRgb(h, 1, 1);
          const selected = h === hue;
          return (
            <TouchableOpacity
              key={h}
              style={[styles.swatch, { backgroundColor: rgbStr(r, g, b) }, selected && styles.swatchSelected]}
              onPress={() => handleHue(h)}
              activeOpacity={0.8}
            />
          );
        })}
      </View>

      {/* Brightness strip */}
      <Text style={styles.label}>BRIGHTNESS</Text>
      <View style={styles.strip}>
        {BRIGHTS.map((v) => {
          const [r, g, b] = hsvToRgb(hue, 1, v);
          const selected = Math.abs(v - brightness) < 0.01;
          return (
            <TouchableOpacity
              key={v}
              style={[styles.swatch, { backgroundColor: rgbStr(r, g, b), flex: 1 }, selected && styles.swatchSelected]}
              onPress={() => handleBright(v)}
              activeOpacity={0.8}
            />
          );
        })}
      </View>

      {/* Shortcuts + preview */}
      <View style={styles.bottomRow}>
        <View style={styles.shortcuts}>
          {SHORTCUTS.map((s) => (
            <TouchableOpacity
              key={s.label}
              style={styles.shortcutChip}
              onPress={() => { setHue(0); setBrightness(s.r === 0 ? 0 : 1); onColor(s.r, s.g, s.b); }}
              activeOpacity={0.8}
            >
              <Text style={styles.shortcutLabel}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.previewBlock}>
          <View style={[styles.preview, { backgroundColor: rgbStr(selR, selG, selB) }]} />
          <Text style={styles.previewText}>
            {selR}, {selG}, {selB}
          </Text>
        </View>
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const SWATCH_H = 28;

const styles = StyleSheet.create({
  container: { gap: Spacing.xs },
  label: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.8,
  },
  strip: {
    flexDirection: 'row',
    height: SWATCH_H,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    gap: 1,
  },
  swatch: {
    flex: 1,
    height: SWATCH_H,
  },
  swatchSelected: {
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderColor: '#fff',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  shortcuts: { flexDirection: 'row', gap: Spacing.xs },
  shortcutChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  shortcutLabel: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500' },
  previewBlock: { alignItems: 'center', gap: 3 },
  preview: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  previewText: { fontSize: 9, color: Colors.textSecondary },
  status: { fontSize: FontSize.xs, color: Colors.textSecondary, fontStyle: 'italic' },
});
