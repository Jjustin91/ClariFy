import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useChannels } from '../context/ChannelsContext';
import {
  createChannelApi,
  deleteChannelApi,
  joinChannelApi,
  leaveChannelApi,
  updateChannelApi,
} from '../lib/api-client';
import {
  formatCourseHubName,
  formatSubChannelDisplayName,
  getCleanChannelDescription,
  getFieldValidationError,
  getSubChannelsForHub,
  isUserCourseAdmin,
  isUserEnrolledInCourseHub,
  isUserPendingInCourseHub,
} from '../lib/domain-logic';
import { getChannelMembersCount } from '../lib/feed-reducer';
import {
  formatCourseHubSubmitName,
  normalizeSubChannelSlug,
  resolveHubChatChannels,
} from '../lib/qa-reducer';
import {
  colors,
  elevation,
  radii,
  spacing,
  touchTarget,
  typography,
} from '../theme';
import type { ApiError, Channel } from '../types/api';

export type CourseHubModalTab =
  | 'browse'
  | 'create_hub'
  | 'create_channel'
  | 'edit_hub';

export interface CourseHubManagerModalProps {
  visible: boolean;
  initialTab: CourseHubModalTab;
  targetHubId?: number | null;
  onClose: () => void;
  onOpenHub: (hubId: number, tab?: 'noticeboard' | 'qa' | 'chat') => void;
  onOpenSubChannel: (hubId: number, subChannelId: number) => void;
  onDeletedHub: (deletedHubId: number) => void;
}

const DEPARTMENT_OPTIONS = [
  { code: 'CITC', label: 'CITC — Info Tech & Computing' },
  { code: 'CEA', label: 'CEA — Engineering & Architecture' },
  { code: 'COT', label: 'COT — College of Technology' },
  { code: 'CSM', label: 'CSM — Science & Mathematics' },
] as const;

function extractEditableHubTitle(hub: Channel): {
  code: string;
  title: string;
} {
  const code = (hub.course_code || '').trim();
  const cleanFull = formatCourseHubName(hub);
  const title =
    code && cleanFull.toLowerCase().startsWith(code.toLowerCase())
      ? cleanFull.slice(code.length).trim() || cleanFull
      : cleanFull;
  return { code, title };
}

/**
 * Course Hub Manager Modal ported from
 * clarify-web/src/components/modals/ChannelRosterModal.tsx.
 *
 * - `browse`: Standalone Browse & Join Course Hubs modal (no top tab bar)
 * - `create_hub`: Standalone Add Course Hub modal (no top tab bar)
 * - `edit_hub` / `create_channel`: Hub management context; shows a 2-tab
 *   `Edit Hub` | `Add Channel` bar for Course Admins and standalone `Add Channel`
 *   for non-admin members.
 */
