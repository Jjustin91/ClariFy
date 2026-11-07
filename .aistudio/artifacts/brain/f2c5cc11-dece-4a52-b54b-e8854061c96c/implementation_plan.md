# Implementation Plan: Real Image & Document Attachments in Announcements

## 1. Overview & Goals
- **Real File Upload in Create & Edit Announcement Modal**: Replace the simulated placeholder buttons in `AnnouncementFormModal.tsx` with real file pickers for **Images** (`image/*`) and **Documents** (`.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip`).
- **Add, Replace, or Remove Attachments When Creating or Editing**: Allow Instructors and Department Heads to attach a new file, preview the selected image or document before saving, replace an existing attachment, or remove an attachment in both **Create** and **Edit** modes.
- **Rich Card Previews, Lightbox & Document Downloads**:
  - **Image Attachments**: Render a live thumbnail preview directly inside the announcement card (both the 2-column Grid Card on All Announcements/Dashboard and the Noticeboard Feed Card inside Course Hubs). Clicking the image opens a full-size **Image Lightbox Modal** with a download button.
  - **Document Attachments**: Render the document's filename and type badge on the card with a clickable **Download / Open Document** action that downloads or opens the attached file directly.

---

## 2. Planned Changes

### A. Attachment Encoding & API Client (`src/lib/domain-logic.ts` & `src/lib/api-client.ts`)
1. **`/clarify-web/src/lib/domain-logic.ts`**:
   - Add helper utilities (`encodeAnnouncementContentWithAttachment` and `parseAnnouncementAttachment`) that seamlessly resolve `attachment_url`, `attachment_name`, and `attachment_type` whether stored in dedicated columns or embedded in the announcement payload, ensuring 100% persistence even before backend schema migrations run.
2. **`/clarify-web/src/lib/api-client.ts`**:
   - Update `createAnnouncementApi` and `updateAnnouncementApi` to accept attachment data (`attachment`, `attachment_url`, `attachment_name`, `attachment_type`, or `remove_attachment`) so both creating and editing announcements persist attachments reliably.

### B. Backend Controllers & PostgreSQL Adapter (`clarify-api` & `postgres-adapter.ts`)
1. **`/clarify-api/app/Http/Controllers/Api/V1/AnnouncementController.php` & `/clarify-api/app/Http/Resources/AnnouncementResource.php`**:
   - Support file upload, data URL storage, replacement, and removal (`remove_attachment`) in both `store()` and `update()`.
   - Ensure `attachment_url` resolves to a valid downloadable/renderable URL or data URL.
2. **`/clarify-web/src/server/postgres-adapter.ts` & `/clarify-web/app/api/v1/[...slug]/route.ts`**:
   - Widen `announcements.attachment_url` to `TEXT` so data URLs and long file URLs never truncate.
   - Parse uploaded `File` objects from `multipart/form-data` into data URLs and persist `attachment_url`, `attachment_name`, and `attachment_type` in both `POST /announcements` and `PATCH /announcements/{id}`.

### C. Modal & Announcement Card UI (`AnnouncementFormModal.tsx` & `AnnouncementCard.tsx`)
1. **`/clarify-web/src/components/modals/AnnouncementFormModal.tsx`**:
   - Add hidden `<input type="file">` elements for **Image** and **Document** buttons.
   - Read the selected file(s) with client-side image compression (for fast upload) or document data URL reading, and display an interactive attachment preview bar with file size and a **Remove (`X`)** button.
2. **`/clarify-web/src/components/announcements/AnnouncementCard.tsx`**:
   - **Grid Card**: When an image is attached, display the image thumbnail inside the left card box with a zoom indicator on hover; when a document is attached, make the left box a clickable document download/open trigger.
   - **Feed Card**: When an image is attached, display a crisp inline image preview below the announcement text that opens in full size on click; when a document is attached, render an interactive download pill button.
   - Include an accessible **Full-Size Image Lightbox Modal** when clicking any attached announcement image.

---

## 3. Verification Plan
- Run `compile_applet` and `lint_applet` to verify zero TypeScript or build errors.
- Verify that attaching an image or document when creating or editing an announcement displays the preview in the modal, renders properly on both Grid and Feed announcement cards, opens images in full size on click, and downloads documents on click.
