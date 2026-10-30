'use client';

import React, { useState } from 'react';
import { Hash, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useClarify } from '../../context/ClarifyContext';
import {
  createChannelApi,
  joinChannelApi,
  manageChannelMemberApi,
} from '../../lib/api-client';
import { getFieldValidationError } from '../../lib/domain-logic';
import type { LaravelValidationError } from '../../types/api';

export function ChannelRosterModal() {
  const {
    channels,
    refreshChannels,
    isChannelModalOpen,
    setIsChannelModalOpen,
    showToast,
  } = useClarify();

  const [activeTab, setActiveTab] = useState<'browse' | 'roster' | 'create'>(
    'browse'
  );
  const [selectedChannelId, setSelectedChannelId] = useState<number>(7);
  const [newMemberId, setNewMemberId] = useState('');
  const [newMemberName, setNewMemberName] = useState('');

  // Create channel fields
  const [courseCode, setCourseCode] = useState('');
  const [channelName, setChannelName] = useState('');
  const [description, setDescription] = useState('');
  const [scopeDepartment, setScopeDepartment] = useState('CITC');
  const [scopeSection, setScopeSection] = useState('IT3R2');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isChannelModalOpen) return null;

  const currentChannel =
    channels.find((c) => c.id === selectedChannelId) || channels[0];

  const handleJoinChannel = async (channelId: number) => {
    try {
      const res = await joinChannelApi(channelId);
      await refreshChannels();
      showToast(res.message || 'Joined channel.', 'success');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Unable to join channel.', 'error');
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    try {
      const res = await manageChannelMemberApi(currentChannel.id, {
        institutional_id: newMemberId,
        name: newMemberName,
        section: currentChannel.scope_section || 'IT3R2',
        action: 'add',
      });
      await refreshChannels();
      setNewMemberId('');
      setNewMemberName('');
      showToast(res.message || 'Student added to roster.', 'success');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'Failed to add member.', 'error');
      }
    }
  };

  const handleRemoveMember = async (institutionalId: string) => {
    try {
      const res = await manageChannelMemberApi(currentChannel.id, {
        institutional_id: institutionalId,
        action: 'remove',
      });
      await refreshChannels();
      showToast(res.message || 'Member removed from roster.', 'info');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      showToast(apiErr.message || 'Failed to remove member.', 'error');
    }
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    try {
      const res = await createChannelApi({
        course_code: courseCode,
        name: channelName,
        description,
        channel_type: 'course_hub',
        scope_college: scopeDepartment,
        scope_department: scopeDepartment,
        scope_section: scopeSection,
      });
      await refreshChannels();
      showToast(res.message || 'Scoped channel created.', 'success');
      setCourseCode('');
      setChannelName('');
      setDescription('');
      setActiveTab('browse');
    } catch (err) {
      const apiErr = err as LaravelValidationError;
      if (apiErr.status === 422 && apiErr.errors) {
        setFieldErrors(apiErr.errors);
      } else {
        showToast(apiErr.message || 'Failed to create channel.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const nameError = getFieldValidationError(fieldErrors, 'name');
  const codeError = getFieldValidationError(fieldErrors, 'course_code');
  const memberError = getFieldValidationError(fieldErrors, 'institutional_id');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-portal-modal-title"
    >
      <div className="bg-white border border-slate-300 rounded-lg shadow-xl w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 bg-ustp-navy text-white">
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-ustp-gold" />
            <h2 id="channel-portal-modal-title" className="text-sm font-bold">
              Scoped Channel Management & Roster Portal (Workflow 5)
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setIsChannelModalOpen(false)}
            aria-label="Close channel management modal"
            className="p-1 rounded hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 pt-4 border-b border-slate-200 bg-ustp-cream">
          <button
            type="button"
            onClick={() => setActiveTab('browse')}
            className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'browse'
                ? 'border-ustp-navy text-ustp-navy'
                : 'border-transparent text-slate-600 hover:text-ustp-text'
            }`}
          >
            Browse & Join Channels
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('roster')}
            className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'roster'
                ? 'border-ustp-navy text-ustp-navy'
                : 'border-transparent text-slate-600 hover:text-ustp-text'
            }`}
          >
            Channel Roster ({currentChannel?.members_count || 42})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'create'
                ? 'border-ustp-navy text-ustp-navy'
                : 'border-transparent text-slate-600 hover:text-ustp-text'
            }`}
          >
            + Create Course Hub
          </button>
        </div>

        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {activeTab === 'browse' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 pb-1">
                <p className="text-xs font-bold text-slate-600">
                  Available Scoped Channels ({channels.length})
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('create')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-ustp-gold text-ustp-navy rounded hover:opacity-95 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Add Channel / Course Hub</span>
                </button>
              </div>
              {channels.map((ch) => (
                <div
                  key={ch.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 bg-slate-50/60"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-ustp-navy">
                        {ch.name}
                      </span>
                      <span className="text-xs font-semibold text-slate-600">
                        · {ch.scope_section} · {ch.scope_department}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {ch.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono tabular-nums text-slate-600">
                      {ch.members_count || 42} enrolled
                    </span>
                    <button
                      type="button"
                      onClick={() => handleJoinChannel(ch.id)}
                      className="px-3 py-1.5 text-xs font-bold bg-ustp-navy text-white rounded hover:opacity-95 cursor-pointer"
                    >
                      Verify / Sync Access
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'roster' && currentChannel && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="roster-channel-select"
                  className="text-xs font-bold text-slate-700"
                >
                  Inspecting Roster for:
                </label>
                <select
                  id="roster-channel-select"
                  value={currentChannel.id}
                  onChange={(e) => setSelectedChannelId(Number(e.target.value))}
                  className="text-xs font-bold text-ustp-navy border border-slate-300 rounded px-3 py-1.5 bg-white"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.scope_section})
                    </option>
                  ))}
                </select>
              </div>

              <form
                onSubmit={handleAddMember}
                className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2"
              >
                <p className="text-xs font-bold text-ustp-navy flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5" />
                  Add Student / Faculty to Channel Roster
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={newMemberId}
                    onChange={(e) => setNewMemberId(e.target.value)}
                    placeholder="ID e.g. 2020201199"
                    className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
                  />
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder="Full Name (optional)"
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-bold bg-ustp-navy text-white rounded hover:opacity-95 cursor-pointer"
                  >
                    + Add to Roster
                  </button>
                </div>
                {memberError && (
                  <p className="text-xs font-semibold text-red-600" role="alert">
                    {memberError}
                  </p>
                )}
              </form>

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
                {(currentChannel.roster || []).map((member) => (
                  <div
                    key={member.institutional_id}
                    className="flex items-center justify-between px-4 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <div>
                        <span className="font-bold text-ustp-text">
                          {member.name}
                        </span>
                        <span className="text-slate-500 font-mono tabular-nums ml-2">
                          ({member.institutional_id})
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-600 font-medium">
                        {member.role.toUpperCase()} · {member.section}
                      </span>
                      {member.role === 'student' && (
                        <button
                          type="button"
                          onClick={() =>
                            handleRemoveMember(member.institutional_id)
                          }
                          aria-label={`Remove ${member.name} from roster`}
                          className="text-red-600 hover:text-red-800 p-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'create' && (
            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-channel-code"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Course Code
                  </label>
                  <input
                    id="new-channel-code"
                    type="text"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    placeholder="e.g., IT315"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded"
                  />
                  {codeError && (
                    <p className="text-xs font-semibold text-red-600 mt-1">
                      {codeError}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="new-channel-name"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Channel Display Name
                  </label>
                  <input
                    id="new-channel-name"
                    type="text"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    placeholder="e.g., # IT315 IT Elective 1"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                  />
                  {nameError && (
                    <p className="text-xs font-semibold text-red-600 mt-1">
                      {nameError}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="new-channel-dept"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Department Scope
                  </label>
                  <select
                    id="new-channel-dept"
                    value={scopeDepartment}
                    onChange={(e) => setScopeDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white"
                  >
                    <option value="CITC">CITC</option>
                    <option value="CEA">CEA</option>
                    <option value="COT">COT</option>
                    <option value="CSM">CSM</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="new-channel-section"
                    className="block text-xs font-bold text-ustp-text mb-1"
                  >
                    Target Section
                  </label>
                  <input
                    id="new-channel-section"
                    type="text"
                    value={scopeSection}
                    onChange={(e) => setScopeSection(e.target.value)}
                    placeholder="IT3R2"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="new-channel-desc"
                  className="block text-xs font-bold text-ustp-text mb-1"
                >
                  Channel Description
                </label>
                <textarea
                  id="new-channel-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Scoped noticeboard and Q&A workspace for..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold bg-ustp-navy text-white rounded hover:opacity-95 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Creating...' : 'Create Scoped Channel'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
