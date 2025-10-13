import 'dotenv/config';
import express from 'express';
import chatRouter from './chat.js';

// Real routes
import automationsRouter from './routes/automations.js';
import lightsRouter from './routes/lights.js';
import switchesRouter from './routes/switches.js';
import sensorsRouter from './routes/sensors.js';
import commandRouter from './routes/command.js';
import introspectionRouter from './routes/introspection.js';
import capabilitiesRouter from './routes/capabilities.js';
import helpRouter from './routes/help.js';
import healthRouter from './routes/health.js';
import vapiRouter from './routes/vapi.js';

// Mock routes for testing
import mockCommandRouter from './routes/mock/command.js';
import mockAutomationsRouter from './routes/mock/automations.js';
import mockCapabilitiesRouter from './routes/mock/capabilities.js';

// TEST MODE - Set to true to use mock endpoints instead of real Home Assistant
const TEST_MODE = process.env.TEST_MODE === 'true' || false;

const app = express();
app.use(express.json());

// Always use real chat router and Vapi integration
app.use('/chat', chatRouter);
app.use('/vapi', vapiRouter);

// Conditionally use mock or real routes based on TEST_MODE
if (TEST_MODE) {
  console.log('🧪 Running in TEST MODE - Using mock endpoints');
  console.log('   No Home Assistant connection required');
  console.log('   Mock devices: 2 lights, 1 switch, temp/humidity/motion sensors');
  
  app.use('/command', mockCommandRouter);
  app.use('/intent', mockCommandRouter);
  app.use('/automations', mockAutomationsRouter);
  app.use('/capabilities', mockCapabilitiesRouter);
  
  // Mock routes that don't exist yet - just return basic responses
  app.use('/light', (_req, res) => res.json({ mock: true, message: 'Light endpoint not implemented in mock mode' }));
  app.use('/switch', (_req, res) => res.json({ mock: true, message: 'Switch endpoint not implemented in mock mode' }));
  app.use('/introspect', (_req, res) => res.json({ mock: true }));
  app.use('/', (_req, res) => res.json({ mock: true, message: 'Sensor root endpoint not implemented in mock mode' }));
} else {
  console.log('🏠 Running in PRODUCTION MODE - Connecting to Home Assistant');
  console.log(`   HA URL: ${process.env.HA_URL || 'Not configured!'}`);
  
  app.use('/automations', automationsRouter);
  app.use('/light', lightsRouter);
  app.use('/switch', switchesRouter);
  app.use('/command', commandRouter);
  app.use('/intent', commandRouter);
  app.use('/introspect', introspectionRouter);
  app.use('/capabilities', capabilitiesRouter);
  // Mount sensor routes last since they use root path
  app.use('/', sensorsRouter);
}

// Always available routes
app.use('/help', helpRouter);
app.use('/health', healthRouter);

// Start server
const port = Number(process.env.PORT || 7860);
app.listen(port, () => console.log(`up on http://localhost:${port}`));