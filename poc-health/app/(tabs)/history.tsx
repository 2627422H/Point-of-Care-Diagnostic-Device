import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';
import { Colors, Spacing, Radius, FontSize } from '../../constants/theme';
import { useAppStore } from '../../store/useAppStore';
import { useRecordingStore, deleteRecordingRun, CURVE_LABELS, type RecordingRun } from '../../store/useRecordingStore';
import BrightnessChart from '../../components/BrightnessChart';
import type { TestResult } from '../../types';

const SCREEN_WIDTH = Dimensions.get('window').width;
// Cell width: screen minus content padding (md×2) and card padding (md×2), split across 7 columns
const CELL_SIZE = Math.floor((SCREEN_WIDTH - Spacing.md * 4) / 7);

const SEVERITY_COLORS: Record<string, string> = {
  None: Colors.textMuted,
  Mild: '#FFA726',
  Moderate: '#EF6C00',
  High: Colors.primary,
};

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function estrogenBadgeColor(level: number): string {
  if (level >= 420) return Colors.primary;
  if (level >= 200) return '#EF6C00';
  return Colors.textMuted;
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildDateMap(results: TestResult[]): Map<string, TestResult> {
  const map = new Map<string, TestResult>();
  for (const r of results) {
    const d = new Date(r.timestamp);
    const key = toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
    if (!map.has(key)) map.set(key, r); // one result per day
  }
  return map;
}

function getCalendarCells(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ── CalendarView ─────────────────────────────────────────────────────────────

function CalendarView({
  results,
  selectedId,
  onSelect,
}: {
  results: TestResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const dateMap = buildDateMap(results);
  const cells = getCalendarCells(viewYear, viewMonth);
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());

  const selectedDateKey = (() => {
    if (!selectedId) return null;
    const r = results.find(r => r.id === selectedId);
    if (!r) return null;
    const d = new Date(r.timestamp);
    return toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
  })();

  function goToPrev() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else { setViewMonth(m => m - 1); }
  }
  function goToNext() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else { setViewMonth(m => m + 1); }
  }

  return (
    <View style={styles.calCard}>
      {/* Month navigation */}
      <View style={styles.calHeader}>
        <TouchableOpacity onPress={goToPrev} style={styles.calNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.calMonthLabel}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
        <TouchableOpacity onPress={goToNext} style={styles.calNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-forward" size={20} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {/* Day-of-week header */}
      <View style={styles.calDayRow}>
        {DAY_LABELS.map(d => (
          <Text key={d} style={styles.calDayLabel}>{d}</Text>
        ))}
      </View>

      {/* Grid */}
      <View style={styles.calGrid}>
        {cells.map((day, idx) => {
          if (day === null) return <View key={`blank-${idx}`} style={styles.calCell} />;

          const key = toDateKey(viewYear, viewMonth, day);
          const result = dateMap.get(key);
          const isToday = key === todayKey;
          const isSelected = key === selectedDateKey;
          const hasTest = !!result;

          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.calCell,
                isSelected && styles.calCellSelected,
                isToday && !isSelected && styles.calCellToday,
              ]}
              onPress={() => result && onSelect(result.id)}
              activeOpacity={hasTest ? 0.7 : 1}
              disabled={!hasTest}
            >
              <Text style={[
                styles.calDayNum,
                isSelected && styles.calDayNumSelected,
                isToday && !isSelected && styles.calDayNumToday,
                !hasTest && styles.calDayNumFaded,
              ]}>
                {day}
              </Text>
              {hasTest && (
                <View style={[
                  styles.calDot,
                  { backgroundColor: isSelected ? '#fff' : estrogenBadgeColor(result!.estrogenLevel) },
                ]} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.calLegend}>
        <View style={styles.calLegendItem}>
          <View style={[styles.calDot, { backgroundColor: Colors.primary }]} />
          <Text style={styles.calLegendText}>≥420 pg/ml</Text>
        </View>
        <View style={styles.calLegendItem}>
          <View style={[styles.calDot, { backgroundColor: '#EF6C00' }]} />
          <Text style={styles.calLegendText}>200–419</Text>
        </View>
        <View style={styles.calLegendItem}>
          <View style={[styles.calDot, { backgroundColor: Colors.textMuted }]} />
          <Text style={styles.calLegendText}>{'<'}200 pg/ml</Text>
        </View>
      </View>
    </View>
  );
}

// ── ResultRow ─────────────────────────────────────────────────────────────────

function ResultRow({
  result,
  expanded,
  onPress,
}: {
  result: TestResult;
  expanded: boolean;
  onPress: () => void;
}) {
  const badgeColor = estrogenBadgeColor(result.estrogenLevel);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.rowMain}>
        <View style={styles.rowLeft}>
          <Text style={styles.rowDate}>{formatDate(result.timestamp)}</Text>
          <Text style={styles.rowCycleDay}>Cycle day {result.cycleDay}</Text>
        </View>
        <View style={[styles.estrogenBadge, { backgroundColor: badgeColor }]}>
          <Text style={styles.estrogenBadgeText}>{Math.round(result.estrogenLevel)}</Text>
          <Text style={styles.estrogenUnit}>pg/ml</Text>
        </View>
      </View>

      {expanded && (
        <View style={styles.symptomsExpanded}>
          {result.symptoms.map((s) => (
            <View key={s.id} style={styles.symptomLine}>
              <Ionicons
                name={s.icon as React.ComponentProps<typeof Ionicons>['name']}
                size={16}
                color={SEVERITY_COLORS[s.severity] ?? Colors.text}
                style={styles.symptomIcon}
              />
              <Text style={styles.symptomName}>{s.name}</Text>
              <Text style={[styles.severityLabel, { color: SEVERITY_COLORS[s.severity] ?? Colors.text }]}>
                {s.severity}
              </Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── RecordingRunRow ───────────────────────────────────────────────────────────

function RecordingRunRow({ run }: { run: RecordingRun }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(run.timestamp).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <TouchableOpacity style={styles.row} onPress={() => setExpanded((v) => !v)} activeOpacity={0.75}>
      <View style={styles.rowMain}>
        <View style={styles.rowLeft}>
          <Text style={styles.rowDate}>{date}</Text>
          <Text style={styles.rowCycleDay}>{CURVE_LABELS[run.curve]} · {(run.durationMs / 1000).toFixed(1)}s · {run.framesCapured} frames</Text>
        </View>
        <TouchableOpacity
          onPress={() => deleteRecordingRun(run.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ padding: 4 }}
        >
          <Ionicons name="trash-outline" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
      {expanded && run.brightnessData.length >= 2 && (
        <View style={{ marginTop: Spacing.xs }}>
          <BrightnessChart data={run.brightnessData} durationMs={run.durationMs} compact />
        </View>
      )}
      {expanded && run.brightnessData.length < 2 && (
        <Text style={styles.rowCycleDay}>No brightness data available.</Text>
      )}
    </TouchableOpacity>
  );
}

// ── HistoryScreen ─────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const { results } = useAppStore();
  const { runs } = useRecordingStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = [...results].sort((a, b) => b.timestamp - a.timestamp);
  const chartData = sorted.slice().reverse();
  const hasEnoughForChart = sorted.length >= 2;

  function handleDaySelect(id: string) {
    setExpandedId(prev => prev === id ? null : id);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={sorted}
        keyExtractor={r => r.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.title}>History</Text>

            {/* Calendar */}
            <CalendarView
              results={sorted}
              selectedId={expandedId}
              onSelect={handleDaySelect}
            />

            {/* Trend chart */}
            {hasEnoughForChart ? (
              <View style={styles.chartCard}>
                <Text style={styles.sectionLabel}>ESTROGEN TREND</Text>
                <LineChart
                  data={{
                    labels: chartData.map(r => `D${r.cycleDay}`),
                    datasets: [{ data: chartData.map(r => r.estrogenLevel) }],
                  }}
                  width={SCREEN_WIDTH - Spacing.md * 4}
                  height={160}
                  chartConfig={{
                    backgroundColor: Colors.cardBackground,
                    backgroundGradientFrom: Colors.cardBackground,
                    backgroundGradientTo: Colors.cardBackground,
                    decimalPlaces: 0,
                    color: (opacity = 1) => `rgba(200,84,80,${opacity})`,
                    labelColor: () => Colors.textSecondary,
                    propsForDots: { r: '4', strokeWidth: '2', stroke: Colors.primary },
                  }}
                  bezier
                  style={styles.chart}
                  withInnerLines={false}
                />
              </View>
            ) : (
              <View style={styles.chartPlaceholder}>
                <Ionicons name="analytics-outline" size={28} color={Colors.textMuted} />
                <Text style={styles.chartPlaceholderText}>
                  Run at least 2 tests to see your estrogen trend.
                </Text>
              </View>
            )}

            <Text style={styles.sectionLabel}>ALL TESTS</Text>
          </View>
        }
        ListFooterComponent={
          runs.length > 0 ? (
            <View style={styles.listHeader}>
              <Text style={styles.sectionLabel}>RECORDING RUNS</Text>
              {runs.map((run) => (
                <RecordingRunRow key={run.id} run={run} />
              ))}
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="flask-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No tests recorded yet.</Text>
            <Text style={styles.emptySubtext}>Run your first test from the New Test tab.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ResultRow
            result={item}
            expanded={expandedId === item.id}
            onPress={() => setExpandedId(expandedId === item.id ? null : item.id)}
          />
        )}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  listHeader: {
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },

  // ── Calendar ────────────────────────────────────────────────────────────────
  calCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  calNavBtn: {
    padding: Spacing.xs,
  },
  calMonthLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
  },
  calDayRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  calDayLabel: {
    width: CELL_SIZE,
    textAlign: 'center',
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    gap: 2,
  },
  calCellSelected: {
    backgroundColor: Colors.primary,
  },
  calCellToday: {
    backgroundColor: Colors.sectionBackground,
  },
  calDayNum: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    color: Colors.text,
  },
  calDayNumSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  calDayNumToday: {
    color: Colors.primary,
    fontWeight: '700',
  },
  calDayNumFaded: {
    color: Colors.textMuted,
    fontWeight: '400',
  },
  calDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  calLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    marginTop: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  calLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  calLegendText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },

  // ── Chart ───────────────────────────────────────────────────────────────────
  chartCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  chart: {
    borderRadius: Radius.md,
    marginLeft: -Spacing.sm,
  },
  chartPlaceholder: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  chartPlaceholderText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
  },

  // ── List ────────────────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  separator: {
    height: Spacing.sm,
  },
  row: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  rowMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLeft: {
    gap: 3,
  },
  rowDate: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  rowCycleDay: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  estrogenBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    minWidth: 64,
  },
  estrogenBadgeText: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: '#fff',
  },
  estrogenUnit: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.8)',
  },
  symptomsExpanded: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  symptomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  symptomIcon: {
    width: 22,
  },
  symptomName: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  severityLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.md,
  },
  emptyText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  emptySubtext: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
