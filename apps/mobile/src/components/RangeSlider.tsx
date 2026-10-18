import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
  GestureResponderEvent,
  Pressable,
} from 'react-native';
import { colors, spacing, borderRadius, useTheme } from '../theme';

interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  minValue: number;
  maxValue: number;
  onChange: (minVal: number, maxVal: number) => void;
  minLabel?: string;
  maxLabel?: string;
  testID?: string;
}

const THUMB_SIZE = 24;

export const RangeSlider: React.FC<RangeSliderProps> = ({
  min,
  max,
  step = 1,
  minValue,
  maxValue,
  onChange,
  minLabel,
  maxLabel,
  testID,
}) => {
  const { colors } = useTheme();
  const [trackWidth, setTrackWidth] = useState(300);
  const [activeThumb, setActiveThumb] = useState<'min' | 'max' | null>(null);

  // Keep references to latest values for pan responders and track touches
  const currentMinRef = useRef(minValue);
  const currentMaxRef = useRef(maxValue);
  const trackWidthRef = useRef(trackWidth);
  const startMinRef = useRef(minValue);
  const startMaxRef = useRef(maxValue);

  useEffect(() => {
    currentMinRef.current = Math.max(min, Math.min(max, minValue));
    currentMaxRef.current = Math.max(min, Math.min(max, maxValue));
  }, [minValue, maxValue, min, max]);

  useEffect(() => {
    trackWidthRef.current = trackWidth;
  }, [trackWidth]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width > 0 && Math.abs(width - trackWidth) > 1) {
      setTrackWidth(width);
      trackWidthRef.current = width;
    }
  };

  // Min thumb PanResponder
  const minPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setActiveThumb('min');
        startMinRef.current = currentMinRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        const width = trackWidthRef.current;
        if (width <= 0) return;
        const deltaVal = (gestureState.dx / width) * (max - min);
        const rawVal = startMinRef.current + deltaVal;
        const stepped = Math.round(rawVal / step) * step;
        // Enforce valid bounds and prevent thumbs from crossing: min <= stepped <= currentMaxRef.current
        const clamped = Math.max(min, Math.min(currentMaxRef.current, stepped));
        if (clamped !== currentMinRef.current) {
          currentMinRef.current = clamped;
          onChange(clamped, currentMaxRef.current);
        }
      },
      onPanResponderRelease: () => {
        setActiveThumb(null);
      },
      onPanResponderTerminate: () => {
        setActiveThumb(null);
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  // Max thumb PanResponder
  const maxPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setActiveThumb('max');
        startMaxRef.current = currentMaxRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        const width = trackWidthRef.current;
        if (width <= 0) return;
        const deltaVal = (gestureState.dx / width) * (max - min);
        const rawVal = startMaxRef.current + deltaVal;
        const stepped = Math.round(rawVal / step) * step;
        // Enforce valid bounds and prevent thumbs from crossing: currentMinRef.current <= stepped <= max
        const clamped = Math.min(max, Math.max(currentMinRef.current, stepped));
        if (clamped !== currentMaxRef.current) {
          currentMaxRef.current = clamped;
          onChange(currentMinRef.current, clamped);
        }
      },
      onPanResponderRelease: () => {
        setActiveThumb(null);
      },
      onPanResponderTerminate: () => {
        setActiveThumb(null);
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  // Track tap handler (only triggers when tapping the track itself, not a thumb)
  const handleTrackPress = (e: GestureResponderEvent) => {
    const width = trackWidthRef.current;
    if (width <= 0) return;
    const x = e.nativeEvent.locationX;
    const ratio = Math.max(0, Math.min(1, x / width));
    const rawVal = min + ratio * (max - min);
    const stepped = Math.max(min, Math.min(max, Math.round(rawVal / step) * step));

    const distToMin = Math.abs(stepped - currentMinRef.current);
    const distToMax = Math.abs(stepped - currentMaxRef.current);

    if (distToMin <= distToMax) {
      const newMin = Math.min(stepped, currentMaxRef.current);
      currentMinRef.current = newMin;
      onChange(newMin, currentMaxRef.current);
    } else {
      const newMax = Math.max(stepped, currentMinRef.current);
      currentMaxRef.current = newMax;
      onChange(currentMinRef.current, newMax);
    }
  };

  const clampedMin = Math.max(min, Math.min(max, minValue));
  const clampedMax = Math.max(min, Math.min(max, maxValue));
  const rangeSpan = max - min || 1;

  const minRatio = (clampedMin - min) / rangeSpan;
  const maxRatio = (clampedMax - min) / rangeSpan;

  const minPos = minRatio * trackWidth;
  const maxPos = maxRatio * trackWidth;

  return (
    <View style={styles.container} testID={testID}>
      {/* Slider Track Container */}
      <View style={styles.trackContainer} onLayout={handleLayout}>
        {/* Tappable Track Area */}
        <Pressable
          style={styles.trackPressArea}
          onPress={handleTrackPress}
          hitSlop={{ top: 10, bottom: 10 }}
        >
          {/* Inactive Track */}
          <View style={styles.inactiveTrack} />

          {/* Active Highlight Track */}
          <View
            style={[
              styles.activeTrack,
              {
                backgroundColor: colors.gold,
                left: Math.max(0, minPos),
                width: Math.max(0, maxPos - minPos),
              },
            ]}
          />
        </Pressable>

        {/* Min Thumb Handle */}
        <View
          style={[
            styles.thumb,
            {
              borderColor: colors.gold,
              backgroundColor: colors.cardElevated,
              left: Math.max(-THUMB_SIZE / 2, Math.min(trackWidth - THUMB_SIZE / 2, minPos - THUMB_SIZE / 2)),
              zIndex: activeThumb === 'min' ? 10 : 3,
              transform: [{ scale: activeThumb === 'min' ? 1.15 : 1 }],
            },
          ]}
          {...minPan.panHandlers}
          hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
          testID={`${testID}-min-thumb`}
        >
          <View style={[styles.thumbCenterDot, { backgroundColor: colors.gold }]} />
        </View>

        {/* Max Thumb Handle */}
        <View
          style={[
            styles.thumb,
            {
              borderColor: colors.gold,
              backgroundColor: colors.cardElevated,
              left: Math.max(-THUMB_SIZE / 2, Math.min(trackWidth - THUMB_SIZE / 2, maxPos - THUMB_SIZE / 2)),
              zIndex: activeThumb === 'max' ? 10 : 3,
              transform: [{ scale: activeThumb === 'max' ? 1.15 : 1 }],
            },
          ]}
          {...maxPan.panHandlers}
          hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
          testID={`${testID}-max-thumb`}
        >
          <View style={[styles.thumbCenterDot, { backgroundColor: colors.gold }]} />
        </View>
      </View>

      {/* Endpoint Labels */}
      {(minLabel || maxLabel) && (
        <View style={styles.labelsRow}>
          <Text style={[styles.boundLabel, { color: colors.textSubtle }]}>{minLabel ?? min}</Text>
          <Text style={[styles.boundLabel, { color: colors.textSubtle }]}>{maxLabel ?? max}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: spacing.xs,
  },
  trackContainer: {
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
  },
  trackPressArea: {
    height: 40,
    justifyContent: 'center',
    width: '100%',
  },
  inactiveTrack: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 3,
    width: '100%',
  },
  activeTrack: {
    position: 'absolute',
    height: 6,
    backgroundColor: colors.gold,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#1E222F',
    borderWidth: 2.5,
    borderColor: colors.gold,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  thumbCenterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gold,
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -4,
    paddingHorizontal: 2,
  },
  boundLabel: {
    fontSize: 12,
    color: colors.textSubtle,
    fontWeight: '500',
  },
});
