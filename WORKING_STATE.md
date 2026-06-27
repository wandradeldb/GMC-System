# GMC System — Working State Documentation
**Last Updated:** 2026-06-27  
**Status:** ✅ Fully Functional Pilot  
**Environment:** Windows 11 Pro, Node.js v24.15.0

---

## 🎯 Current Architecture

### Tech Stack
| Layer | Technology | Version | Status |
|-------|-----------|---------|--------|
| Frontend | React + Vite | v5 | ✅ Running |
| Backend | Node.js + Express | v24.15.0 | ✅ Running |
| Database | SQLite | Built-in | ✅ Live |
| Port (Frontend) | localhost:5173 | - | ✅ Accessible |
| Port (Backend) | localhost:3001 | - | ✅ Accessible |

---

## ✅ What's Working

### 1. **Startup System**
- ✅ `start-gmc.ps1` — PowerShell startup script (recommended)
- ✅ `start-gmc.bat` — Batch startup script (alternative)
- ✅ Automatic dependency checking
- ✅ Health checks for both servers
- ✅ Browser auto-opens on ready
- ✅ Logs saved to `logs/` directory

**How to start:**
```powershell
cd C:\Users\wagne\.claude\projects\GMC - System
.\start-gmc.ps1
```

**Expected output:**
```
[+] Backend running at http://localhost:3001
[+] Frontend running at http://localhost:5173
Opening browser...
```

---

### 2. **Database & Data**
- ✅ SQLite database: `db/gmc.db`
- ✅ Project: Merlin Park (ID: 1)
- ✅ BOQ: 120 items, €5,347,965.24 total
- ✅ All tables created and populated
- ✅ No schema errors

