import 'dotenv/config';
import express from 'express';
import chatRouter from './chat.js';
import automationsRouter from './routes/automations.js';
import lightsRouter from './routes/lights.js';
import switchesRouter from './routes/switches.js';
import sensorsRouter from './routes/sensors.js';
import commandRouter from './routes/command.js';
import introspectionRouter from './routes/introspection.js';
import capabilitiesRouter from './routes/capabilities.js';
import helpRouter from './routes/help.js';
import healthRouter from './routes/health.js';

const app = express();
app.use(express.json());

// Mount route modules
app.use('/chat', chatRouter);
app.use('/automations', automationsRouter);
app.use('/light', lightsRouter);
app.use('/switch', switchesRouter);
app.use('/', sensorsRouter);
app.use('/command', commandRouter);
app.use('/intent', commandRouter);
app.use('/introspect', introspectionRouter);
app.use('/capabilities', capabilitiesRouter);
app.use('/help', helpRouter);
app.use('/health', healthRouter);

// Start server
const port = Number(process.env.PORT || 7860);
app.listen(port, () => console.log(`up on http://localhost:${port}`));