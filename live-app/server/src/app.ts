import express from 'express';
import cors from 'cors';
import { account } from './routes/account';
import { admin } from './routes/admin';
import { safety } from './routes/safety';
import { streams } from './routes/streams';
import { wallet } from './routes/wallet';
import { webhooks } from './routes/webhooks';

export const app = express();
app.set('trust proxy', 1);
app.use(cors());
// Webhooks parse their own bodies (LiveKit needs the raw body for signature checks).
app.use('/api', webhooks);
app.use(express.json({ limit: '100kb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', account, wallet, streams, safety, admin);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});
