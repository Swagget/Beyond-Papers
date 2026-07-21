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
import externalRouter from './routes/external.js';
import exportRouter from './routes/export.js';
import graphRouter from './routes/graph.js';
import flagsRouter from './routes/flags.js';
import chatsRouter from './routes/chats.js';
import credentialsRouter from './routes/credentials.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(optionalAuth);

// Routers that own nested /works/:id/... subpaths are mounted at /api and
// define full paths themselves (/works/..., /edges/..., etc).
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/search', searchRouter);
app.use('/api/import', importRouter);
app.use('/api/external', externalRouter);
app.use('/api/graph', graphRouter);
app.use('/api/flags', flagsRouter);
app.use('/api/me', credentialsRouter);
app.use('/api', chatsRouter); // /chats ..., /works/:id/chats — before worksRouter so /works/:id/chats wins
app.use('/api', exportRouter); // /works/:id/export/*, /versions/:hash — before worksRouter so export wins
app.use('/api', worksRouter); // /works ...
app.use('/api', edgesRouter); // /edges ..., /works/:id/edges
app.use('/api', reviewsRouter); // /works/:id/reviews, /works/:id/comments, /comments/:id
app.use('/api', aiRouter); // /works/:id/ai/*, /ai/:id, /ai/track-record

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
