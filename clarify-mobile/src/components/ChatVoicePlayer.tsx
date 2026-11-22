import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { formatAudioDuration } from '../lib/domain-logic';
import { colors, radii, spacing, touchTarget, typography } from '../theme';

export interface ChatVoicePlayerProps {
  /** Unique identifier coordinating single-active playback across chat bubbles and preview. */
  playerId: string;
  /** Resolved remote HTTPS URL or local recorded file URI. */
  uri: string;
  /** Optional display title / filename. */
  name?: string | null;
  /** Optional duration fallback in seconds (e.g. immediately after recording). */
  durationHintSec?: number | null;
  /** Visual surface styling variant. */
  variant: 'own' | 'other' | 'preview';
  /** Currently playing voice player ID managed by the parent chat screen. */
  activeVoiceId: string | null;
  /** Called when this player starts playing so sibling voice players pause. */
  onActivate: (playerId: string) => void;
  /** Optional fallback handler to open the raw audio URL externally if codec playback fails. */
  onOpenExternal?: (url: string) => void;
}

/**
 * Inline voice note player powered by Expo SDK 58 `expo-audio`.
 * Automatically releases native audio resources on unmount and pauses when another voice bubble starts.
 */
export function ChatVoicePlayer({
  playerId,
  uri,
  name,
  durationHintSec,
  variant,
  activeVoiceId,
  onActivate,
  onOpenExternal,
}: ChatVoicePlayerProps) {
  const player = useAudioPlayer(uri || null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  // Pause automatically if another voice note becomes active
  useEffect(() => {
    if (activeVoiceId !== playerId && status.playing) {
      player.pause();
    }
  }, [activeVoiceId, playerId, status.playing, player]);

  const totalDurationSec =
    status.duration > 0
      ? status.duration
      : typeof durationHintSec === 'number' && durationHintSec > 0
        ? durationHintSec
        : 0;

  const currentSec =
    status.didJustFinish ||
    (totalDurationSec > 0 && status.currentTime >= totalDurationSec)
      ? 0
      : Math.max(0, status.currentTime);

  const progressRatio =
    totalDurationSec > 0
      ? Math.min(1, Math.max(0, currentSec / totalDurationSec))
      : 0;

  const isOwn = variant === 'own';
  const isPreview = variant === 'preview';
  const hasPlaybackError = Boolean(status.error);

  const handleTogglePlay = () => {
    if (!uri) return;
    if (status.playing) {
      player.pause();
      return;
    }

    onActivate(playerId);

    const nearEnd =
      status.didJustFinish ||
      (totalDurationSec > 0 && status.currentTime >= totalDurationSec - 0.15);

    if (nearEnd) {
      void player
        .seekTo(0)
        .then(() => {
          player.play();
        })
        .catch(() => {
          player.play();
        });
      return;
    }

    player.play();
  };

  const displayClock =
    status.playing || currentSec > 0
      ? `${formatAudioDuration(currentSec)} / ${formatAudioDuration(totalDurationSec)}`
      : totalDurationSec > 0
        ? formatAudioDuration(totalDurationSec)
        : 'Voice note';

  return (
    <View
      style={[
        styles.container,
        isOwn
          ? styles.containerOwn
          : isPreview
            ? styles.containerPreview
            : styles.containerOther,
      ]}
    >
      <Pressable
        onPress={handleTogglePlay}
        disabled={!uri}
        accessibilityRole="button"
        accessibilityLabel={
          status.playing
            ? `Pause voice note ${name || ''}`.trim()
            : `Play voice note ${name || ''}`.trim()
        }
        style={({ pressed }) => [
          styles.playBtn,
          isOwn ? styles.playBtnOwn : styles.playBtnOther,
          pressed && styles.pressed,
        ]}
      >
        {status.isBuffering && !status.playing ? (
          <ActivityIndicator
            size="small"
            color={isOwn ? colors.ustpNavy : colors.ustpGold}
          />
        ) : (
          <Feather
            name={status.playing ? 'pause' : 'play'}
            size={16}
            color={isOwn ? colors.ustpNavy : colors.ustpGold}
          />
        )}
      </Pressable>

      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={styles.titleRow}>
            <Feather
              name="mic"
              size={12}
              color={isOwn ? colors.ustpGold : colors.ustpNavy}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                isOwn ? styles.labelOwn : styles.labelOther,
              ]}
            >
              {isPreview ? 'Recorded Voice Note' : 'Voice Note'}
            </Text>
          </View>
          <Text
            style={[styles.clock, isOwn ? styles.clockOwn : styles.clockOther]}
          >
            {displayClock}
          </Text>
        </View>

        {/* Flat Progress Track */}
        <View
          style={[
            styles.track,
            isOwn ? styles.trackOwn : styles.trackOther,
          ]}
        >
          <View
            style={[
              styles.fill,
              isOwn ? styles.fillOwn : styles.fillOther,
              { width: `${Math.round(progressRatio * 100)}%` },
            ]}
          />
        </View>

        {hasPlaybackError && onOpenExternal && uri ? (
          <Pressable
            onPress={() => onOpenExternal(uri)}
            accessibilityRole="button"
            accessibilityLabel="Open audio file externally"
            style={styles.fallbackRow}
          >
            <Feather
              name="external-link"
              size={12}
              color={isOwn ? colors.ustpGold : colors.ustpBlue}
            />
            <Text
              style={[
                styles.fallbackText,
                isOwn ? styles.fallbackTextOwn : styles.fallbackTextOther,
              ]}
            >
              Open audio in browser
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 210,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  containerOwn: {
    backgroundColor: colors.ustpNavySurface,
    borderColor: colors.ustpNavyBorder,
  },
  containerOther: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
  },
  containerPreview: {
    flex: 1,
    backgroundColor: colors.white,
    borderColor: colors.borderStrong,
  },
  playBtn: {
    width: touchTarget.minWidth - 4,
    height: touchTarget.minHeight - 4,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playBtnOwn: {
    backgroundColor: colors.ustpGold,
  },
  playBtnOther: {
    backgroundColor: colors.ustpNavy,
  },
  body: {
    flex: 1,
    gap: 5,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  label: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
  },
  labelOwn: {
    color: colors.white,
  },
  labelOther: {
    color: colors.ustpNavy,
  },
  clock: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    ...typography.tabularNums,
  },
  clockOwn: {
    color: colors.ustpNavyMutedText,
  },
  clockOther: {
    color: colors.mutedSlate,
  },
  track: {
    height: 5,
    width: '100%',
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  trackOwn: {
    backgroundColor: colors.ustpNavyBorder,
  },
  trackOther: {
    backgroundColor: colors.borderStrong,
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  fillOwn: {
    backgroundColor: colors.ustpGold,
  },
  fillOther: {
    backgroundColor: colors.ustpNavy,
  },
  fallbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
  },
  fallbackText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  fallbackTextOwn: {
    color: colors.ustpGold,
  },
  fallbackTextOther: {
    color: colors.ustpBlue,
  },
  pressed: {
    opacity: 0.82,
  },
});
