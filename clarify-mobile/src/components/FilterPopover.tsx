import { Feather } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';

export interface SingleSelectFilterSection {
  kind: 'single';
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  activeTone?: 'navy' | 'blue';
  options: {
    value: string;
    label: string;
    badge?: string;
    highlight?: 'amber';
  }[];
}

export interface ToggleFilterSection {
  kind: 'toggle';
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  optionLabel: string;
  hasAlert?: boolean;
}

export type FilterSection = SingleSelectFilterSection | ToggleFilterSection;

export interface FilterPopoverProps {
  label?: string;
  title?: string;
  activeCount: number;
  sections: FilterSection[];
  onReset?: () => void;
  align?: 'left' | 'right';
  compact?: boolean;
  accessibilityLabel?: string;
}

interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Reusable single Filter button that opens a floating filter tab (popover card)
 * anchored to the trigger button and clamped safely inside viewport & safe-area insets.
 */
export function FilterPopover({
  label = 'Filter',
  title = 'Filter Options',
  activeCount,
  sections,
  onReset,
  align = 'right',
  compact = false,
  accessibilityLabel,
}: FilterPopoverProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const triggerRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  const handleOpen = () => {
    const node = triggerRef.current;
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, y, width, height) => {
        if (width > 0 || height > 0) {
          setAnchor({ x, y, width, height });
        } else {
          setAnchor(null);
        }
        setIsOpen(true);
      });
    } else {
      setAnchor(null);
      setIsOpen(true);
    }
  };

  const margin = spacing.lg;
  const cardWidth = Math.min(360, Math.max(240, windowWidth - margin * 2));
  const safeTop = Math.max(insets.top + spacing.sm, spacing.lg);
  const safeBottom = Math.max(insets.bottom + spacing.sm, spacing.lg);
  const gap = spacing.xs + 2;

  let cardLeft = (windowWidth - cardWidth) / 2;
  let cardTop = safeTop + 56;
  let cardMaxHeight = Math.min(440, Math.max(220, windowHeight * 0.58));

  if (anchor) {
    const rawLeft =
      align === 'right' ? anchor.x + anchor.width - cardWidth : anchor.x;
    cardLeft = Math.max(
      margin,
      Math.min(rawLeft, windowWidth - cardWidth - margin)
    );

    const spaceBelow =
      windowHeight - safeBottom - (anchor.y + anchor.height + gap);
    const spaceAbove = anchor.y - gap - safeTop;

    if (spaceBelow >= 230 || spaceBelow >= spaceAbove) {
      cardTop = anchor.y + anchor.height + gap;
      cardMaxHeight = Math.min(440, Math.max(180, spaceBelow));
    } else {
      cardMaxHeight = Math.min(440, Math.max(180, spaceAbove));
      cardTop = Math.max(safeTop, anchor.y - gap - Math.min(340, cardMaxHeight));
    }
  }

  const isHighlighted = isOpen || activeCount > 0;

  return (
    <View ref={triggerRef} collapsable={false} style={styles.triggerWrap}>
      <Pressable
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={
          accessibilityLabel ||
          (activeCount > 0 ? `${label}, ${activeCount} active` : label)
        }
        accessibilityState={{ expanded: isOpen }}
        style={({ pressed }) => [
          styles.triggerBtn,
          compact && styles.triggerBtnCompact,
          isHighlighted && styles.triggerBtnActive,
          pressed && styles.pressed,
        ]}
      >
        <Feather
          name="sliders"
          size={15}
          color={isHighlighted ? colors.ustpGold : colors.ustpNavy}
        />
        <Text
          style={[
            styles.triggerText,
            isHighlighted && styles.triggerTextActive,
          ]}
        >
          {label}
        </Text>
        {activeCount > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{activeCount}</Text>
          </View>
        )}
        <Feather
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={isHighlighted ? colors.ustpGold : colors.mutedSlate}
        />
      </Pressable>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setIsOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close filter options"
          />

          <View
            style={[
              styles.floatingCard,
              {
                top: cardTop,
                left: cardLeft,
                width: cardWidth,
                maxHeight: cardMaxHeight,
              },
            ]}
          >
            {/* Floating Tab Header */}
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <Feather name="sliders" size={15} color={colors.ustpGold} />
                <Text numberOfLines={1} style={styles.cardTitle}>
                  {title}
                </Text>
                {activeCount > 0 && (
                  <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>{activeCount}</Text>
                  </View>
                )}
              </View>

              <View style={styles.cardHeaderRight}>
                {activeCount > 0 && onReset && (
                  <Pressable
                    onPress={onReset}
                    accessibilityRole="button"
                    accessibilityLabel="Reset filters"
                    style={({ pressed }) => [
                      styles.resetHeaderBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Feather
                      name="rotate-ccw"
                      size={13}
                      color={colors.ustpGold}
                    />
                    <Text style={styles.resetHeaderBtnText}>Reset</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setIsOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close filter tab"
                  style={({ pressed }) => [
                    styles.closeBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="x" size={18} color={colors.white} />
                </Pressable>
              </View>
            </View>

            {/* Scrollable Filter Sections */}
            <ScrollView
              contentContainerStyle={styles.cardBody}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {sections.map((section, idx) => (
                <View
                  key={section.id}
                  style={[
                    styles.sectionBlock,
                    idx > 0 && styles.sectionBlockBorder,
                  ]}
                >
                  <Text style={styles.sectionLabel}>{section.label}</Text>

                  {section.kind === 'single' ? (
                    <View style={styles.optionsWrap}>
                      {section.options.map((opt) => {
                        const active = section.value === opt.value;
                        const isBlue = section.activeTone === 'blue';
                        const isAmber = !active && opt.highlight === 'amber';

                        return (
                          <Pressable
                            key={opt.value}
                            onPress={() => section.onChange(opt.value)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`${section.label}: ${opt.label}`}
                            style={({ pressed }) => [
                              styles.optionChip,
                              active
                                ? isBlue
                                  ? styles.optionChipBlueActive
                                  : styles.optionChipNavyActive
                                : isAmber
                                  ? styles.optionChipAmber
                                  : null,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text
                              style={[
                                styles.optionChipText,
                                active
                                  ? isBlue
                                    ? styles.optionChipTextBlueActive
                                    : styles.optionChipTextNavyActive
                                  : isAmber
                                    ? styles.optionChipTextAmber
                                    : null,
                              ]}
                            >
                              {opt.label}
                            </Text>
                            {opt.badge && (
                              <View style={styles.optionBadge}>
                                <Text style={styles.optionBadgeText}>
                                  {opt.badge}
                                </Text>
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <Pressable
                      onPress={section.onToggle}
                      accessibilityRole="button"
                      accessibilityState={{ selected: section.checked }}
                      accessibilityLabel={`${section.label}: ${section.optionLabel}`}
                      style={({ pressed }) => [
                        styles.toggleChip,
                        section.checked
                          ? styles.toggleChipActive
                          : section.hasAlert
                            ? styles.toggleChipAlert
                            : null,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View
                        style={[
                          styles.toggleDot,
                          section.checked
                            ? styles.toggleDotActive
                            : section.hasAlert
                              ? styles.toggleDotAlert
                              : styles.toggleDotMuted,
                        ]}
                      />
                      <Text
                        style={[
                          styles.toggleChipText,
                          section.checked
                            ? styles.toggleChipTextActive
                            : section.hasAlert
                              ? styles.toggleChipTextAlert
                              : null,
                        ]}
                      >
                        {section.optionLabel}
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  triggerWrap: {
    flexShrink: 0,
  },
  triggerBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  triggerBtnCompact: {
    minHeight: 44,
    borderRadius: radii.md,
  },
  triggerBtnActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  triggerText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  triggerTextActive: {
    color: colors.ustpGold,
  },
  countBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.ustpGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontFamily: typography.fontFamilySans,
    fontSize: 10,
    fontWeight: '900',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlayBackdrop,
  },
  floatingCard: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    ...elevation.overlay,
  },
  cardHeader: {
    backgroundColor: colors.ustpNavy,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  cardTitle: {
    flexShrink: 1,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.white,
  },
  headerBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.ustpGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadgeText: {
    fontFamily: typography.fontFamilySans,
    fontSize: 10,
    fontWeight: '900',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
  },
  resetHeaderBtn: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  resetHeaderBtnText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  closeBtn: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  cardBody: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionBlock: {
    gap: spacing.sm,
  },
  sectionBlockBorder: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionLabel: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.mutedSlate,
  },
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  optionChip: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  optionChipNavyActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  optionChipBlueActive: {
    backgroundColor: colors.ustpBlue,
    borderColor: colors.ustpBlue,
  },
  optionChipAmber: {
    backgroundColor: colors.warningBg,
    borderColor: colors.tagMemoBorder,
  },
  optionChipText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpText,
    ...typography.tabularNums,
  },
  optionChipTextNavyActive: {
    color: colors.ustpGold,
    fontWeight: '800',
  },
  optionChipTextBlueActive: {
    color: colors.white,
    fontWeight: '800',
  },
  optionChipTextAmber: {
    color: colors.warningText,
    fontWeight: '800',
  },
  optionBadge: {
    backgroundColor: colors.ustpGold,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
  },
  optionBadgeText: {
    fontFamily: typography.fontFamilySans,
    fontSize: 10,
    fontWeight: '900',
    color: colors.ustpNavy,
  },
  toggleChip: {
    alignSelf: 'flex-start',
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleChipActive: {
    backgroundColor: colors.dangerBorder,
    borderColor: colors.dangerBorder,
  },
  toggleChipAlert: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.urgentCardBorder,
  },
  toggleDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
  toggleDotActive: {
    backgroundColor: colors.white,
  },
  toggleDotAlert: {
    backgroundColor: colors.dangerBorder,
  },
  toggleDotMuted: {
    backgroundColor: colors.placeholder,
  },
  toggleChipText: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
    ...typography.tabularNums,
  },
  toggleChipTextActive: {
    color: colors.white,
  },
  toggleChipTextAlert: {
    color: colors.dangerTitle,
  },
  pressed: {
    opacity: 0.85,
  },
});
