import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';
import { useAppStore } from '../../store/useAppStore';

const PROFILE_KEY = 'poc_profile';

interface ProfileData {
  name: string;
  photoUri: string | null;
  cycleLength: number | null;
  height: number | null;  // cm
  weight: number | null;  // kg
  age: number | null;
}

const DEFAULT_PROFILE: ProfileData = {
  name: 'Sarah Mitchell',
  photoUri: null,
  cycleLength: 28,
  height: 165,
  weight: 62,
  age: 28,
};

async function loadProfile(): Promise<ProfileData> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

async function saveProfile(data: ProfileData) {
  try {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(data));
  } catch {}
}

function calcBmi(height: number | null, weight: number | null): string | null {
  if (!height || !weight || height <= 0) return null;
  return (weight / (height / 100) ** 2).toFixed(1);
}

function bmiLabel(bmi: string): string {
  const v = parseFloat(bmi);
  if (v < 18.5) return 'Underweight';
  if (v < 25)   return 'Normal';
  if (v < 30)   return 'Overweight';
  return 'Obese';
}

// ── Field row inside a card ───────────────────────────────────────────────────
function FieldRow({
  label,
  value,
  onChange,
  placeholder,
  unit,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  unit?: string;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        <TextInput
          style={styles.fieldInput}
          value={value !== null ? String(value) : ''}
          onChangeText={(raw) => {
            const digits = raw.replace(/[^0-9]/g, '');
            onChange(digits === '' ? null : parseInt(digits, 10));
          }}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          keyboardType="numeric"
          returnKeyType="done"
        />
        {unit && <Text style={styles.fieldUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

// ── Stat row ─────────────────────────────────────────────────────────────────
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const { results } = useAppStore();
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);

  useEffect(() => {
    loadProfile().then(setProfile);
  }, []);

  function update(patch: Partial<ProfileData>) {
    const next = { ...profile, ...patch };
    setProfile(next);
    saveProfile(next);
  }

  async function pickPhoto() {
    const hasPhoto = !!profile.photoUri;

    const action = await new Promise<'camera' | 'library' | 'remove' | 'cancel'>((resolve) => {
      if (Platform.OS === 'ios') {
        const options = hasPhoto
          ? ['Take Photo', 'Choose from Library', 'Remove Photo', 'Cancel']
          : ['Take Photo', 'Choose from Library', 'Cancel'];
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options,
            cancelButtonIndex: options.length - 1,
            destructiveButtonIndex: hasPhoto ? 2 : undefined,
          },
          (i) => {
            if (hasPhoto) {
              resolve(i === 0 ? 'camera' : i === 1 ? 'library' : i === 2 ? 'remove' : 'cancel');
            } else {
              resolve(i === 0 ? 'camera' : i === 1 ? 'library' : 'cancel');
            }
          }
        );
      } else {
        const buttons: Parameters<typeof Alert.alert>[2] = [
          { text: 'Camera',  onPress: () => resolve('camera') },
          { text: 'Library', onPress: () => resolve('library') },
        ];
        if (hasPhoto) {
          buttons.push({ text: 'Remove Photo', onPress: () => resolve('remove'), style: 'destructive' });
        }
        buttons.push({ text: 'Cancel', onPress: () => resolve('cancel'), style: 'cancel' });
        Alert.alert('Profile Photo', 'Choose a source', buttons);
      }
    });

    if (action === 'cancel') return;

    if (action === 'remove') {
      update({ photoUri: null });
      return;
    }

    if (action === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera access is required to take a photo.');
        return;
      }
    } else {
      const { status, accessPrivileges } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      // accessPrivileges === 'limited' means the user chose specific photos on iOS 14+
      if (status !== 'granted' && accessPrivileges !== 'limited') {
        Alert.alert('Permission needed', 'Photo library access is required to choose a photo.');
        return;
      }
    }

    const launch =
      action === 'camera'
        ? ImagePicker.launchCameraAsync
        : ImagePicker.launchImageLibraryAsync;

    const result = await launch({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      update({ photoUri: result.assets[0].uri });
    }
  }

  async function exportData() {
    if (results.length === 0) {
      Alert.alert('No data', 'Run at least one test before exporting.');
      return;
    }

    const header = 'Date,Cycle Day,Estrogen (pg/ml),Cramping,Bloating,Fatigue,Mood Changes';
    const rows = [...results]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((r) => {
        const date = new Date(r.timestamp).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
        });
        const get = (name: string) =>
          r.symptoms.find((s) => s.name === name)?.severity ?? '';
        return [
          date,
          r.cycleDay,
          r.estrogenLevel,
          get('Cramping'),
          get('Bloating'),
          get('Fatigue'),
          get('Mood changes'),
        ].join(',');
      });

    const csv = [header, ...rows].join('\n');
    const fileName = `poc_health_${new Date().toISOString().slice(0, 10)}.csv`;
    const fileUri = FileSystem.cacheDirectory + fileName;

    try {
      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Export POC Health Data',
        UTI: 'public.comma-separated-values-text',
      });
    } catch {
      Alert.alert('Export failed', 'Could not export data. Please try again.');
    }
  }

  const avgEstrogen =
    results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.estrogenLevel, 0) / results.length)
      : null;

  const bmi = calcBmi(profile.height, profile.weight);
  const initial = profile.name ? profile.name[0].toUpperCase() : '?';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Profile</Text>

        {/* ── Photo + name ── */}
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatarWrap} onPress={pickPhoto} activeOpacity={0.8}>
            {profile.photoUri ? (
              <Image source={{ uri: profile.photoUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            <View style={styles.cameraOverlay}>
              <Ionicons name="camera" size={16} color="#fff" />
            </View>
          </TouchableOpacity>

          <TextInput
            style={styles.nameInput}
            value={profile.name}
            onChangeText={(v) => update({ name: v })}
            placeholder="Your name"
            placeholderTextColor={Colors.textMuted}
            textAlign="center"
            returnKeyType="done"
          />
        </View>

        {/* ── Cycle & measurements ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>CYCLE & MEASUREMENTS</Text>

          <FieldRow
            label="Cycle length"
            value={profile.cycleLength}
            onChange={(v) => update({ cycleLength: v })}
            placeholder="28"
            unit="days"
          />
          <View style={styles.divider} />
          <FieldRow
            label="Height"
            value={profile.height}
            onChange={(v) => update({ height: v })}
            placeholder="170"
            unit="cm"
          />
          <View style={styles.divider} />
          <FieldRow
            label="Weight"
            value={profile.weight}
            onChange={(v) => update({ weight: v })}
            placeholder="65"
            unit="kg"
          />
          <View style={styles.divider} />
          <FieldRow
            label="Age"
            value={profile.age}
            onChange={(v) => update({ age: v })}
            placeholder="30"
            unit="yrs"
          />
        </View>

        {/* ── Statistics ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>STATISTICS</Text>

          <StatRow label="Total tests" value={String(results.length)} />
          {avgEstrogen !== null && (
            <StatRow label="Avg. estrogen" value={`${avgEstrogen} pg/ml`} />
          )}
          {bmi && (
            <StatRow label="BMI" value={`${bmi} — ${bmiLabel(bmi)}`} />
          )}
        </View>

        {/* ── Export ── */}
        <TouchableOpacity style={styles.exportBtn} onPress={exportData} activeOpacity={0.8}>
          <Ionicons name="share-outline" size={18} color="#fff" />
          <Text style={styles.exportBtnText}>Export Data</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const AVATAR_SIZE = 100;

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },

  // Avatar + name
  avatarSection: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 40,
    color: '#fff',
    fontWeight: '700',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.background,
  },
  nameInput: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    minWidth: 160,
    textAlign: 'center',
  },

  // Card
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  cardTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 2,
  },

  // Field row
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    justifyContent: 'space-between',
  },
  fieldLabel: {
    fontSize: FontSize.md,
    color: Colors.text,
    fontWeight: '500',
  },
  fieldInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldInput: {
    fontSize: FontSize.md,
    color: Colors.text,
    textAlign: 'right',
    minWidth: 60,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  fieldUnit: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    width: 30,
  },

  // Stat row
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statLabel: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  statValue: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.primary,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
  },
  exportBtnText: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: '#fff',
  },
});
