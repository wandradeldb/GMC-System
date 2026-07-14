const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { requireAuth, requireProjectAccess, requireEditor, runStartupMigrations } = require('./routes/auth');
const authRouter          = require('./routes/auth');
const boqRouter           = require('./routes/boq');
const dasRouter           = require('./routes/das');
const subRouter           = require('./routes/subcontract');
const trackerRouter       = require('./routes/tracker');
const payappRouter        = require('./routes/payapp');
const importRouter        = require('./routes/import');
const boqImportRouter     = require('./routes/boq-import');
const qsCostsRouter       = require('./routes/qscosts');
const assessmentRouter    = require('./routes/assessment');
const subAssessmentRouter = require('./routes/subassessment');
const revenueRouter       = require('./routes/revenue');
const reportsRouter       = require('./routes/reports');
const programmeRouter     = require('./routes/programme');

const app      = express();
const PORT     = process.env.PORT || 3001;
const DIST_DIR = path.join(__dirname, '../client/dist');
const isProd   = fs.existsSync(DIST_DIR);

if (isProd) {
  app.use(express.static(DIST_DIR));
} else {
  app.use(cors({ origin: 'http://localhost:5173' }));
}
app.use(express.json());

// Auth routes — public (login endpoint)
app.use('/api/v1', authRouter);

// Public endpoints — before requireAuth
app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));

// All other API routes — protected
// requireProjectAccess guards any route with :id or :projectId param against other users' projects
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, boqRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, dasRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, subRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, trackerRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, payappRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, importRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, boqImportRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, qsCostsRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, assessmentRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, subAssessmentRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, revenueRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, reportsRouter);
app.use('/api/v1', requireAuth, requireProjectAccess, requireEditor, programmeRouter);

if (isProd) {
  app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
});

app.listen(PORT, () => {
  console.log(`GMC API running on http://localhost:${PORT}`);
  runStartupMigrations();
});
