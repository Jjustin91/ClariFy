import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
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
import { resolveApiAssetUrl, updateProfileApi } from '../lib/api-client';
import {
  buildProfileUpdateFormData,
  getFieldValidationError,
  normalizePhilippineMobileNumber,
  validateProfileAvatarFile,
  type NativeUploadFile,
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

function inferAvatarFileName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName && asset.fileName.trim().length > 0) {
    return asset.fileName.trim();
  }
  const uriSegment = asset.uri.split('/').pop()?.split('?')[0];
  if (uriSegment && /\.(jpg|jpeg|png|webp)$/i.test(uriSegment)) {
    return uriSegment;
  }
  const mime = (asset.mimeType || '').toLowerCase();
  if (mime.includes('png')) return `avatar_${Date.now()}.png`;
  if (mime.includes('webp')) return `avatar_${Date.now()}.webp`;
  return `avatar_${Date.now()}.jpg`;
}

function inferAvatarMimeType(
  asset: ImagePicker.ImagePickerAsset,
  fileName: string
): string {
  if (
    asset.mimeType === 'image/jpeg' ||
    asset.mimeType === 'image/png' ||
    asset.mimeType === 'image/webp'
  ) {
    return asset.mimeType;
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Profile Settings Modal ported from clarify-web/src/components/modals/ProfileSettingsModal.tsx.
 * Allows all authenticated roles to manage their profile photo (Gallery, Camera, or Remove)
 * and update their RA 10173 encrypted Philippine mobile number for Urgent SMS Fallback alerts.
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
  const [selectedAvatarFile, setSelectedAvatarFile] =
    useState<NativeUploadFile | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Reset form state cleanly whenever the modal opens without synchronous setState inside useEffect
  const openSyncKey = visible
    ? `${user?.id ?? 0}:${user?.contact_number ?? ''}:${user?.avatar_url ?? ''}`
    : 'closed';
  const [lastOpenSyncKey, setLastOpenSyncKey] = useState<string>('closed');
  if (openSyncKey !== lastOpenSyncKey) {
    setLastOpenSyncKey(openSyncKey);
    if (visible) {
      setContactNumber(user?.contact_number || '');
      setSelectedAvatarFile(null);
      setRemoveAvatar(false);
      setFieldErrors({});
      setGeneralError(null);
    }
  }

  if (!user) {
    return null;
  }

  const resolvedExistingAvatar = resolveApiAssetUrl(user.avatar_url);
  const effectivePreviewUri = selectedAvatarFile
    ? selectedAvatarFile.uri
    : removeAvatar
      ? null
      : resolvedExistingAvatar;

  const avatarInitial = user.name ? user.name.charAt(0).toUpperCase() : 'U';
  const contactError = getFieldValidationError(fieldErrors, 'contact_number');
  const avatarError = getFieldValidationError(fieldErrors, 'avatar');

  const clearAvatarError = () => {
    setFieldErrors((prev) => {
      if (!prev.avatar) return prev;
      const next = { ...prev };
      delete next.avatar;
      return next;
    });
  };

  const stagePickedAvatar = (asset: ImagePicker.ImagePickerAsset) => {
    const fileName = inferAvatarFileName(asset);
    const mimeType = inferAvatarMimeType(asset, fileName);
    const validation = validateProfileAvatarFile({
      name: fileName,
      size: asset.fileSize,
      type: mimeType,
    });

    if (!validation.valid) {
      setFieldErrors((prev) => ({
        ...prev,
        avatar: [validation.error],
      }));
      return;
    }

    setGeneralError(null);
    clearAvatarError();
    setSelectedAvatarFile({
      uri: asset.uri,
      name: fileName,
      type: mimeType,
      size: asset.fileSize,
    });
    setRemoveAvatar(false);
  };

  const handlePickFromGallery = async () => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setFieldErrors((prev) => ({
          ...prev,
          avatar: [
            'Photo library permission is required to choose a profile photo.',
          ],
        }));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }
      stagePickedAvatar(result.assets[0]);
    } catch {
      setGeneralError('Unable to open photo library. Please try again.');
    }
  };

  const handleTakePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setFieldErrors((prev) => ({
          ...prev,
          avatar: ['Camera permission is required to take a profile photo.'],
        }));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }
      stagePickedAvatar(result.assets[0]);
    } catch {
      setGeneralError('Unable to open camera on this device.');
    }
  };

  const handleRemoveAvatar = () => {
    setSelectedAvatarFile(null);
    setRemoveAvatar(true);
    clearAvatarError();
  };

  const handleSave = async () => {
    if (isSaving) return;
    setFieldErrors({});
    setGeneralError(null);

    const trimmedContact = contactNumber.trim();
    if (trimmedContact && !normalizePhilippineMobileNumber(trimmedContact)) {
      setFieldErrors({
        contact_number: [
          'Please enter a valid Philippine mobile number (e.g., +639171234567 or 09171234567).',
        ],
      });
      return;
    }

    setIsSaving(true);
    try {
      const formData = buildProfileUpdateFormData({
        contactNumber: trimmedContact,
        avatarFile: selectedAvatarFile,
        removeAvatar,
        existingAvatarUrl: user.avatar_url,
      });

      const res = await updateProfileApi(formData);
      if (res?.data) {
        setUser(res.data);
      }
      showToast(res?.message || 'Profile settings saved.', 'success');
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else if (apiErr.status !== 401) {
        setGeneralError(
          apiErr.message || 'Failed to update profile settings.'
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!isSaving) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.card}>
          {/* Navy Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Feather name="user" size={18} color={colors.ustpGold} />
              <Text style={styles.headerTitle}>Profile Settings</Text>
            </View>
            <Pressable
              onPress={onClose}
              disabled={isSaving}
              accessibilityRole="button"
              accessibilityLabel="Close Profile Settings"
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="x" size={20} color={colors.white} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {generalError && (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Feather
                  name="alert-circle"
                  size={16}
                  color={colors.dangerBorder}
                />
                <Text style={styles.errorBannerText}>{generalError}</Text>
              </View>
            )}

            {/* Profile Photo + Identity Summary */}
            <View style={styles.avatarCard}>
              <View style={styles.avatarHeaderRow}>
                <View style={styles.avatarRing}>
                  {effectivePreviewUri ? (
                    <Image
                      source={{ uri: effectivePreviewUri }}
                      style={styles.avatarImage}
                      accessibilityLabel={`${user.name} profile photo`}
                    />
                  ) : (
                    <Text style={styles.avatarInitial}>{avatarInitial}</Text>
                  )}
                </View>

                <View style={styles.identityCopy}>
                  <Text numberOfLines={1} style={styles.identityName}>
                    {user.name}
                  </Text>
                  <Text style={styles.identityMeta}>
                    {user.institutional_id} •{' '}
                    {user.role.replace('_', ' ').toUpperCase()}
                  </Text>
                  <Text numberOfLines={1} style={styles.identityEmail}>
                    {user.email}
                  </Text>
                </View>
              </View>

              {/* Gallery, Camera, and Remove Photo Controls */}
              <View style={styles.avatarActionsRow}>
                <Pressable
                  onPress={() => void handlePickFromGallery()}
                  disabled={isSaving}
                  accessibilityRole="button"
                  accessibilityLabel="Choose profile photo from gallery"
                  style={({ pressed }) => [
                    styles.avatarActionBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="image" size={15} color={colors.ustpNavy} />
                  <Text style={styles.avatarActionText}>Gallery</Text>
                </Pressable>

                <Pressable
                  onPress={() => void handleTakePhoto()}
                  disabled={isSaving}
                  accessibilityRole="button"
                  accessibilityLabel="Take profile photo with camera"
                  style={({ pressed }) => [
                    styles.avatarActionBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="camera" size={15} color={colors.ustpNavy} />
                  <Text style={styles.avatarActionText}>Camera</Text>
                </Pressable>

                {effectivePreviewUri && (
                  <Pressable
                    onPress={handleRemoveAvatar}
                    disabled={isSaving}
                    accessibilityRole="button"
                    accessibilityLabel="Remove profile photo"
                    style={({ pressed }) => [
                      styles.avatarRemoveBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Feather
                      name="trash-2"
                      size={15}
                      color={colors.dangerBorder}
                    />
                    <Text style={styles.avatarRemoveText}>Remove</Text>
                  </Pressable>
                )}
              </View>

              <Text style={styles.avatarHint}>
                JPG, PNG, or WEBP up to 5 MB. Updates your avatar across
                navigation and Course Hub chats.
              </Text>

              {avatarError && (
                <Text style={styles.fieldErrorText} accessibilityRole="alert">
                  {avatarError}
                </Text>
              )}
            </View>

            {/* Encrypted Mobile Number Input */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                Mobile Number (Urgent SMS Fallback)
              </Text>
              <View style={styles.inputRow}>
                <Feather
                  name="phone"
                  size={16}
                  color={colors.mutedSlate}
                  style={styles.inputIcon}
                />
                <TextInput
                  value={contactNumber}
                  onChangeText={setContactNumber}
                  placeholder="+63 917 123 4567"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="phone-pad"
                  editable={!isSaving}
                  accessibilityLabel="Mobile number for urgent SMS fallback"
                  style={[
                    styles.input,
                    contactError && styles.inputBorderError,
                  ]}
                />
              </View>
              {contactError ? (
                <Text style={styles.fieldErrorText} accessibilityRole="alert">
                  {contactError}
                </Text>
              ) : (
                <View style={styles.privacyHintRow}>
                  <Feather name="shield" size={13} color={colors.successText} />
                  <Text style={styles.privacyHintText}>
                    Encrypted at rest under RA 10173 (Data Privacy Act).
                  </Text>
                </View>
              )}
            </View>

            {/* Actions */}
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
                accessibilityLabel="Save profile settings"
                style={({ pressed }) => [
                  styles.saveButton,
                  isSaving && styles.saveButtonDisabled,
                  pressed && !isSaving && styles.pressed,
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Feather name="save" size={16} color={colors.ustpGold} />
                )}
                <Text style={styles.saveButtonText}>
                  {isSaving ? 'Saving...' : 'Save Settings'}
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
  overlay: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: '90%',
    overflow: 'hidden',
    ...elevation.overlay,
  },
  header: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.sizes.bodyLg,
    lineHeight: typography.lineHeights.bodyLg,
    fontWeight: '800',
    color: colors.white,
  },
  closeButton: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  errorBannerText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.dangerText,
  },
  avatarCard: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  avatarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarRing: {
    width: 68,
    height: 68,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.ustpGold,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 68,
    height: 68,
  },
  avatarInitial: {
    fontSize: typography.sizes.titleLg,
    fontWeight: '900',
    color: colors.ustpGold,
  },
  identityCopy: {
    flex: 1,
    gap: 2,
  },
  identityName: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: '800',
    color: colors.ustpText,
  },
  identityMeta: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  identityEmail: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  avatarActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  avatarActionBtn: {
    flex: 1,
    minWidth: 96,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.ustpNavy,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
  },
  avatarActionText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  avatarRemoveBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.urgentCardBorder,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  avatarRemoveText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.dangerTitle,
  },
  avatarHint: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
  },
  fieldGroup: {
    gap: spacing.xs + 2,
  },
  label: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: spacing.md,
    zIndex: 1,
  },
  input: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingLeft: 40,
    paddingRight: spacing.md,
    fontSize: typography.sizes.body,
    color: colors.ustpText,
    ...typography.tabularNums,
  },
  inputBorderError: {
    borderColor: colors.dangerBorder,
  },
  fieldErrorText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.dangerTitle,
  },
  privacyHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  privacyHintText: {
    flex: 1,
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
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
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
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
    gap: spacing.sm,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.white,
  },
  pressed: {
    opacity: 0.85,
  },
});
