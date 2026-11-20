import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../context/AuthContext';
import { updateProfileApi } from '../lib/api-client';
import {
  getFieldValidationError,
  normalizePhilippineMobileNumber,
} from '../lib/domain-logic';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type { ApiError } from '../types/api';

/**
 * Profile & SMS Fallback Settings Modal ported from
 * clarify-web/src/components/modals/ProfileSettingsModal.tsx.
 * Connects to POST /api/v1/profile with `_method=PATCH`.
 */
export function ProfileSettingsModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { user, setUser, showToast } = useAuth();
  const [contactNumber, setContactNumber] = useState(
    user?.contact_number || ''
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (visible && user) {
      setContactNumber(user.contact_number || '');
      setFieldErrors({});
      setGeneralError(null);
    }
  }, [visible, user]);

  if (!user) {
    return null;
  }

  const handleSave = async () => {
    if (isSaving) return;
    setFieldErrors({});
    setGeneralError(null);

    const trimmed = contactNumber.trim();
    let normalizedPhone = '';
    if (trimmed !== '') {
      const normalized = normalizePhilippineMobileNumber(trimmed);
      if (!normalized) {
        setFieldErrors({
          contact_number: [
            'Please enter a valid Philippine mobile number (e.g., +639171234567 or 09171234567).',
          ],
        });
        return;
      }
      normalizedPhone = normalized;
    }

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append('contact_number', normalizedPhone);
      if (user.avatar_url) {
        formData.append('avatar_preview_url', user.avatar_url);
      }
      const res = await updateProfileApi(formData);
      if (res?.data) {
        setUser(res.data);
      }
      showToast(res?.message || 'Profile settings updated.', 'success');
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        setGeneralError(apiErr.message || 'Could not update profile settings.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const contactError = getFieldValidationError(fieldErrors, 'contact_number');
  const avatarInitial = user.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close settings overlay"
        />

        <View style={styles.dialog}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle}>
                Profile &amp; SMS Fallback Settings
              </Text>
              <Text style={styles.headerSubtitle}>
                RA 10173 Encrypted Contact Configuration
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close profile settings"
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="x" size={20} color={colors.white} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* User Identity Summary */}
            <View style={styles.identityRow}>
              <View style={styles.avatarCircle}>
                {user.avatar_url ? (
                  <Image
                    source={{ uri: user.avatar_url }}
                    accessibilityLabel={user.name}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text style={styles.avatarInitial}>{avatarInitial}</Text>
                )}
              </View>
              <View style={styles.identityTextWrap}>
                <Text style={styles.userName}>{user.name}</Text>
                <Text style={styles.userMeta}>
                  {user.institutional_id} • {user.role.replace('_', ' ').toUpperCase()}
                </Text>
                <Text style={styles.userEmail}>{user.email}</Text>
              </View>
            </View>

            {/* General Error */}
            {generalError && (
              <View accessibilityRole="alert" style={styles.errorBox}>
                <Text style={styles.errorText}>{generalError}</Text>
              </View>
            )}

            {/* Contact Number Input */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                Philippine Mobile Number (SMS Fallback)
              </Text>
              <TextInput
                value={contactNumber}
                onChangeText={(value) => {
                  setContactNumber(value);
                  if (fieldErrors.contact_number) {
                    setFieldErrors({});
                  }
                }}
                placeholder="e.g. 09171234567 or +639171234567"
                placeholderTextColor={colors.placeholder}
                keyboardType="phone-pad"
                autoComplete="tel"
                accessibilityLabel="Philippine Mobile Number"
                style={[
                  styles.input,
                  contactError ? styles.inputError : undefined,
                ]}
              />
              {contactError ? (
                <Text style={styles.fieldErrorText}>{contactError}</Text>
              ) : (
                <Text style={styles.helperText}>
                  Used only for urgent campus SMS fallback alerts. Leave blank
                  to clear your saved number.
                </Text>
              )}
            </View>

            {/* Academic Scope Read-Only Summary */}
            {user.academic_profile && (
              <View style={styles.scopeCard}>
                <Text style={styles.scopeLabel}>Verified Academic Scope</Text>
                <Text style={styles.scopeValue}>
                  {user.academic_profile.campus} •{' '}
                  {user.academic_profile.department}
                  {user.academic_profile.section
                    ? ` • ${user.academic_profile.section}`
                    : ''}
                </Text>
              </View>
            )}

            {/* Footer Actions */}
            <View style={styles.actionsRow}>
              <Pressable
                onPress={onClose}
                disabled={isSaving}
                accessibilityRole="button"
                accessibilityLabel="Cancel profile changes"
                style={({ pressed }) => [
                  styles.cancelButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={() => void handleSave()}
                disabled={isSaving}
                accessibilityRole="button"
                accessibilityLabel="Save Profile"
                style={({ pressed }) => [
                  styles.saveButton,
                  isSaving && styles.disabledButton,
                  pressed && !isSaving && styles.pressed,
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Feather name="check" size={16} color={colors.ustpGold} />
                )}
                <Text style={styles.saveButtonText}>
                  {isSaving ? 'Saving...' : 'Save Profile'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialog: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    maxHeight: '85%',
    ...elevation.overlay,
  },
  header: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerTextWrap: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.white,
  },
  headerSubtitle: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.ustpNavyMutedText,
  },
  closeButton: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: radii.pill,
    backgroundColor: colors.ustpCream,
    borderWidth: 2,
    borderColor: colors.ustpGold,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontSize: typography.sizes.titleMd,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  identityTextWrap: {
    flex: 1,
    gap: 2,
  },
  userName: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.ustpText,
  },
  userMeta: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  userEmail: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  errorText: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.dangerText,
    fontWeight: '600',
  },
  fieldGroup: {
    gap: spacing.xs + 2,
  },
  label: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '700',
    color: colors.ustpText,
  },
  input: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.body,
    color: colors.ustpText,
    ...typography.tabularNums,
  },
  inputError: {
    borderColor: colors.dangerBorder,
  },
  fieldErrorText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.dangerTitle,
    fontWeight: '700',
  },
  helperText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  scopeCard: {
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 2,
  },
  scopeLabel: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  scopeValue: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '700',
    color: colors.ustpNavy,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  cancelButton: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  saveButton: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  saveButtonText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  disabledButton: {
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.85,
  },
});
