# Dedicated Course Hub Modal Views (Add, Browse, & Edit)

Isolate the **+ Add Course Hub**, **Browse Course Hubs**, and **Edit Course Hub** modal views so each action opens its own clean, dedicated modal without cross-tab navigation clutter.

## User Review & Critical Decisions

> [!IMPORTANT]
> Each Course Hub modal view will now render as a focused, single-purpose dialog matching the action clicked by the user:
> - **Edit Course Hub**: Removes the `+ Add Course Hub` and `Browse Course Hubs` tabs so only the Edit Course Hub form is shown.
> - **Browse Course Hubs**: Removes the `+ Add Course Hub` tab and the inline `+ Add Course Hub` button next to the search bar.
> - **+ Add Course Hub**: Removes the `Browse Course Hubs` tab so only the Create Course Hub form is shown.

## 1. Overview & Core Concept

- **What It Does**: Streamlines `ChannelRosterModal` so each modal mode (`create_hub`, `browse`, `edit_hub`, and `create_channel`) has a dedicated header title and body without secondary tab bars mixing unrelated actions.
- **Target Audience / Persona**: USTP Faculty and Students creating, editing, or browsing Course Hubs.
- **Key Value**: Eliminates redundant navigation tabs inside the modal since `+ Add Course Hub`, `Browse Course Hubs`, and `Edit Course Hub` already have dedicated trigger buttons in the sidebar and workspace.

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Edit Course Hub (`edit_hub`)**:
     - Header displays `Edit Course Hub`.
     - No secondary tab bar (`+ Add Course Hub` and `Browse Course Hubs` are removed).
  2. **Browse Course Hubs (`browse`)**:
     - Header displays `Browse Course Hubs (<count>)`.
     - No `+ Add Course Hub` tab in the sub-header and no `+ Add Course Hub` button beside the search input.
     - Clicking **Edit** on a Course Hub card transitions cleanly to the dedicated `Edit Course Hub` view.
  3. **+ Add Course Hub (`create_hub`)**:
     - Header displays `+ Add Course Hub`.
     - No `Browse Course Hubs` tab in the sub-header.

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Remove Secondary Modal Tab Bar Across All Modes**
  - *Chosen Approach*: Remove the shared `+ Add Course Hub | Browse Course Hubs | Edit Course Hub` tab bar and reflect the active mode directly in the top navy modal header.
  - *Why*: Matches the user's request to remove `Add Course Hub` and `Browse Course Hub` from the Edit tab, remove `Add Course Hub` from the Browse tab, and remove `Browse Course Hub` from the Add Course Hub tab.

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ChannelRosterModal                            │
├──────────────────────────────────────────────────────────────────────┤
│ Top Navy Header Bar                                                  │
│  ├─ activeTab === 'edit_hub'       -> "Edit Course Hub"              │
│  ├─ activeTab === 'create_hub'     -> "+ Add Course Hub"             │
│  ├─ activeTab === 'browse'         -> "Browse Course Hubs (N)"       │
│  └─ activeTab === 'create_channel' -> "Add Channel inside <Hub>"     │
├──────────────────────────────────────────────────────────────────────┤
│ Dedicated Modal Body (No Cross-Tab Sub-Header)                       │
│  ├─ 'edit_hub'   : Course Hub Edit Form (Save Changes / Cancel)      │
│  ├─ 'create_hub' : Course Hub Creation Form                          │
│  ├─ 'browse'     : Full-width Search Input + Course Hub List         │
│  └─ 'create_channel': Sub-Channel Creation Form                      │
└──────────────────────────────────────────────────────────────────────┘
```
