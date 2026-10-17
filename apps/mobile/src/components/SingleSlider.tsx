import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import { colors, spacing, useTheme } from '../theme';

interface SingleSliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (val: number) => void;
  minLabel?: string;
  maxLabel?: string;
  testID?: string;
}

const THUMB_SIZE = 24;

export const SingleSlider: React.FC<SingleSliderProps> = ({
  min,
  max,
  step = 1,
  value,
  onChange,
  minLabel,
  maxLabel,
  testID,
}) => {
  const { colors } = useTheme();
  const [trackWidth, setTrackWidth] = useState(300);

  const currentValueRef = useRef(value);
  const trackWidthRef = useRef(trackWidth);
  const startValRef = useRef(value);

  useEffect(() => {
    currentValueRef.current = value;
  }, [value]);

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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startValRef.current = currentValueRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        const width = trackWidthRef.current;
        if (width <= 0) return;
        const deltaVal = (gestureState.dx / width) * (max - min);
        const rawVal = startValRef.current + deltaVal;
        const stepped = Math.round(rawVal / step) * step;
        const clamped = Math.max(min, Math.min(max, stepped));
        if (clamped !== currentValueRef.current) {
          currentValueRef.current = clamped;
          onChange(clamped);
        }
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  const handleTrackTouch = (e: GestureResponderEvent) => {
    const width = trackWidthRef.current;
    if (width <= 0) return;
    const x = e.nativeEvent.locationX;
    const ratio = Math.max(0, Math.min(1, x / width));
    const rawVal = min + ratio * (max - min);
    const stepped = Math.max(min, Math.min(max, Math.round(rawVal / step) * step));
    currentValueRef.current = stepped;
    onChange(stepped);
  };

  const clampedVal = Math.max(min, Math.min(max, value));
  const rangeSpan = max - min || 1;
  const ratio = (clampedVal - min) / rangeSpan;
  const pos = ratio * trackWidth;

  return (
    <View style={styles.container} testID={testID}>
      {/* Slider Track Container */}
      <View style={styles.trackContainer} onLayout={handleLayout} onTouchStart={handleTrackTouch}>
        {/* Inactive Track */}
        <View style={styles.inactiveTrack} />

        {/* Active Highlight Track */}
        <View
          style={[
            styles.activeTrack,
            {
              backgroundColor: colors.gold,
              width: Math.max(0, Math.min(trackWidth, pos)),
            },
          ]}
        />

        {/* Single Thumb Handle */}
        <View
          style={[
            styles.thumb,
            {
              borderColor: colors.gold,
              backgroundColor: colors.cardElevated,
              left: Math.max(-THUMB_SIZE / 2, Math.min(trackWidth - THUMB_SIZE / 2, pos - THUMB_SIZE / 2)),
            },
          ]}
          {...panResponder.panHandlers}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          testID={`${testID}-thumb`}
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
  inactiveTrack: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 3,
    width: '100%',
  },
  activeTrack: {
    position: 'absolute',
    height: 6,
    left: 0,
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
