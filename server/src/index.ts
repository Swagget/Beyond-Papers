import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './db.js';
import { errorHandler } from './lib/errors.js';
import { optionalAuth } from './lib/auth.js';

import authRouter from './routes/auth.js';
import worksRouter from './routes/works.js';
import edgesRouter from './routes/edges.js';
import reviewsRouter from './routes/reviews.js';
import aiRouter from './routes/ai.js';
import usersRouter from './routes/users.js';
import searchRouter from './routes/search.js';
import importRouter from './routes/import.js';
import exportRouter from './routes/export.js';
import graphRouter from './routes/graph.js';
import flagsRouter from './routes/flags.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(optionalAuth);

app.use('/api/auth', authRouter);
app.use('/api/works', worksRouter);
app.use('/api/edges', edgesRouter);
app.use('/api', reviewsRouter); // comments + review helpers live under /api/works/:id/... and /api/comments
app.use('/api/ai', aiRouter);
app.use('/api/users', usersRouter);
app.use('/api/search', searchRouter);
app.use('/api/import', importRouter);
app.use('/api', exportRouter); // /api/works/:id/export/*, /api/versions/:hash
app.use('/api/graph', graphRouter);
app.use('/api/flags', flagsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Production: serve the built client.
const clientDist = path.resolve(dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built. Run: npm run build');
  });
});

app.use(errorHandler);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Beyond Papers listening on http://localhost:${port}`);
});
