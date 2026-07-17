---
name: feedback-visual-consistency
description: New screens/forms must reuse the app's existing CSS classes and visual patterns, not invent new ad-hoc styling
metadata:
  type: feedback
---

Always keep the same visual style, layout, and component patterns across the whole app — every screen should feel like it belongs to the same system, not like a one-off design.

**Why:** stated directly by the user (2026-07-17) right after approving a mockup for the redesigned "Tracker Invoices" tab, as a standing instruction for all future UI work, not specific to that screen.

**How to apply:** before building a new screen or form, look for an existing component doing something structurally similar and reuse its CSS classes and layout conventions rather than inventing new inline styles. Established patterns in this app:
- Page-level header: `sc-toolbar` + `sc-title`.
- Sub-tab-level toolbar: `section-toolbar` + `section-stat`.
- Search input: `filter-bar` wrapping `<input type="search">`.
- Forms: `inline-form` wrapping a `section-grid` of `.field`/`.field-label` pairs (`span2` for full-width fields).
- Tables: `boq-table` class, sticky `<thead>` (`position:'sticky', top:0, background:'#f9fafb'`), alternating row backgrounds (`idx % 2 === 0 ? '#f8fafc' : '#fff'`), `col-num` for right-aligned numeric columns, a dark totals `<tfoot>` row (`background:'#1a1a2e', color:'#fff'`).
- Status pills: `status-badge` class with a `{STATUS}_BG`/`{STATUS}_COLOR` lookup object.
- Empty states: `empty-hint` (inline, non-blocking) or `state-box` with an icon + message (blocking, full-page).

Before writing new component markup, grep sibling components (e.g. `SubcontractDetail.jsx`, `PaymentCalendar.jsx`, `BOQView.jsx`) for the closest existing pattern and match it, rather than styling from scratch.
