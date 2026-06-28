const express = require('express');
const cors    = require('cors');
const path    = require('path');
const boqRouter = require('./routes/boq');
const dasRouter = require('./routes/das');
const subRouter     = require('./routes/subcontract');
const trackerRouter = require('./routes/tracker');
const payappRouter  = require('./routes/payapp');
const importRouter  = require('./routes/import');
const qsCostsRouter    = require('./routes/qscosts');
const assessmentRouter    = require('./routes/assessment');
const subAssessmentRouter = require('./routes/subassessment');
const revenueRouter       = require('./routes/revenue');

const app  = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  app.use(express.static(path.join(__dirname, '../client/dist')));
} else {
  app.use(cors({ origin: 'http://localhost:5173' }));
}
app.use(express.json());

app.use('/api/v1', boqRouter);
app.use('/api/v1', dasRouter);
app.use('/api/v1', subRouter);
app.use('/api/v1', trackerRouter);
app.use('/api/v1', payappRouter);
app.use('/api/v1', importRouter);
app.use('/api/v1', qsCostsRouter);
app.use('/api/v1', assessmentRouter);
app.use('/api/v1', subAssessmentRouter);
app.use('/api/v1', revenueRouter);

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));

if (isProd) {
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../client/dist/index.html')));
} else {
  app.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
});

app.listen(PORT, () => console.log(`GMC API running on http://localhost:${PORT}`));