**Verified tables:**
- `project` (1 record: Merlin Park W03/26)
- `boq_item` (120 records across 3 schedules)
- `subcontractor` (2,620 master suppliers)
- `subcontract` (SC-001: Right Group Ltd, €950,000)
- `tracker_we` (weekly entries W21-W23)
- `payapp` (payment applications #1-2)
- And 15+ supporting tables (all healthy)

---

### 3. **Backend API (Node.js + Express)**
- ✅ Server starts on port 3001
- ✅ CORS configured for localhost:5173
- ✅ Health endpoint: `GET /api/v1/health` → `{"status":"ok"}`

#### Working Endpoints
| Method | Endpoint | Response | Status |
|--------|----------|----------|--------|
| GET | `/api/v1/projects` | Array of projects | ✅ |
| GET | `/api/v1/projects/:id` | Project details | ✅ |
| GET | `/api/v1/projects/:id/boq` | 120 BOQ items + summary | ✅ |
| GET | `/api/v1/projects/:id/tracker` | Weekly cost tracker | ✅ |
| GET | `/api/v1/projects/:id/payapps` | Payment applications | ✅ |
| GET | `/api/v1/projects/:id/subcontracts` | Subcontract list | ✅ |
| GET | `/api/v1/projects/:id/das` | Daily allocation sheets | ✅ |

#### Sample API Test
```bash
curl http://localhost:3001/api/v1/projects/1/boq | head -c 200
# Returns: {"items":[{"id":121,"schedule":"1",...}],"totals":{"item_count":120,"grand_total":5347965.24}}
```

---

### 4. **Frontend (React + Vite)**
- ✅ Server starts on port 5173
- ✅ Vite HMR working (hot reload on file changes)
- ✅ React Router navigation working
- ✅ API proxy configured: `/api` → `http://localhost:3001`

#### Working Pages/Features
1. **Contract BOQ** (`/`)
   - ✅ Loads 120 BOQ items
   - ✅ Filterable by schedule (Sch 1, 1A, 2)
   - ✅ Filterable by type (F/T/M chips)
   - ✅ Searchable
   - ✅ Alternating row colors (light blue/orange)

2. **Subcontracts** 
   - ✅ Lists all project subcontracts
   - ✅ Live search modal for adding
   - ✅ Debounced autocomplete (220ms, min 2 chars)

3. **Cost Tracker**
   - ✅ Weekly revenue/cost matrix
   - ✅ Summary bar (Contract Value, BOQ, cumulative margin)
   - ✅ EFA (Estimated Final Account) section
   - ✅ Sticky headers and row labels
   - ✅ Responsive on mobile

4. **Applications for Payment**
   - ✅ Payment history with certificates
   - ✅ Gross/net values displayed
   - ✅ works_gross_override support

5. **Daily Allocation Sheet**
   - ✅ Labour/plant/material allocation by activity code
   - ✅ Links to BOQ via iw_cost_code

6. **Navigation & Layout**
   - ✅ Fixed topbar with GMC logo
   - ✅ Nav buttons for all modules
   - ✅ Active state highlighting
   - ✅ Responsive sidebar (mobile collapse)

---

### 5. **Styling**
- ✅ Single CSS file: `client/src/index.css`
- ✅ Topbar: `#1a1a2e` (dark navy), height 56px, `z-index: 1000`
- ✅ BOQ rows: Alternating `#f0f6ff` (light blue) and `#ffd8bb` (orange)
- ✅ Mobile responsive: Breakpoints at 768px, 600px
- ✅ Sticky table headers and row labels working

---

## 📋 Dependencies & Versions

### Backend (`server/package.json`)
```json
{
  "cors": "^2.8.6",
  "express": "^4.22.2",
  "multer": "^2.2.0",
  "xlsx": "^0.18.5"
}
```

### Frontend (`client/package.json`)
- React 18.x
- Vite 5.4.21
- React Router DOM

### System
- Node.js: v24.15.0
- npm: latest
- Database: SQLite (node:sqlite built-in)

---

## 🗄️ File Structure
```
GMC - System/
├── client/                    # React frontend
│   ├── src/
│   │   ├── App.jsx           # Root component, routing
│   │   ├── index.css         # All styles (single file)
│   │   ├── components/       # React components
│   │   └── ...
│   ├── package.json
│   └── vite.config.js
├── server/                    # Node.js backend
│   ├── index.js              # Express entry point
│   ├── routes/               # API routes
│   │   ├── boq.js
│   │   ├── tracker.js
│   │   ├── payapp.js
│   │   ├── subcontract.js
│   │   └── ...
│   ├── package.json
│   └── node_modules/
├── db/
│   └── gmc.db               # SQLite database (live data)
├── logs/                     # Auto-created on startup
│   ├── backend.log
│   └── frontend.log
├── start-gmc.ps1            # PowerShell startup (recommended)
├── start-gmc.bat            # Batch startup (alternative)
├── CLAUDE.md                # Project instructions
└── WORKING_STATE.md         # This file
```

---

## 🧪 Testing Checklist

All verified working as of last startup:

- ✅ Backend starts without errors
- ✅ Frontend loads at localhost:5173
- ✅ API health check passes
- ✅ BOQ endpoint returns 120 items
- ✅ Database reads correctly
- ✅ Navigation between modules works
- ✅ Table renders with correct styling
- ✅ Mobile responsive layout works
- ✅ CORS allows frontend → backend calls
- ✅ Vite HMR/hot reload enabled

---

## ⚠️ Critical Files — Do Not Break

These files are **core to functionality**. If modified, test immediately:

1. `server/index.js` — Express setup, CORS, routing
2. `client/src/App.jsx` — React routing, layout
3. `client/src/index.css` — All styling
4. `db/gmc.db` — Live database (backup before schema changes)
5. `start-gmc.ps1` — Startup automation
6. `server/routes/*.js` — API endpoints
7. `client/vite.config.js` — Build config, proxy setup

---

## 🔄 Development Workflow

**When making changes:**

1. ✅ Edit code
2. ✅ Vite HMR reloads (frontend) or restart backend
3. ✅ Test in browser at localhost:5173
4. ✅ Check browser console for errors
5. ✅ Check backend logs in terminal
6. ✅ Verify API responses with curl if needed

**On breaking change:**
- All DB tables remain ✅
- All API endpoints remain ✅
- All styling remains ✅
- All navigation remains ✅

---

## 📞 Support

If something breaks:
1. Check logs: `logs/backend.log`, `logs/frontend.log`
2. Restart: `.\start-gmc.ps1`
3. Clear browser cache (Ctrl+Shift+Delete)
4. Check that ports 3001 & 5173 aren't blocked

---

## 🎯 Known Good State

**Date:** 2026-06-27, 07:45 UTC  
**Tested By:** Claude Code  
**Database:** Merlin Park fully loaded  
**Last Verified:** All endpoints ✅, All pages ✅

This document serves as the "known good state" baseline. Any future changes should not regress from this point.
