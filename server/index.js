const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { requireAuth } = require('./routes/auth');
const authRouter          = require('./routes/auth');
const boqRouter           = require('./routes/boq');
const dasRouter           = require('./routes/das');
const subRouter           = require('./routes/subcontract');
const trackerRouter       = require('./routes/tracker');
const payappRouter        = require('./routes/payapp');
const importRouter        = require('./routes/import');
const qsCostsRouter       = require('./routes/qscosts');
const assessmentRouter    = require('./routes/assessment');
const subAssessmentRouter = require('./routes/subassessment');
const revenueRouter       = require('./routes/revenue');

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

// All other API routes — protected
app.use('/api/v1', requireAuth, boqRouter);
app.use('/api/v1', requireAuth, dasRouter);
app.use('/api/v1', requireAuth, subRouter);
app.use('/api/v1', requireAuth, trackerRouter);
app.use('/api/v1', requireAuth, payappRouter);
app.use('/api/v1', requireAuth, importRouter);
app.use('/api/v1', requireAuth, qsCostsRouter);
app.use('/api/v1', requireAuth, assessmentRouter);
app.use('/api/v1', requireAuth, subAssessmentRouter);
app.use('/api/v1', requireAuth, revenueRouter);

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));

if (isProd) {
  app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
});

app.listen(PORT, () => console.log(`GMC API running on http://localhost:${PORT}`));
