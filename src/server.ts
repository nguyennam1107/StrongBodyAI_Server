import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import emailRoutes from './routes/emailRoutes.js';
import geminiRoutes from './routes/geminiRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiKeyAuth } from './middleware/auth.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs/swagger.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*'})); // tighten as needed
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/healthz', (_req: Request, res: Response) => res.json({ status: 'ok' }));
app.use(apiKeyAuth);
app.use(emailRoutes);
app.use(geminiRoutes);
app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Server started');
  logger.info(`Docs: http://localhost:${env.PORT}/docs`);
});
