import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';

interface Section {
  title: string;
  items: { q: string; a: string }[];
}

const SECTIONS: Section[] = [
  {
    title: 'How to Run a Test',
    items: [
      {
        q: '1. Prepare the cartridge',
        a: 'Spit onto the cartridge and insert it firmly into the device slot.',
      },
      {
        q: '2. Connect via Bluetooth',
        a: 'Open the New Test tab and tap "CONNECT DEVICE". The app will scan for your POC device automatically.',
      },
      {
        q: '3. Start the test',
        a: 'Once connected, tap "START TEST". The device will analyse your sample and send the result to the app in a few seconds.',
      },
      {
        q: '4. Review your results',
        a: 'Your estrogen level and predicted symptoms will appear on the Results tab immediately after the test completes.',
      },
    ],
  },
  {
    title: 'Understanding Your Results',
    items: [
      {
        q: 'What is estrogen (pg/ml)?',
        a: 'Estrogen is measured in picograms per millilitre (pg/ml). Levels naturally rise and fall across your menstrual cycle, peaking around ovulation.',
      },
      {
        q: 'Follicular phase (D1–D13): 60–420 pg/ml',
        a: 'Estrogen gradually rises from menstruation through to ovulation. You may notice increasing energy and mood as levels climb.',
      },
      {
        q: 'Ovulation (D14–D18): 420–530 pg/ml',
        a: 'Estrogen peaks around this phase. This is the fertile window. Some people experience bloating or breast tenderness at peak levels.',
      },
      {
        q: 'Luteal phase (D19–D30): 80–410 pg/ml',
        a: 'Estrogen declines toward the end of the cycle. Lower levels in this phase are associated with PMS-like symptoms such as fatigue and mood changes.',
      },
    ],
  },
  {
    title: 'Symptom Guide',
    items: [
      {
        q: 'Cramping',
        a: 'Uterine cramping is common in the days before and during menstruation (low estrogen) and can also occur at ovulation (high estrogen).',
      },
      {
        q: 'Bloating',
        a: 'Water retention and bloating often peak around ovulation and again just before your period starts.',
      },
      {
        q: 'Fatigue',
        a: 'Energy tends to dip when estrogen is low — during menstruation and in the late luteal phase. Iron loss during your period can compound this.',
      },
      {
        q: 'Mood changes',
        a: 'Estrogen plays a role in serotonin regulation. Drops in estrogen in the late luteal phase are commonly linked to irritability and low mood.',
      },
    ],
  },
  {
    title: 'Device & Connectivity',
    items: [
      {
        q: 'The app cannot find my device',
        a: 'Make sure Bluetooth is enabled on your phone and the POC device is powered on (LED should be lit). Try moving closer to the device and tapping RETRY. If the problem persists, restart both the device and the app.',
      },
      {
        q: 'The test failed with an error',
        a: 'Ensure the cartridge is properly inserted and the device is charged. Tap RETRY on the New Test screen. If the error continues, try restarting the device.',
      },
      {
        q: 'How do I disconnect the device?',
        a: 'Scroll to the bottom of the New Test screen and tap "Disconnect device". The app will safely close the Bluetooth connection.',
      },
    ],
  },
  {
    title: 'Privacy',
    items: [
      {
        q: 'Where is my data stored?',
        a: 'All test results and profile information are stored locally on this device only. Nothing is sent to external servers. You can clear your data at any time by uninstalling the app.',
      },
      {
        q: 'Is my data backed up?',
        a: 'Data is not currently backed up to the cloud. If you uninstall the app or switch devices, historical results will not be transferred.',
      },
    ],
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity style={styles.faqItem} onPress={() => setOpen((v) => !v)} activeOpacity={0.75}>
      <View style={styles.faqRow}>
        <Text style={styles.faqQ}>{q}</Text>
        <Text style={styles.faqChevron}>{open ? '▲' : '▼'}</Text>
      </View>
      {open && <Text style={styles.faqA}>{a}</Text>}
    </TouchableOpacity>
  );
}

export default function HelpScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Help</Text>

        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
            <View style={styles.card}>
              {section.items.map((item, i) => (
                <View key={item.q}>
                  <FAQItem q={item.q} a={item.a} />
                  {i < section.items.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.footer}>POC Health v1.0 · All data stored locally</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  faqItem: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  faqRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  faqQ: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    lineHeight: 20,
  },
  faqChevron: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  faqA: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.md,
  },
  footer: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
});