export function CourseHubManagerModal({
  visible,
  initialTab,
  targetHubId = null,
  onClose,
  onOpenHub,
  onOpenSubChannel,
  onDeletedHub,
}: CourseHubManagerModalProps) {
  const insets = useSafeAreaInsets();
  const { user, showToast } = useAuth();
  const { channels, allCourseHubs, joinedCourseHubs, refreshChannels } =
    useChannels();

  const defaultDept = user?.academic_profile?.department || 'CITC';
  const defaultSection = user?.academic_profile?.section || 'IT3R2';

  const [activeTab, setActiveTab] = useState<CourseHubModalTab>(initialTab);
  const [editingHubId, setEditingHubId] = useState<number | null>(targetHubId);
  const [courseCode, setCourseCode] = useState('');
  const [hubName, setHubName] = useState('');
  const [description, setDescription] = useState('');
  const [scopeDepartment, setScopeDepartment] = useState(defaultDept);
  const [scopeSection, setScopeSection] = useState(defaultSection);

  const [selectedParentHubId, setSelectedParentHubId] = useState<number>(
    targetHubId || joinedCourseHubs[0]?.id || allCourseHubs[0]?.id || 0
  );
  const [subChannelName, setSubChannelName] = useState('');
  const [subChannelTopic, setSubChannelTopic] = useState('');

  const [browseSearch, setBrowseSearch] = useState('');
  const [confirmDeleteHubId, setConfirmDeleteHubId] = useState<number | null>(
    null
  );
  const [isDeletingId, setIsDeletingId] = useState<number | null>(null);
  const [joiningHubId, setJoiningHubId] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Render-time initialization guard (avoids synchronous setState inside useEffect)
  const currentInitKey = visible
    ? `open:${initialTab}:${targetHubId ?? 'none'}`
    : 'closed';
  const [lastInitKey, setLastInitKey] = useState<string>('closed');

  if (currentInitKey !== lastInitKey) {
    setLastInitKey(currentInitKey);
    if (visible) {
      setFieldErrors({});
      setConfirmDeleteHubId(null);
      setActiveTab(initialTab);

      const fallbackParentId =
        targetHubId && allCourseHubs.some((h) => h.id === targetHubId)
          ? targetHubId
          : joinedCourseHubs[0]?.id || allCourseHubs[0]?.id || 0;
      setSelectedParentHubId(fallbackParentId);

      if (initialTab === 'edit_hub') {
        const targetHub =
          allCourseHubs.find((h) => h.id === targetHubId) || allCourseHubs[0];
        if (targetHub) {
          const { code, title } = extractEditableHubTitle(targetHub);
          setEditingHubId(targetHub.id);
          setCourseCode(code);
          setHubName(title);
          setDescription(getCleanChannelDescription(targetHub.description));
          setScopeDepartment(targetHub.scope_department || 'CITC');
          setScopeSection(targetHub.scope_section || 'IT3R2');
        }
      } else if (initialTab === 'create_hub') {
        setEditingHubId(null);
        setCourseCode('');
        setHubName('');
        setDescription('');
        setScopeDepartment(defaultDept);
        setScopeSection(defaultSection);
      } else if (initialTab === 'create_channel') {
        setEditingHubId(fallbackParentId || null);
        setSubChannelName('');
        setSubChannelTopic('');
      } else {
        setBrowseSearch('');
      }
    }
  }

  const populateEditFields = (hub: Channel) => {
    const { code, title } = extractEditableHubTitle(hub);
    setEditingHubId(hub.id);
    setCourseCode(code);
    setHubName(title);
    setDescription(getCleanChannelDescription(hub.description));
    setScopeDepartment(hub.scope_department || 'CITC');
    setScopeSection(hub.scope_section || 'IT3R2');
    setFieldErrors({});
    setConfirmDeleteHubId(null);
  };

  const editingHub = useMemo(
    () =>
      allCourseHubs.find((h) => h.id === editingHubId) ||
      allCourseHubs.find((h) => h.id === targetHubId),
    [allCourseHubs, editingHubId, targetHubId]
  );

  const canAdminEditCurrentHub = isUserCourseAdmin(editingHub, user);

  const selectableParentHubs = useMemo(
    () => (joinedCourseHubs.length > 0 ? joinedCourseHubs : allCourseHubs),
    [joinedCourseHubs, allCourseHubs]
  );

  const targetParentHub = useMemo(
    () =>
      allCourseHubs.find((h) => h.id === selectedParentHubId) ||
      selectableParentHubs[0],
    [allCourseHubs, selectedParentHubId, selectableParentHubs]
  );

  const manageableHub = useMemo(
    () =>
      activeTab === 'edit_hub'
        ? (editingHub ?? targetParentHub)
        : (targetParentHub ?? editingHub),
    [activeTab, editingHub, targetParentHub]
  );

  const showHubAdminTabs =
    (activeTab === 'edit_hub' || activeTab === 'create_channel') &&
    Boolean(manageableHub) &&
    isUserCourseAdmin(manageableHub, user);

  const filteredBrowseHubs = useMemo(() => {
    const q = browseSearch.trim().toLowerCase();
    if (!q) return allCourseHubs;
    return allCourseHubs.filter((hub) =>
      `${hub.name} ${hub.course_code || ''} ${hub.scope_section || ''} ${
        hub.scope_department || ''
      } ${hub.description || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [allCourseHubs, browseSearch]);

  const handleSwitchMode = (nextTab: 'edit_hub' | 'create_channel') => {
    setFieldErrors({});
    setConfirmDeleteHubId(null);
    if (nextTab === 'edit_hub') {
      const hubToEdit = manageableHub ?? editingHub;
      if (hubToEdit) {
        populateEditFields(hubToEdit);
        setSelectedParentHubId(hubToEdit.id);
      }
    } else if (nextTab === 'create_channel') {
      const hubToTarget = manageableHub ?? editingHub;
      if (hubToTarget) {
        setSelectedParentHubId(hubToTarget.id);
      } else if (
        !selectedParentHubId ||
        !allCourseHubs.some((h) => h.id === selectedParentHubId)
      ) {
        setSelectedParentHubId(selectableParentHubs[0]?.id || 0);
      }
      setSubChannelName('');
      setSubChannelTopic('');
    }
    setActiveTab(nextTab);
  };

  const handleJoinChannel = async (channelId: number) => {
    if (joiningHubId !== null) return;
    setJoiningHubId(channelId);
    try {
      const res = await joinChannelApi(channelId);
      await refreshChannels();
      const wasImmediatelyApproved = isUserEnrolledInCourseHub(res.data, user);
      showToast(
        res.message ||
          (wasImmediatelyApproved
            ? 'Joined Course Hub!'
            : 'Join request sent! Waiting for Course Admin approval.'),
        'success'
      );
      if (wasImmediatelyApproved) {
        onClose();
        onOpenHub(channelId, 'noticeboard');
      }
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(apiErr?.message || 'Unable to join Course Hub.', 'error');
    } finally {
      setJoiningHubId(null);
    }
  };

  const handleCancelJoinRequest = async (channelId: number) => {
    if (joiningHubId !== null) return;
    setJoiningHubId(channelId);
    try {
      const res = await leaveChannelApi(channelId);
      await refreshChannels();
      showToast(res.message || 'Join request cancelled.', 'info');
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(
        apiErr?.message || 'Unable to cancel join request.',
        'error'
      );
    } finally {
      setJoiningHubId(null);
    }
  };

  const handleDeleteHub = async (hub: Channel) => {
    if (isDeletingId !== null) return;
    setIsDeletingId(hub.id);
    try {
      const res = await deleteChannelApi(hub.id);
      await refreshChannels();
      setConfirmDeleteHubId(null);
      onClose();
      showToast(
        res.message || `Deleted ${formatCourseHubName(hub)}.`,
        'info'
      );
      onDeletedHub(hub.id);
    } catch (err) {
      const apiErr = err as ApiError;
      showToast(apiErr?.message || 'Failed to delete Course Hub.', 'error');
    } finally {
      setIsDeletingId(null);
    }
  };

  const handleCreateOrUpdateHub = async () => {
    if (isSubmitting) return;
    const isEdit = activeTab === 'edit_hub';
    if (isEdit && (!editingHubId || !canAdminEditCurrentHub)) {
      return;
    }

    const clientErrors: Record<string, string[]> = {};
    if (!courseCode.trim()) {
      clientErrors.course_code = ['Please enter a Course Code (e.g., IT315).'];
    }
    if (!hubName.trim()) {
      clientErrors.name = ['Please enter a Course Hub Name.'];
    }
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    try {
      const formattedHubName = formatCourseHubSubmitName(courseCode, hubName);
      const cleanSection = scopeSection.trim() || defaultSection;
      const cleanDescription =
        description.trim() ||
        `${cleanSection} Scoped Course Hub with built-in Noticeboard Feed and Isolated Q&A Threads.`;

      if (isEdit && editingHubId) {
        const res = await updateChannelApi(editingHubId, {
          course_code: courseCode.trim().toUpperCase(),
          name: formattedHubName,
          description: cleanDescription,
          scope_college: scopeDepartment,
          scope_department: scopeDepartment,
          scope_section: cleanSection,
        });
        await refreshChannels();
        showToast(res.message || 'Course Hub updated successfully!', 'success');
        onClose();
      } else {
        const res = await createChannelApi({
          course_code: courseCode.trim().toUpperCase(),
          name: formattedHubName,
          description: cleanDescription,
          channel_type: 'course_hub',
          scope_college: scopeDepartment,
          scope_department: scopeDepartment,
          scope_section: cleanSection,
        });
        await refreshChannels();
        showToast(
          'Course Hub created with Noticeboard Feed and Isolated Q&A Threads!',
          'success'
        );
        setCourseCode('');
        setHubName('');
        setDescription('');
        onClose();
        if (res.data?.id) {
          onOpenHub(res.data.id, 'noticeboard');
        }
      }
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        showToast(
          apiErr?.message ||
            (isEdit
              ? 'Failed to update Course Hub.'
              : 'Failed to create Course Hub.'),
          'error'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateSubChannel = async () => {
    if (isSubmitting) return;

    const parentHub = targetParentHub;
    if (!parentHub) {
      showToast('Please create or join a Course Hub first.', 'error');
      return;
    }

    const rawChannelSlug = normalizeSubChannelSlug(subChannelName);
    if (!rawChannelSlug) {
      setFieldErrors({
        name: ['Please enter a channel name (e.g., project-groups).'],
      });
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    try {
      const res = await createChannelApi({
        course_code: parentHub.course_code || 'HUB',
        name: `# ${rawChannelSlug}`,
        description: `[HUB:${parentHub.id}] ${
          subChannelTopic.trim() ||
          `Channel inside ${formatCourseHubName(parentHub)}`
        }`,
        channel_type: 'course_hub',
        scope_college: parentHub.scope_college || 'CITC',
        scope_department: parentHub.scope_department || 'CITC',
        scope_section: parentHub.scope_section || 'IT3R2',
      });
      await refreshChannels();
      showToast(
        `Created # ${rawChannelSlug} inside ${formatCourseHubName(parentHub)}!`,
        'success'
      );
      setSubChannelName('');
      setSubChannelTopic('');
      onClose();
      if (res.data?.id) {
        onOpenSubChannel(parentHub.id, res.data.id);
      }
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        showToast(apiErr?.message || 'Failed to create channel.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const nameError = getFieldValidationError(fieldErrors, 'name');
  const codeError = getFieldValidationError(fieldErrors, 'course_code');
  const sectionError = getFieldValidationError(fieldErrors, 'scope_section');

  const headerIcon: React.ComponentProps<typeof Feather>['name'] =
    activeTab === 'create_channel'
      ? 'hash'
      : activeTab === 'edit_hub'
        ? 'edit-3'
        : activeTab === 'browse'
          ? 'search'
          : 'folder-plus';

  const headerTitle =
    activeTab === 'create_channel' && targetParentHub
      ? `Add Channel · ${formatCourseHubName(targetParentHub)}`
      : activeTab === 'edit_hub'
        ? 'Edit Course Hub'
        : activeTab === 'browse'
          ? `Browse Course Hubs (${allCourseHubs.length})`
          : 'Add Course Hub';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!isSubmitting && isDeletingId === null) onClose();
      }}
    >
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!isSubmitting && isDeletingId === null) onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel="Close Course Hub manager backdrop"
        />

        <View
          style={[
            styles.modalSheet,
            {
              marginTop: Math.max(insets.top + spacing.md, spacing.xl),
              marginBottom: Math.max(insets.bottom + spacing.md, spacing.xl),
            },
          ]}
        >
          {/* Navy Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Feather name={headerIcon} size={18} color={colors.ustpGold} />
              <Text numberOfLines={1} style={styles.headerTitle}>
                {headerTitle}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                if (!isSubmitting && isDeletingId === null) onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Close Course Hub modal"
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="x" size={20} color={colors.white} />
            </Pressable>
          </View>

          {/* 2-Tab Switcher shown ONLY in Hub Management context (Edit Hub / Add Channel) for Course Admins */}
          {showHubAdminTabs && (
            <View style={styles.modeTabsBar}>
              <Pressable
                onPress={() => handleSwitchMode('edit_hub')}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === 'edit_hub' }}
                accessibilityLabel="Edit Course Hub tab"
                style={({ pressed }) => [
                  styles.modeTab,
                  activeTab === 'edit_hub' && styles.modeTabActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    activeTab === 'edit_hub' && styles.modeTabTextActive,
                  ]}
                >
                  Edit Hub
                </Text>
              </Pressable>

              <Pressable
                onPress={() => handleSwitchMode('create_channel')}
                accessibilityRole="tab"
                accessibilityState={{
                  selected: activeTab === 'create_channel',
                }}
                accessibilityLabel="Add Channel tab"
                style={({ pressed }) => [
                  styles.modeTab,
                  activeTab === 'create_channel' && styles.modeTabActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    activeTab === 'create_channel' && styles.modeTabTextActive,
                  ]}
                >
                  Add Channel
                </Text>
              </Pressable>
            </View>
          )}

          <ScrollView
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 1. ADD / EDIT COURSE HUB FORM */}
            {(activeTab === 'create_hub' || activeTab === 'edit_hub') && (
              <View style={styles.formStack}>
                {activeTab === 'create_hub' && (
                  <View style={styles.infoBanner}>
                    <View style={styles.infoBannerTitleRow}>
                      <Feather
                        name="book-open"
                        size={14}
                        color={colors.ustpOrange}
                      />
                      <Text style={styles.infoBannerTitle}>
                        Built-in Course Hub Spaces
                      </Text>
                    </View>
                    <Text style={styles.infoBannerBody}>
                      Every new Course Hub automatically includes Noticeboard
                      Feed and Isolated Q&amp;A Threads. Add custom chat
                      channels anytime using Add Channel.
                    </Text>
                  </View>
                )}

                {activeTab === 'edit_hub' && editingHub && (
                  <View style={styles.adminBanner}>
                    <View style={styles.adminBannerLeft}>
                      <Feather
                        name="shield"
                        size={15}
                        color={colors.ustpOrange}
                      />
                      <Text style={styles.adminBannerTitle}>
                        {user?.role === 'faculty' || user?.role === 'dept_head'
                          ? 'Faculty Course Admin'
                          : 'Course Hub Creator (Course Admin)'}
                      </Text>
                    </View>
                    <View style={styles.adminPill}>
                      <Text style={styles.adminPillText}>COURSE ADMIN</Text>
                    </View>
                  </View>
                )}

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Course Code</Text>
                  <TextInput
                    value={courseCode}
                    onChangeText={(val) => {
                      setCourseCode(val);
                      if (fieldErrors.course_code) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.course_code;
                          return next;
                        });
                      }
                    }}
                    placeholder="e.g., IT315"
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="characters"
                    editable={!isSubmitting}
                    accessibilityLabel="Course Code"
                    style={[
                      styles.input,
                      styles.monoInput,
                      codeError ? styles.inputError : null,
                    ]}
                  />
                  {codeError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {codeError}
                    </Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Course Hub Name</Text>
                  <TextInput
                    value={hubName}
                    onChangeText={(val) => {
                      setHubName(val);
                      if (fieldErrors.name) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.name;
                          return next;
                        });
                      }
                    }}
                    placeholder="e.g., Capstone 1 or Information Assurance"
                    placeholderTextColor={colors.placeholder}
                    editable={!isSubmitting}
                    accessibilityLabel="Course Hub Name"
                    style={[styles.input, nameError ? styles.inputError : null]}
                  />
                  {nameError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {nameError}
                    </Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    College / Department Scope
                  </Text>
                  <View style={styles.deptChipsRow}>
                    {DEPARTMENT_OPTIONS.map((dept) => {
                      const isSelected = scopeDepartment === dept.code;
                      return (
                        <Pressable
                          key={dept.code}
                          onPress={() => setScopeDepartment(dept.code)}
                          disabled={isSubmitting}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          accessibilityLabel={dept.label}
                          style={({ pressed }) => [
                            styles.deptChip,
                            isSelected && styles.deptChipActive,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text
                            style={[
                              styles.deptChipText,
                              isSelected && styles.deptChipTextActive,
                            ]}
                          >
                            {dept.code}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Target Class Section</Text>
                  <TextInput
                    value={scopeSection}
                    onChangeText={setScopeSection}
                    placeholder="e.g., IT3R2"
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="characters"
                    editable={!isSubmitting}
                    accessibilityLabel="Target Class Section"
                    style={[
                      styles.input,
                      styles.monoInput,
                      sectionError ? styles.inputError : null,
                    ]}
                  />
                  {sectionError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {sectionError}
                    </Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Course Hub Description</Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Describe the course hub scope, consultation schedule, and Q&A guidelines..."
                    placeholderTextColor={colors.placeholder}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    editable={!isSubmitting}
                    accessibilityLabel="Course Hub Description"
                    style={styles.textArea}
                  />
                </View>

                {/* Primary Save / Create Actions */}
                <View style={styles.formActionsRow}>
                  <Pressable
                    onPress={onClose}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => void handleCreateOrUpdateHub()}
                    disabled={
                      isSubmitting ||
                      (activeTab === 'edit_hub' && !canAdminEditCurrentHub)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      activeTab === 'edit_hub'
                        ? 'Save Course Hub changes'
                        : 'Create Course Hub'
                    }
                    style={({ pressed }) => [
                      styles.primarySubmitBtn,
                      (isSubmitting ||
                        (activeTab === 'edit_hub' &&
                          !canAdminEditCurrentHub)) &&
                        styles.disabledBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color={colors.ustpGold} />
                    ) : (
                      <>
                        <Feather
                          name={activeTab === 'edit_hub' ? 'edit-3' : 'plus'}
                          size={15}
                          color={colors.ustpGold}
                        />
                        <Text style={styles.primarySubmitText}>
                          {activeTab === 'edit_hub'
                            ? 'Save Changes'
                            : 'Create Course Hub'}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>

                {/* Course Admin Danger Zone: Delete Course Hub */}
                {activeTab === 'edit_hub' &&
                  editingHub &&
                  canAdminEditCurrentHub && (
                    <View style={styles.dangerZone}>
                      {confirmDeleteHubId === editingHub.id ? (
                        <View style={styles.confirmDeleteCard}>
                          <Text style={styles.confirmDeletePrompt}>
                            Delete {formatCourseHubName(editingHub)} and its
                            channels permanently?
                          </Text>
                          <View style={styles.confirmDeleteActions}>
                            <Pressable
                              disabled={isDeletingId === editingHub.id}
                              onPress={() => void handleDeleteHub(editingHub)}
                              accessibilityRole="button"
                              accessibilityLabel="Confirm delete Course Hub"
                              style={({ pressed }) => [
                                styles.confirmDeleteBtn,
                                isDeletingId === editingHub.id &&
                                  styles.disabledBtn,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.confirmDeleteBtnText}>
                                {isDeletingId === editingHub.id
                                  ? 'Deleting...'
                                  : 'Confirm Delete'}
                              </Text>
                            </Pressable>
                            <Pressable
                              disabled={isDeletingId === editingHub.id}
                              onPress={() => setConfirmDeleteHubId(null)}
                              accessibilityRole="button"
                              accessibilityLabel="Cancel delete Course Hub"
                              style={styles.cancelInlineBtn}
                            >
                              <Text style={styles.cancelInlineText}>
                                Cancel
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => setConfirmDeleteHubId(editingHub.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${formatCourseHubName(editingHub)}`}
                          style={({ pressed }) => [
                            styles.deleteHubBtn,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Feather
                            name="trash-2"
                            size={15}
                            color={colors.dangerText}
                          />
                          <Text style={styles.deleteHubBtnText}>
                            Delete Course Hub
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  )}
              </View>
            )}

            {/* 2. ADD CHANNEL INSIDE A COURSE HUB */}
            {activeTab === 'create_channel' && (
              <View style={styles.formStack}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Parent Course Hub</Text>
                  {selectableParentHubs.length === 0 ? (
                    <View style={styles.emptyNoticeBox}>
                      <Text style={styles.emptyNoticeText}>
                        No Course Hubs available yet. Create or join a Course
                        Hub first.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.parentHubList}>
                      {selectableParentHubs.map((hub) => {
                        const isSelected = targetParentHub?.id === hub.id;
                        return (
                          <Pressable
                            key={String(hub.id)}
                            onPress={() => setSelectedParentHubId(hub.id)}
                            disabled={isSubmitting}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: isSelected }}
                            accessibilityLabel={`Select parent hub ${formatCourseHubName(hub)}`}
                            style={({ pressed }) => [
                              styles.parentHubOption,
                              isSelected && styles.parentHubOptionActive,
                              pressed && styles.pressed,
                            ]}
                          >
                            <View
                              style={[
                                styles.radioOuter,
                                isSelected && styles.radioOuterActive,
                              ]}
                            >
                              {isSelected && <View style={styles.radioInner} />}
                            </View>
                            <View style={styles.parentHubCopy}>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.parentHubTitle,
                                  isSelected && styles.parentHubTitleActive,
                                ]}
                              >
                                {formatCourseHubName(hub)}
                              </Text>
                              <Text style={styles.parentHubMeta}>
                                {hub.scope_section || 'IT3R2'} •{' '}
                                {hub.scope_department || 'CITC'}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Channel Name</Text>
                  <View
                    style={[
                      styles.hashInputWrap,
                      nameError ? styles.inputError : null,
                    ]}
                  >
                    <Text style={styles.hashPrefix}>#</Text>
                    <TextInput
                      value={subChannelName}
                      onChangeText={(val) => {
                        setSubChannelName(val);
                        if (fieldErrors.name) {
                          setFieldErrors((prev) => {
                            const next = { ...prev };
                            delete next.name;
                            return next;
                          });
                        }
                      }}
                      placeholder="e.g., project-groups, lecture-notes, lab-help"
                      placeholderTextColor={colors.placeholder}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!isSubmitting}
                      accessibilityLabel="Channel Name"
                      style={styles.hashInput}
                    />
                  </View>
                  {nameError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {nameError}
                    </Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    Channel Topic / Purpose (Optional)
                  </Text>
                  <TextInput
                    value={subChannelTopic}
                    onChangeText={setSubChannelTopic}
                    placeholder="Coordinate deliverables, share reviewers, or discuss lab exercises..."
                    placeholderTextColor={colors.placeholder}
                    editable={!isSubmitting}
                    accessibilityLabel="Channel Topic optional"
                    style={styles.input}
                  />
                </View>

                <View style={styles.formActionsRow}>
                  <Pressable
                    onPress={onClose}
                    disabled={isSubmitting}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel adding channel"
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => void handleCreateSubChannel()}
                    disabled={isSubmitting || !targetParentHub}
                    accessibilityRole="button"
                    accessibilityLabel="Add Channel"
                    style={({ pressed }) => [
                      styles.primarySubmitBtn,
                      (isSubmitting || !targetParentHub) && styles.disabledBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color={colors.ustpGold} />
                    ) : (
                      <>
                        <Feather name="plus" size={15} color={colors.ustpGold} />
                        <Text style={styles.primarySubmitText}>
                          Add Channel
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            )}

            {/* 3. BROWSE COURSE HUBS */}
            {activeTab === 'browse' && (
              <View style={styles.browseStack}>
                <View style={styles.searchWrap}>
                  <Feather name="search" size={15} color={colors.mutedSlate} />
                  <TextInput
                    value={browseSearch}
                    onChangeText={setBrowseSearch}
                    placeholder="Search hubs by code, name, section, or college..."
                    placeholderTextColor={colors.placeholder}
                    accessibilityLabel="Search Course Hubs"
                    style={styles.searchInput}
                  />
                  {browseSearch.length > 0 && (
                    <Pressable
                      onPress={() => setBrowseSearch('')}
                      accessibilityRole="button"
                      accessibilityLabel="Clear search"
                      style={styles.clearSearchBtn}
                    >
                      <Feather name="x" size={14} color={colors.mutedSlate} />
                    </Pressable>
                  )}
                </View>

                {filteredBrowseHubs.length === 0 ? (
                  <View style={styles.emptyNoticeBox}>
                    <Text style={styles.emptyNoticeTitle}>
                      No Course Hubs Found
                    </Text>
                    <Text style={styles.emptyNoticeText}>
                      Try a different search term or create a new Course Hub for
                      your class.
                    </Text>
                  </View>
                ) : (
                  filteredBrowseHubs.map((hub) => {
                    const enrolledCount = getChannelMembersCount(hub);
                    const hubSubChannels = getSubChannelsForHub(
                      channels,
                      hub.id
                    );
                    const { chatChannels } = resolveHubChatChannels(
                      hub,
                      hubSubChannels
                    );
                    const isJoined = isUserEnrolledInCourseHub(hub, user);
                    const isPending = isUserPendingInCourseHub(hub, user);
                    const isHubCourseAdmin = isUserCourseAdmin(hub, user);
                    const isBusy = joiningHubId === hub.id;
                    const cleanDesc = getCleanChannelDescription(
                      hub.description
                    );

                    return (
                      <View key={String(hub.id)} style={styles.browseCard}>
                        <View style={styles.browseTitleRow}>
                          <Text style={styles.browseHubName}>
                            {formatCourseHubName(hub)}
                          </Text>
                          {isJoined && (
                            <View style={styles.joinedPill}>
                              <Feather
                                name="check-circle"
                                size={12}
                                color={colors.successText}
                              />
                              <Text style={styles.joinedPillText}>Joined</Text>
                            </View>
                          )}
                          {isPending && !isJoined && (
                            <View style={styles.pendingPill}>
                              <Feather
                                name="clock"
                                size={12}
                                color={colors.warningText}
                              />
                              <Text style={styles.pendingPillText}>
                                Pending Approval
                              </Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.browseScopeMeta}>
                          {hub.scope_section || 'IT3R2'} •{' '}
                          {hub.scope_department || 'CITC'}
                        </Text>

                        {cleanDesc.length > 0 && (
                          <Text numberOfLines={2} style={styles.browseDesc}>
                            {cleanDesc}
                          </Text>
                        )}

                        <Text style={styles.browseCounters}>
                          {enrolledCount}{' '}
                          {enrolledCount === 1 ? 'member' : 'members'} •{' '}
                          {hub.unread_count || 0} open{' '}
                          {hub.unread_count === 1 ? 'inquiry' : 'inquiries'} •{' '}
                          {hub.chat_messages_count || 0}{' '}
                          {hub.chat_messages_count === 1 ? 'chat' : 'chats'}
                        </Text>

                        {/* Built-in & Sub-Channel Preview */}
                        <View style={styles.spacesPreviewRow}>
                          <Text style={styles.spacePreviewItem}>
                            Noticeboard Feed
                          </Text>
                          <Text style={styles.spacePreviewDot}>·</Text>
                          <Text style={styles.spacePreviewItem}>
                            Isolated Q&amp;A Threads
                          </Text>
                          {chatChannels.map((ch) => (
                            <React.Fragment key={String(ch.id)}>
                              <Text style={styles.spacePreviewDot}>·</Text>
                              <Text style={styles.spacePreviewMono}>
                                {formatSubChannelDisplayName(ch)}
                              </Text>
                            </React.Fragment>
                          ))}
                        </View>

                        {/* Action Buttons */}
                        <View style={styles.browseActionsRow}>
                          {isJoined ? (
                            <Pressable
                              onPress={() => {
                                onClose();
                                onOpenHub(hub.id, 'noticeboard');
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`Open ${formatCourseHubName(hub)}`}
                              style={({ pressed }) => [
                                styles.openHubBtn,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.openHubBtnText}>
                                Open Hub
                              </Text>
                              <Feather
                                name="arrow-right"
                                size={14}
                                color={colors.ustpGold}
                              />
                            </Pressable>
                          ) : isPending ? (
                            <Pressable
                              disabled={isBusy}
                              onPress={() =>
                                void handleCancelJoinRequest(hub.id)
                              }
                              accessibilityRole="button"
                              accessibilityLabel={`Cancel pending join request for ${formatCourseHubName(hub)}`}
                              style={({ pressed }) => [
                                styles.cancelPendingBtn,
                                isBusy && styles.disabledBtn,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Feather
                                name="clock"
                                size={14}
                                color={colors.warningText}
                              />
                              <Text style={styles.cancelPendingBtnText}>
                                {isBusy
                                  ? 'Updating...'
                                  : 'Pending Approval (Cancel)'}
                              </Text>
                            </Pressable>
                          ) : (
                            <Pressable
                              disabled={isBusy}
                              onPress={() => void handleJoinChannel(hub.id)}
                              accessibilityRole="button"
                              accessibilityLabel={`${
                                isHubCourseAdmin
                                  ? 'Join Course Hub'
                                  : 'Request to Join'
                              } ${formatCourseHubName(hub)}`}
                              style={({ pressed }) => [
                                styles.joinHubBtn,
                                isBusy && styles.disabledBtn,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Feather
                                name="plus"
                                size={14}
                                color={colors.ustpNavy}
                              />
                              <Text style={styles.joinHubBtnText}>
                                {isBusy
                                  ? 'Submitting...'
                                  : isHubCourseAdmin
                                    ? 'Join Course Hub'
                                    : 'Request to Join'}
                              </Text>
                            </Pressable>
                          )}

                          {isJoined && (
                            <Pressable
                              onPress={() => {
                                setEditingHubId(hub.id);
                                setSelectedParentHubId(hub.id);
                                setSubChannelName('');
                                setSubChannelTopic('');
                                setFieldErrors({});
                                setActiveTab('create_channel');
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`Add Channel in ${formatCourseHubName(hub)}`}
                              style={({ pressed }) => [
                                styles.secondarySmallBtn,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Feather
                                name="plus"
                                size={13}
                                color={colors.ustpNavy}
                              />
                              <Text style={styles.secondarySmallBtnText}>
                                Add Channel
                              </Text>
                            </Pressable>
                          )}

                          {isHubCourseAdmin && (
                            <Pressable
                              onPress={() => {
                                populateEditFields(hub);
                                setSelectedParentHubId(hub.id);
                                setActiveTab('edit_hub');
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={`Edit ${formatCourseHubName(hub)}`}
                              style={({ pressed }) => [
                                styles.secondarySmallBtn,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Feather
                                name="edit-3"
                                size={13}
                                color={colors.ustpNavy}
                              />
                              <Text style={styles.secondarySmallBtnText}>
                                Edit
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayBackdrop,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  modalSheet: {
    maxHeight: '90%',
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    ...elevation.overlay,
  },
  header: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  headerTitle: {
    flex: 1,
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.white,
  },
  closeBtn: {
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabsBar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSubtle,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    gap: spacing.xs,
  },
  modeTab: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  modeTabActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  modeTabText: {
    fontSize: typography.sizes.xxs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  modeTabTextActive: {
    color: colors.ustpGold,
  },
  bodyContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  formStack: {
    gap: spacing.md,
  },
  infoBanner: {
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  infoBannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  infoBannerTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  infoBannerBody: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
  },
  adminBanner: {
    backgroundColor: colors.ustpCream,
    borderWidth: 1,
    borderColor: colors.tagMemoBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  adminBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  adminBannerTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  adminPill: {
    backgroundColor: colors.ustpNavy,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  adminPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  input: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.sizes.sm,
    color: colors.ustpText,
  },
  monoInput: {
    fontFamily: typography.fontFamilyMono,
  },
  textArea: {
    minHeight: 88,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    color: colors.ustpText,
  },
  inputError: {
    borderColor: colors.dangerBorder,
  },
  fieldError: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.dangerText,
  },
  deptChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  deptChip: {
    minHeight: 44,
    minWidth: 68,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deptChipActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  deptChipText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  deptChipTextActive: {
    color: colors.ustpGold,
  },
  formActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  secondaryBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  primarySubmitBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  primarySubmitText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  dangerZone: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  deleteHubBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  deleteHubBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.dangerText,
  },
  confirmDeleteCard: {
    backgroundColor: colors.dangerBg,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  confirmDeletePrompt: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.dangerTitle,
  },
  confirmDeleteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  confirmDeleteBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.white,
  },
  cancelInlineBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelInlineText: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  parentHubList: {
    gap: spacing.xs + 2,
  },
  parentHubOption: {
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  parentHubOptionActive: {
    borderColor: colors.ustpNavy,
    backgroundColor: colors.tagCourseHubBg,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.mutedSlate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: {
    borderColor: colors.ustpNavy,
  },
  radioInner: {
    width: 9,
    height: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.ustpNavy,
  },
  parentHubCopy: {
    flex: 1,
    gap: 1,
  },
  parentHubTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '700',
    color: colors.ustpText,
  },
  parentHubTitleActive: {
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  parentHubMeta: {
    fontSize: typography.sizes.xxs,
    color: colors.mutedSlate,
  },
  hashInputWrap: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  hashPrefix: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.mutedSlate,
    fontFamily: typography.fontFamilyMono,
  },
  hashInput: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    fontSize: typography.sizes.sm,
    fontFamily: typography.fontFamilyMono,
    color: colors.ustpText,
  },
  browseStack: {
    gap: spacing.md,
  },
  searchWrap: {
    minHeight: touchTarget.minHeight,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    fontSize: typography.sizes.sm,
    color: colors.ustpText,
  },
  clearSearchBtn: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyNoticeBox: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyNoticeTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  emptyNoticeText: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
    textAlign: 'center',
  },
  browseCard: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs + 2,
  },
  browseTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  browseHubName: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  joinedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  joinedPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.successText,
  },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  pendingPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.warningText,
  },
  browseScopeMeta: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.mutedSlate,
  },
  browseDesc: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.ustpText,
  },
  browseCounters: {
    fontSize: typography.sizes.xxs,
    fontWeight: '700',
    color: colors.mutedSlate,
    ...typography.tabularNums,
  },
  spacesPreviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs + 2,
  },
  spacePreviewItem: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ustpNavy,
  },
  spacePreviewMono: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: typography.fontFamilyMono,
    color: colors.ustpNavy,
  },
  spacePreviewDot: {
    fontSize: 11,
    color: colors.mutedSlate,
  },
  browseActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  openHubBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  openHubBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  joinHubBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.ustpGold,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  joinHubBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  cancelPendingBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cancelPendingBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.warningText,
  },
  secondarySmallBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  secondarySmallBtnText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  disabledBtn: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
  },
});
