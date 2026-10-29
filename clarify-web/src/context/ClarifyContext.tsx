'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Announcement, Channel, User } from '../types/api';
import {
  getChannelsApi,
  getCurrentMockUser,
  getUseMockApi,
  setUseMockApi,
  switchDemoRole,
} from '../lib/api-client';
import { DEMO_USERS, INITIAL_CHANNELS } from '../mocks/seed-data';

export interface ToastItem {
  id: string;
  message: string;
  variant: 'success' | 'error' | 'info';
}

interface ClarifyContextValue {
  user: User;
  setUser: (user: User) => void;
  switchRole: (role: 'student' | 'faculty' | 'it_admin') => void;
  useMock: boolean;
  toggleApiMode: (nextValue?: boolean) => void;
  isDrawerOpen: boolean;
  setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isChannelModalOpen: boolean;
  setIsChannelModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  announcementModalState: {
    isOpen: boolean;
    editingAnnouncement: Announcement | null;
    defaultChannelId?: number;
  };
  openAnnouncementModal: (options?: {
    editingAnnouncement?: Announcement | null;
    defaultChannelId?: number;
  }) => void;
  closeAnnouncementModal: () => void;
  channels: Channel[];
  refreshChannels: () => Promise<void>;
  announcementVersion: number;
  triggerAnnouncementRefresh: () => void;
  toasts: ToastItem[];
  showToast: (message: string, variant?: ToastItem['variant']) => void;
  dismissToast: (id: string) => void;
}

const ClarifyContext = createContext<ClarifyContextValue | undefined>(undefined);

export function ClarifyProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(DEMO_USERS.student);
  const [useMock, setUseMock] = useState<boolean>(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState<boolean>(false);
  const [announcementModalState, setAnnouncementModalState] = useState<{
    isOpen: boolean;
    editingAnnouncement: Announcement | null;
    defaultChannelId?: number;
  }>({
    isOpen: false,
    editingAnnouncement: null,
    defaultChannelId: 7,
  });
  const [channels, setChannels] = useState<Channel[]>(INITIAL_CHANNELS);
  const [announcementVersion, setAnnouncementVersion] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (message: string, variant: ToastItem['variant'] = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshChannels = useCallback(async () => {
    try {
      const res = await getChannelsApi();
      setChannels(res.data);
    } catch {
      // Retain existing channels if live backend is offline
    }
  }, []);

  useEffect(() => {
    const initialMock = getUseMockApi();
    setUseMock(initialMock);
    setUser(getCurrentMockUser());
    refreshChannels();
  }, [refreshChannels]);

  const switchRole = useCallback(
    (role: 'student' | 'faculty' | 'it_admin') => {
      const nextUser = switchDemoRole(role);
      setUser(nextUser);
      refreshChannels();
      setAnnouncementVersion((v) => v + 1);
      const roleLabels = {
        student: 'Student View (Kobeni Higashiyama • 2020202020)',
        faculty: 'Faculty View (Aki Hayakawa • Faculty ID: 10492)',
        it_admin: 'IT Admin View (Engr. Makima Cruz • ICTO)',
      };
      showToast(`Switched active session to ${roleLabels[role]}`, 'info');
    },
    [refreshChannels, showToast]
  );

  const toggleApiMode = useCallback(
    (nextValue?: boolean) => {
      const target = nextValue !== undefined ? nextValue : !useMock;
      setUseMockApi(target);
      setUseMock(target);
      showToast(
        target
          ? 'API Mode: Client-side USTP Mock Seed active'
          : 'API Mode: Connected to ClariFy REST API (/api/v1)',
        'info'
      );
      refreshChannels();
      setAnnouncementVersion((v) => v + 1);
    },
    [useMock, refreshChannels, showToast]
  );

  const openAnnouncementModal = useCallback(
    (options?: {
      editingAnnouncement?: Announcement | null;
      defaultChannelId?: number;
    }) => {
      setAnnouncementModalState({
        isOpen: true,
        editingAnnouncement: options?.editingAnnouncement || null,
        defaultChannelId: options?.defaultChannelId || 7,
      });
    },
    []
  );

  const closeAnnouncementModal = useCallback(() => {
    setAnnouncementModalState((prev) => ({
      ...prev,
      isOpen: false,
      editingAnnouncement: null,
    }));
  }, []);

  const triggerAnnouncementRefresh = useCallback(() => {
    setAnnouncementVersion((v) => v + 1);
  }, []);

  return (
    <ClarifyContext.Provider
      value={{
        user,
        setUser,
        switchRole,
        useMock,
        toggleApiMode,
        isDrawerOpen,
        setIsDrawerOpen,
        isSettingsModalOpen,
        setIsSettingsModalOpen,
        isChannelModalOpen,
        setIsChannelModalOpen,
        announcementModalState,
        openAnnouncementModal,
        closeAnnouncementModal,
        channels,
        refreshChannels,
        announcementVersion,
        triggerAnnouncementRefresh,
        toasts,
        showToast,
        dismissToast,
      }}
    >
      {children}
    </ClarifyContext.Provider>
  );
}

export function useClarify() {
  const ctx = useContext(ClarifyContext);
  if (!ctx) {
    throw new Error('useClarify must be used inside ClarifyProvider');
  }
  return ctx;
}
