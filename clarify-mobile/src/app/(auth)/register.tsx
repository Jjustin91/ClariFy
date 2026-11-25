import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClarifyLogoWordmark } from '@/components/ClarifyLogo';
import { ErrorBanner } from '@/components/StateViews';
import { useAuth } from '@/context/AuthContext';
import { registerApi } from '@/lib/api-client';
import {
  getFieldValidationError,
  normalizePhilippineMobileNumber,
  normalizeUstpEmail,
  validateUstpEmail,
} from '@/lib/domain-logic';
import { colors, radii, spacing, touchTarget, typography } from '@/theme';
import type { ApiError, User } from '@/types/api';

const DEPARTMENTS = ['CITC', 'CEA', 'COT', 'CSM', 'CSTE'] as const;

/**
 * Student & Faculty Self-Registration screen ported from clarify-web/app/register/page.tsx.
 * Enforces @ustp.edu.ph client-side validation, password >= 8 + confirmation,
 * maps HTTP 422 field errors per input, displays HTTP 429 retry countdown,
 * and shows the "Pending IT Administrator Approval" state upon HTTP 201 success.
 */
export default function MobileRegisterScreen() {
  const router = useRouter();
  const { showToast } = useAuth();

  const [role, setRole] = useState<'student' | 'faculty'>('student');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [institutionalId, setInstitutionalId] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [department, setDepartment] = useState<string>('CITC');
  const [section, setSection] = useState('IT3R2');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<ApiError | null>(null);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number>(0);
  const [registeredUser, setRegisteredUser] = useState<User | null>(null);

  useEffect(() => {
    if (rateLimitSeconds <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setRateLimitSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [rateLimitSeconds]);

  const clearFieldError = (field: string) => {
    if (!fieldErrors[field]) return;
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleRoleSwitch = (nextRole: 'student' | 'faculty') => {
    setRole(nextRole);
    clearFieldError('role');
    if (nextRole === 'faculty' && section === 'IT3R2') {
      setSection(`${department} Dept`);
    } else if (nextRole === 'student' && section.endsWith('Dept')) {
      setSection('IT3R2');
    }
  };

  const handleDepartmentSelect = (dept: string) => {
    setDepartment(dept);
    clearFieldError('department');
    if (role === 'faculty' && section.endsWith('Dept')) {
      setSection(`${dept} Dept`);
    }
  };

  const handleEmailBlur = () => {
    const raw = email.trim();
    if (!raw) return;
    const normalized = normalizeUstpEmail(raw);
    setEmail(normalized);
    const err = validateUstpEmail(normalized);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) {
        next.email = [err];
      } else {
        delete next.email;
      }
      return next;
    });
  };

  const validateClientForm = (): {
    valid: boolean;
    normalizedEmail: string;
    normalizedPhone?: string;
    errors: Record<string, string[]>;
  } => {
    const errors: Record<string, string[]> = {};
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    const trimmedId = institutionalId.trim();
    const normalizedEmail = normalizeUstpEmail(email);
    const trimmedSection = section.trim();
    const trimmedContact = contactNumber.trim();

    if (!trimmedFirstName) {
      errors.first_name = ['First name is required.'];
    } else if (trimmedFirstName.length > 75) {
      errors.first_name = ['First name cannot exceed 75 characters.'];
    }

    if (!trimmedLastName) {
      errors.last_name = ['Last name is required.'];
    } else if (trimmedLastName.length > 75) {
      errors.last_name = ['Last name cannot exceed 75 characters.'];
    }

    if (!trimmedId) {
      errors.institutional_id = ['Institutional ID is required.'];
    } else if (trimmedId.length > 32) {
      errors.institutional_id = ['Institutional ID cannot exceed 32 characters.'];
    }

    const emailErr = validateUstpEmail(normalizedEmail);
    if (emailErr) {
      errors.email = [emailErr];
    }

    let normalizedPhone: string | undefined;
    if (trimmedContact) {
      const parsedPhone = normalizePhilippineMobileNumber(trimmedContact);
      if (!parsedPhone) {
        errors.contact_number = [
          'Please enter a valid Philippine mobile number (e.g., +639171234567 or 09171234567).',
        ];
      } else {
        normalizedPhone = parsedPhone;
      }
    }

    if (!department.trim()) {
      errors.department = ['Please select a college or department.'];
    }

    if (!trimmedSection) {
      errors.section = [
        role === 'faculty'
          ? 'Academic unit or section is required.'
          : 'Class section is required.',
      ];
    } else if (trimmedSection.length > 64) {
      errors.section = ['Section cannot exceed 64 characters.'];
    }

    if (!password) {
      errors.password = ['Password is required.'];
    } else if (password.length < 8) {
      errors.password = ['Password must be at least 8 characters long.'];
    }

    if (password !== confirmPassword) {
      errors.confirm_password = ['Passwords do not match.'];
    }

    return {
      valid: Object.keys(errors).length === 0,
      normalizedEmail,
      normalizedPhone,
      errors,
    };
  };

  const handleSubmit = async () => {
    if (isSubmitting || rateLimitSeconds > 0) {
      return;
    }

    setFieldErrors({});
    setGeneralError(null);

    const validation = validateClientForm();
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      return;
    }

    setEmail(validation.normalizedEmail);
    setIsSubmitting(true);

    try {
      const res = await registerApi({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        institutional_id: institutionalId.trim(),
        email: validation.normalizedEmail,
        contact_number: validation.normalizedPhone,
        password,
        password_confirmation: confirmPassword,
        role,
        department,
        section: section.trim(),
      });

      setRegisteredUser(res.data);
      showToast(
        res.message ||
          'Account registered! Pending IT Administrator approval.',
        'success'
      );
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else if (apiErr?.status === 429) {
        const seconds = apiErr.retryAfter ?? 60;
        setRateLimitSeconds(seconds);
        setGeneralError({
          status: 429,
          retryAfter: seconds,
          message: `Too many attempts, try again in ${seconds} seconds`,
        });
      } else {
        setGeneralError(
          apiErr?.message
            ? apiErr
            : {
                status: apiErr?.status ?? 500,
                message: 'Could not complete registration. Please try again.',
              }
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForAnother = () => {
    setRegisteredUser(null);
    setFirstName('');
    setLastName('');
    setInstitutionalId('');
    setEmail('');
    setContactNumber('');
    setPassword('');
    setConfirmPassword('');
    setFieldErrors({});
    setGeneralError(null);
  };

  const firstNameError = getFieldValidationError(fieldErrors, 'first_name');
  const lastNameError = getFieldValidationError(fieldErrors, 'last_name');
  const idError = getFieldValidationError(fieldErrors, 'institutional_id');
  const emailError = getFieldValidationError(fieldErrors, 'email');
  const contactError = getFieldValidationError(fieldErrors, 'contact_number');
  const departmentError = getFieldValidationError(fieldErrors, 'department');
  const sectionError = getFieldValidationError(fieldErrors, 'section');
  const passwordError = getFieldValidationError(fieldErrors, 'password');
  const confirmPasswordError = getFieldValidationError(
    fieldErrors,
    'confirm_password'
  );
  const roleError = getFieldValidationError(fieldErrors, 'role');

  const isSubmitDisabled = isSubmitting || rateLimitSeconds > 0;

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Institutional Header Card (USTP Navy + Gold Border) */}
          <View style={styles.headerSection}>
            <View style={styles.brandingCard}>
              <View style={styles.logoWrap}>
                <ClarifyLogoWordmark height={44} />
              </View>
              <Text style={styles.pageTitle}>Account Registration</Text>
              <Text style={styles.pageSubtitle}>
                Student &amp; Faculty Campus Portal Sign Up
              </Text>
              <Text style={styles.pageCaption}>
                Create your institutional account using an official @ustp.edu.ph
                email. New accounts require IT Administrator approval before
                sign-in.
              </Text>

              <Pressable
                onPress={() => router.replace('/(auth)/login')}
                accessibilityRole="button"
                accessibilityLabel="Back to Sign In"
                style={({ pressed }) => [
                  styles.backToLoginBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="arrow-left" size={16} color={colors.ustpGold} />
                <Text style={styles.backToLoginText}>Back to Sign In</Text>
              </Pressable>
            </View>
          </View>

          {/* Main Registration Panel (USTP Cream Surface) */}
          <View style={styles.panelSection}>
            {/* STATE 4: Success / Pending IT Administrator Approval */}
            {registeredUser ? (
              <View style={styles.card}>
                <View style={styles.successHeaderRow}>
                  <Feather
                    name="check-circle"
                    size={24}
                    color={colors.successBorder}
                  />
                  <View style={styles.successTitleWrap}>
                    <Text style={styles.successTitle}>
                      Registration Submitted
                    </Text>
                    <Text style={styles.successSubtitle}>
                      Pending IT Administrator Approval
                    </Text>
                  </View>
                </View>

                <Text style={styles.successSummary}>
                  Your{' '}
                  <Text style={styles.boldText}>
                    {registeredUser.role.toUpperCase()}
                  </Text>{' '}
                  account for{' '}
                  <Text style={styles.boldText}>{registeredUser.name}</Text>{' '}
                  (ID:{' '}
                  <Text style={styles.monoBoldText}>
                    {registeredUser.institutional_id}
                  </Text>
                  ) has been submitted for registrar verification.
                </Text>

                <View style={styles.pendingInfoBox} accessibilityRole="alert">
                  <Text style={styles.pendingInfoTitle}>
                    Status: Pending IT Administrator Approval
                  </Text>
                  <Text style={styles.pendingInfoBody}>
                    Before you can sign in to ClariFy Mobile, an IT
                    Administrator must review and approve your registration in
                    the Account Verification Queue.
                  </Text>
                </View>

                <View style={styles.detailSummaryBox}>
                  <Text style={styles.detailRowText}>
                    Email: {registeredUser.email}
                  </Text>
                  <Text style={styles.detailRowText}>
                    Department:{' '}
                    {registeredUser.academic_profile?.department || department}
                  </Text>
                  <Text style={styles.detailRowText}>
                    Section:{' '}
                    {registeredUser.academic_profile?.section || section}
                  </Text>
                </View>

                <View style={styles.successActions}>
                  <Pressable
                    onPress={() => router.replace('/(auth)/login')}
                    accessibilityRole="button"
                    accessibilityLabel="Proceed to Sign In"
                    style={({ pressed }) => [
                      styles.primarySubmitBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.primarySubmitText}>
                      Proceed to Sign In
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={handleResetForAnother}
                    accessibilityRole="button"
                    accessibilityLabel="Register Another Account"
                    style={({ pressed }) => [
                      styles.secondaryBtn,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>
                      Register Another Account
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              /* STATES 1-3: Populated Form, Submitting Skeleton/Progress, and Error States */
              <View style={styles.card}>
                <Text style={styles.cardHeading}>
                  Create Institutional Account
                </Text>

                {/* 429 Rate Limit Banner with Live Countdown */}
                {rateLimitSeconds > 0 && (
                  <View accessibilityRole="alert" style={styles.warningBox}>
                    <Feather
                      name="clock"
                      size={16}
                      color={colors.warningText}
                    />
                    <Text style={styles.warningText}>
                      Too many attempts, try again in {rateLimitSeconds} seconds
                    </Text>
                  </View>
                )}

                {/* 500 / Network / Non-422 Error Banner with Retry */}
                {generalError && generalError.status !== 429 && (
                  <ErrorBanner
                    error={generalError}
                    onRetry={
                      generalError.status === 0 || generalError.status >= 500
                        ? () => void handleSubmit()
                        : undefined
                    }
                  />
                )}

                {/* Submitting Skeleton Bar while request is in flight */}
                {isSubmitting && (
                  <View
                    accessibilityRole="progressbar"
                    accessibilityLabel="Submitting account registration"
                    style={styles.submittingBanner}
                  >
                    <ActivityIndicator size="small" color={colors.ustpNavy} />
                    <Text style={styles.submittingBannerText}>
                      Submitting registration to USTP ClariFy...
                    </Text>
                  </View>
                )}

                {/* Role Selector */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Account Domain Role</Text>
                  <View style={styles.roleRow}>
                    <Pressable
                      onPress={() => handleRoleSwitch('student')}
                      disabled={isSubmitting}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: role === 'student' }}
                      accessibilityLabel="Register as Student"
                      style={({ pressed }) => [
                        styles.roleOption,
                        role === 'student' && styles.roleOptionActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Feather
                        name="book-open"
                        size={16}
                        color={
                          role === 'student' ? colors.ustpGold : colors.ustpText
                        }
                      />
                      <Text
                        style={[
                          styles.roleOptionText,
                          role === 'student' && styles.roleOptionTextActive,
                        ]}
                      >
                        Student
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => handleRoleSwitch('faculty')}
                      disabled={isSubmitting}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: role === 'faculty' }}
                      accessibilityLabel="Register as Faculty"
                      style={({ pressed }) => [
                        styles.roleOption,
                        role === 'faculty' && styles.roleOptionActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Feather
                        name="shield"
                        size={16}
                        color={
                          role === 'faculty' ? colors.ustpGold : colors.ustpText
                        }
                      />
                      <Text
                        style={[
                          styles.roleOptionText,
                          role === 'faculty' && styles.roleOptionTextActive,
                        ]}
                      >
                        Faculty
                      </Text>
                    </Pressable>
                  </View>
                  {roleError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {roleError}
                    </Text>
                  )}
                </View>

                {/* First Name */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>First Name</Text>
                  <TextInput
                    value={firstName}
                    onChangeText={(val) => {
                      setFirstName(val);
                      clearFieldError('first_name');
                    }}
                    placeholder={
                      role === 'faculty' ? 'e.g., Aki' : 'e.g., Juan'
                    }
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="words"
                    autoComplete="given-name"
                    textContentType="givenName"
                    editable={!isSubmitting}
                    accessibilityLabel="First Name"
                    style={[
                      styles.textInput,
                      firstNameError ? styles.inputError : null,
                    ]}
                  />
                  {firstNameError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {firstNameError}
                    </Text>
                  )}
                </View>

                {/* Last Name */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Last Name</Text>
                  <TextInput
                    value={lastName}
                    onChangeText={(val) => {
                      setLastName(val);
                      clearFieldError('last_name');
                    }}
                    placeholder={
                      role === 'faculty' ? 'e.g., Hayakawa' : 'e.g., Dela Cruz'
                    }
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="words"
                    autoComplete="family-name"
                    textContentType="familyName"
                    editable={!isSubmitting}
                    accessibilityLabel="Last Name"
                    style={[
                      styles.textInput,
                      lastNameError ? styles.inputError : null,
                    ]}
                  />
                  {lastNameError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {lastNameError}
                    </Text>
                  )}
                </View>

                {/* Institutional ID */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Institutional ID</Text>
                  <TextInput
                    value={institutionalId}
                    onChangeText={(val) => {
                      setInstitutionalId(val);
                      clearFieldError('institutional_id');
                    }}
                    placeholder={
                      role === 'faculty' ? 'e.g., 10492' : 'e.g., 2023300001'
                    }
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSubmitting}
                    accessibilityLabel="Institutional ID"
                    style={[
                      styles.textInput,
                      styles.monoInput,
                      idError ? styles.inputError : null,
                    ]}
                  />
                  {idError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {idError}
                    </Text>
                  )}
                </View>

                {/* Institutional Email (@ustp.edu.ph) */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Institutional Email</Text>
                  <TextInput
                    value={email}
                    onChangeText={(val) => {
                      setEmail(val);
                      clearFieldError('email');
                    }}
                    onBlur={handleEmailBlur}
                    placeholder="name@ustp.edu.ph"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSubmitting}
                    accessibilityLabel="Institutional Email"
                    style={[
                      styles.textInput,
                      emailError ? styles.inputError : null,
                    ]}
                  />
                  <Text style={styles.helperText}>
                    Must be an official @ustp.edu.ph address
                  </Text>
                  {emailError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {emailError}
                    </Text>
                  )}
                </View>

                {/* Optional Contact Number */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    Mobile Number (Optional, for urgent SMS alerts)
                  </Text>
                  <TextInput
                    value={contactNumber}
                    onChangeText={(val) => {
                      setContactNumber(val);
                      clearFieldError('contact_number');
                    }}
                    placeholder="e.g., 09171234567 or +639171234567"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    editable={!isSubmitting}
                    accessibilityLabel="Optional Mobile Number"
                    style={[
                      styles.textInput,
                      styles.monoInput,
                      contactError ? styles.inputError : null,
                    ]}
                  />
                  {contactError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {contactError}
                    </Text>
                  )}
                </View>

                {/* College / Department Selector */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>College / Department</Text>
                  <View style={styles.deptChipRow}>
                    {DEPARTMENTS.map((dept) => {
                      const active = department === dept;
                      return (
                        <Pressable
                          key={dept}
                          onPress={() => handleDepartmentSelect(dept)}
                          disabled={isSubmitting}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: active }}
                          accessibilityLabel={`Department ${dept}`}
                          style={({ pressed }) => [
                            styles.deptChip,
                            active && styles.deptChipActive,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text
                            style={[
                              styles.deptChipText,
                              active && styles.deptChipTextActive,
                            ]}
                          >
                            {dept}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {departmentError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {departmentError}
                    </Text>
                  )}
                </View>

                {/* Section / Academic Unit */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    {role === 'faculty'
                      ? 'Academic Unit / Section'
                      : 'Class Section'}
                  </Text>
                  <TextInput
                    value={section}
                    onChangeText={(val) => {
                      setSection(val);
                      clearFieldError('section');
                    }}
                    placeholder={
                      role === 'faculty' ? 'e.g., CITC Dept' : 'e.g., IT3R2'
                    }
                    placeholderTextColor={colors.placeholder}
                    autoCapitalize="characters"
                    editable={!isSubmitting}
                    accessibilityLabel={
                      role === 'faculty'
                        ? 'Academic Unit or Section'
                        : 'Class Section'
                    }
                    style={[
                      styles.textInput,
                      sectionError ? styles.inputError : null,
                    ]}
                  />
                  {sectionError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {sectionError}
                    </Text>
                  )}
                </View>

                {/* Password (Min 8 chars) */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Password</Text>
                  <View style={styles.passwordWrap}>
                    <TextInput
                      value={password}
                      onChangeText={(val) => {
                        setPassword(val);
                        clearFieldError('password');
                      }}
                      placeholder="Minimum 8 characters"
                      placeholderTextColor={colors.placeholder}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!isSubmitting}
                      accessibilityLabel="Password"
                      style={[
                        styles.textInput,
                        styles.passwordInput,
                        passwordError ? styles.inputError : null,
                      ]}
                    />
                    <Pressable
                      onPress={() => setShowPassword((prev) => !prev)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      style={styles.eyeButton}
                    >
                      <Feather
                        name={showPassword ? 'eye-off' : 'eye'}
                        size={18}
                        color={colors.mutedSlate}
                      />
                    </Pressable>
                  </View>
                  {passwordError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {passwordError}
                    </Text>
                  )}
                </View>

                {/* Confirm Password */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Confirm Password</Text>
                  <View style={styles.passwordWrap}>
                    <TextInput
                      value={confirmPassword}
                      onChangeText={(val) => {
                        setConfirmPassword(val);
                        clearFieldError('confirm_password');
                      }}
                      placeholder="Re-enter password"
                      placeholderTextColor={colors.placeholder}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={() => void handleSubmit()}
                      editable={!isSubmitting}
                      accessibilityLabel="Confirm Password"
                      style={[
                        styles.textInput,
                        styles.passwordInput,
                        confirmPasswordError ? styles.inputError : null,
                      ]}
                    />
                    <Pressable
                      onPress={() => setShowConfirmPassword((prev) => !prev)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        showConfirmPassword
                          ? 'Hide confirm password'
                          : 'Show confirm password'
                      }
                      style={styles.eyeButton}
                    >
                      <Feather
                        name={showConfirmPassword ? 'eye-off' : 'eye'}
                        size={18}
                        color={colors.mutedSlate}
                      />
                    </Pressable>
                  </View>
                  {confirmPasswordError && (
                    <Text accessibilityRole="alert" style={styles.fieldError}>
                      {confirmPasswordError}
                    </Text>
                  )}
                </View>

                {/* Submit Button */}
                <Pressable
                  onPress={() => void handleSubmit()}
                  disabled={isSubmitDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isSubmitting ? 'Creating account' : 'Create Account'
                  }
                  accessibilityState={{
                    disabled: isSubmitDisabled,
                    busy: isSubmitting,
                  }}
                  style={({ pressed }) => [
                    styles.primarySubmitBtn,
                    isSubmitDisabled && styles.disabledBtn,
                    pressed && !isSubmitDisabled && styles.pressed,
                  ]}
                >
                  {isSubmitting ? (
                    <View style={styles.submitLoadingRow}>
                      <ActivityIndicator size="small" color={colors.ustpGold} />
                      <Text style={styles.primarySubmitText}>
                        Creating Account...
                      </Text>
                    </View>
                  ) : rateLimitSeconds > 0 ? (
                    <Text style={styles.primarySubmitText}>
                      Try again in {rateLimitSeconds}s
                    </Text>
                  ) : (
                    <Text style={styles.primarySubmitText}>Create Account</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.ustpNavy,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: colors.ustpCream,
  },
  headerSection: {
    backgroundColor: colors.ustpNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  brandingCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: colors.ustpGold,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  pageTitle: {
    fontSize: typography.sizes.titleMd,
    lineHeight: typography.lineHeights.titleMd,
    fontWeight: '800',
    color: colors.ustpNavy,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  pageSubtitle: {
    fontSize: typography.sizes.sm,
    lineHeight: typography.lineHeights.sm,
    fontWeight: '700',
    color: colors.ustpBlue,
    textAlign: 'center',
  },
  pageCaption: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.mutedSlate,
    textAlign: 'center',
  },
  backToLoginBtn: {
    marginTop: spacing.sm,
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minWidth,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.ustpNavy,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  backToLoginText: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.ustpGold,
  },
  panelSection: {
    flex: 1,
    backgroundColor: colors.ustpCream,
    padding: spacing.lg,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeading: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  warningBox: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  warningText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.warningText,
    ...typography.tabularNums,
  },
  submittingBanner: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  submittingBannerText: {
    flex: 1,
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.ustpNavy,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '800',
    color: colors.ustpText,
  },
  helperText: {
    fontSize: typography.sizes.xxs,
    lineHeight: typography.lineHeights.xxs,
    color: colors.mutedSlate,
  },
  roleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  roleOption: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  roleOptionActive: {
    backgroundColor: colors.ustpNavy,
    borderColor: colors.ustpNavy,
  },
  roleOptionText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpText,
  },
  roleOptionTextActive: {
    color: colors.ustpGold,
  },
  deptChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  deptChip: {
    minHeight: touchTarget.minHeight,
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
    color: colors.ustpText,
  },
  deptChipTextActive: {
    color: colors.ustpGold,
  },
  textInput: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    backgroundColor: colors.white,
    color: colors.ustpText,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
  },
  monoInput: {
    fontFamily: typography.fontFamilyMono,
    ...typography.tabularNums,
  },
  inputError: {
    borderColor: colors.dangerBorder,
    borderWidth: 2,
  },
  passwordWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 52,
  },
  eyeButton: {
    position: 'absolute',
    right: 0,
    minWidth: touchTarget.minWidth,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldError: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    fontWeight: '700',
    color: colors.dangerTitle,
  },
  primarySubmitBtn: {
    marginTop: spacing.xs,
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.ustpNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySubmitText: {
    fontSize: typography.sizes.body,
    fontWeight: '800',
    color: colors.ustpGold,
    ...typography.tabularNums,
  },
  submitLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  secondaryBtn: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: typography.sizes.sm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  successHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  successTitleWrap: {
    flex: 1,
  },
  successTitle: {
    fontSize: typography.sizes.titleSm,
    lineHeight: typography.lineHeights.titleSm,
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  successSubtitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '700',
    color: colors.successText,
  },
  successSummary: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    color: colors.ustpText,
  },
  boldText: {
    fontWeight: '800',
    color: colors.ustpNavy,
  },
  monoBoldText: {
    fontFamily: typography.fontFamilyMono,
    fontWeight: '800',
    color: colors.ustpNavy,
    ...typography.tabularNums,
  },
  pendingInfoBox: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pendingInfoTitle: {
    fontSize: typography.sizes.xs,
    fontWeight: '800',
    color: colors.warningText,
  },
  pendingInfoBody: {
    fontSize: typography.sizes.xs,
    lineHeight: typography.lineHeights.xs,
    color: colors.warningText,
  },
  detailSummaryBox: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  detailRowText: {
    fontSize: typography.sizes.xs,
    fontWeight: '600',
    color: colors.mutedSlate,
  },
  successActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  disabledBtn: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
  },
});
