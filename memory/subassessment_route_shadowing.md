---
name: subassessment-route-shadowing
description: Sub Assessment routes are split across two files; subcontract.js shadows subassessment.js for GET/PUT
metadata:
  type: project
---

Sub Assessment endpoints under `/projects/:pid/subcontracts/:scid/applications` are defined in **two** router files, both mounted in `server/index.js`:
- `subcontract.js` (mounted first → **wins**) handles GET `/applications`, GET `/applications/:appId`, PUT `/applications/:period`, approve, invoices.
- `subassessment.js` (mounted after) handles POST `/applications` (manual create), POST `/applications/import-excel`, PUT `/applications/:appid/status`, DELETE `/applications/:appid`. Its own GET/detail handlers are **dead code** — Express matches the first router.

**Why:** Express matches routes by mount order; duplicate paths in the earlier router shadow the later one.

**How to apply:** When a GET/list/detail response looks wrong, edit `subcontract.js`, not `subassessment.js`. For import/manual-create/delete, edit `subassessment.js`. Always restart the node server after edits (it caches modules at require time). Related: [[migration_006_fk_corruption]].
