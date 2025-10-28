# Cairo Implementation Checklist (Updated)
## Exact Order to Build Everything

This is your step-by-step guide based on your existing Home Assistant setup.

**Your Current Setup:**
- ✅ Home Assistant running (network_mode: host)
- ✅ Mosquitto MQTT broker (port 1883)
- ✅ Z-Wave JS UI (Z-Wave devices)
- ✅ Zigbee integration (via serial device)
- ✅ Docker Compose configured

**What You're Building:**
Cairo - A conversational AI that lives alongside your HA setup.

---

## Phase 0: Project Setup (Day 1)

### Create Cairo Project Structure

```bash
cd ~/smartbrain
mkdir cairo
cd cairo
```

### Project Directory Structure
```
cairo/
├── docker-compose.yml         # Cairo services only
├── .env                        # API keys, secrets
├── .gitignore
├── services/
│   ├── voice/                 # Python - Voice pipeline
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── main.py
│   │   └── modules/
│   │       ├── wake_word.py
│   │       ├── vad.py
│   │       ├── asr.py
│   │       ├── speaker_id.py
│   │       └── tts.py
│   │
│   ├── conversation/          # TypeScript - Conversation Manager
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── manager.ts
│   │   │   ├── llm_router.ts
│   │   │   ├── feedback_manager.ts
│   │   │   └── types.ts
│   │   └── tests/
│   │
│   ├── tools/                 # TypeScript - Tool registry & HA tools
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── registry.ts
│   │   │   ├── ha_client.ts
│   │   │   └── tools/
│   │   │       ├── ha_read_state.ts
│   │   │       ├── ha_call_service.ts
│   │   │       └── ha_create_automation.ts
│   │   └── tests/
│   │
│   ├── event-bus/            # TypeScript - Event bus wrapper
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │       ├── bus.ts
│   │       └── types.ts
│   │
│   └── ui/                   # Next.js - Web interface
│       ├── Dockerfile
│       ├── package.json
│       ├── next.config.js
│       └── src/
│           ├── app/
│           ├── components/
│           └── lib/
│
├── shared/                    # Shared TypeScript types
│   └── types/
│       ├── events.ts
│       ├── conversation.ts
│       └── tools.ts
│
└── data/
    ├── sqlite/               # SQLite databases
    │   ├── cairo.db
    │   └── rag.db
    └── models/               # Downloaded AI models
        ├── wake_word/
        ├── whisper/
        └── piper/
```

### Initial Setup Tasks

- [ ] Create project directory structure
  ```bash
  cd ~/smartbrain/cairo
  mkdir -p services/{voice,conversation,tools,event-bus,ui}
  mkdir -p services/voice/modules
  mkdir -p services/conversation/src
  mkdir -p services/tools/src/tools
  mkdir -p services/event-bus/src
  mkdir -p services/ui/src/{app,components,lib}
  mkdir -p shared/types
  mkdir -p data/{sqlite,models/{wake_word,whisper,piper}}
  ```

- [ ] Create .gitignore
  ```bash
  cat > .gitignore << 'EOF'
# Environment
.env
.env.local

# Dependencies
node_modules/
__pycache__/
*.pyc
.venv/
venv/

# Data
data/sqlite/*.db
data/models/*
!data/models/.gitkeep

# IDE
.vscode/
.idea/
*.swp

# Build
dist/
build/
*.egg-info/

# Logs
*.log

# OS
.DS_Store
Thumbs.db
EOF
  ```

- [ ] Initialize Git
  ```bash
  git init
  git add .gitignore
  git commit -m "Initial commit: Project structure"
  ```

- [ ] Create .env template
  ```bash
  cat > .env.example << 'EOF'
# Home Assistant
HA_URL=http://localhost:8123
HA_TOKEN=your_long_lived_access_token_here

# Anthropic API
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Redis
REDIS_URL=redis://redis:6379

# MQTT (using existing broker)
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=cairo
MQTT_PASSWORD=your_mqtt_password

# Voice
WAKE_WORD_THRESHOLD=0.75
SPEAKER_ID_THRESHOLD=0.75

# Database
DATABASE_PATH=/data/sqlite/cairo.db
RAG_DATABASE_PATH=/data/sqlite/rag.db
EOF
  
  cp .env.example .env
  # Edit .env with your actual values
  ```

**Validation:** Directory structure created, git initialized

---

## Phase 1: Event Bus & Database (Days 2-3)

### Redis Service (Event Bus)

- [ ] Create Cairo docker-compose.yml
  ```yaml
  # cairo/docker-compose.yml
  version: '3.8'
  
  services:
    redis:
      container_name: cairo-redis
      image: redis:7-alpine
      restart: unless-stopped
      ports:
        - "6379:6379"
      volumes:
        - ./data/redis:/data
      command: redis-server --appendonly yes
  
    # Add more services as we build them
  ```

- [ ] Start Redis
  ```bash
  cd ~/smartbrain/cairo
  docker compose up -d redis
  docker compose logs -f redis  # Verify it's running
  ```

- [ ] Test Redis connection
  ```bash
  docker exec -it cairo-redis redis-cli ping
  # Should return: PONG
  ```

### Event Bus Service (TypeScript)

- [ ] Initialize event-bus service
  ```bash
  cd services/event-bus
  npm init -y
  npm install ioredis uuid
  npm install -D typescript @types/node ts-node
  npx tsc --init
  ```

- [ ] Create event types
  ```typescript
  // shared/types/events.ts
  export interface BaseEvent {
    id: string;
    type: string;
    timestamp: string;
    correlation_id?: string;
  }
  
  export interface WakeWordDetectedEvent extends BaseEvent {
    type: 'wake_word.detected';
    data: {
      confidence: number;
    };
  }
  
  export interface SpeechFinalEvent extends BaseEvent {
    type: 'speech.final';
    data: {
      text: string;
      user_id: string;
      confidence: number;
    };
  }
  
  export interface ToolRequestEvent extends BaseEvent {
    type: 'tool.request';
    data: {
      request_id: string;
      tool: string;
      args: any;
    };
  }
  
  export interface ToolResultEvent extends BaseEvent {
    type: 'tool.result';
    data: {
      request_id: string;
      result: any;
    };
  }
  
  export type CairoEvent = 
    | WakeWordDetectedEvent
    | SpeechFinalEvent
    | ToolRequestEvent
    | ToolResultEvent;
  
  export type EventType = CairoEvent['type'];
  ```

- [ ] Implement EventBus class
  ```typescript
  // services/event-bus/src/bus.ts
  import Redis from 'ioredis';
  import { v4 as uuidv4 } from 'uuid';
  import { CairoEvent, EventType } from '../../../shared/types/events';
  
  export class EventBus {
    private redis: Redis;
    private subscribers: Map<EventType, Set<EventHandler>>;
    
    constructor(redisUrl: string) {
      this.redis = new Redis(redisUrl);
      this.subscribers = new Map();
    }
    
    async connect(): Promise<void> {
      await this.redis.ping();
      console.log('Connected to Redis');
    }
    
    async publish(type: EventType, data: any): Promise<string> {
      const event: CairoEvent = {
        id: uuidv4(),
        type,
        timestamp: new Date().toISOString(),
        data
      };
      
      // Publish to Redis stream
      const streamKey = `stream:${type}`;
      const eventId = await this.redis.xadd(
        streamKey,
        'MAXLEN', '~', '10000',  // Keep last 10k events
        '*',  // Auto-generate ID
        'payload', JSON.stringify(event)
      );
      
      // Notify local subscribers
      await this.notifySubscribers(event);
      
      console.log(`Published ${type}: ${event.id}`);
      return eventId;
    }
    
    subscribe(type: EventType, handler: EventHandler): void {
      if (!this.subscribers.has(type)) {
        this.subscribers.set(type, new Set());
        this.startConsumer(type);
      }
      
      this.subscribers.get(type)!.add(handler);
      console.log(`Subscribed to ${type}`);
    }
    
    private async notifySubscribers(event: CairoEvent): Promise<void> {
      const handlers = this.subscribers.get(event.type);
      if (!handlers) return;
      
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (error) {
          console.error(`Handler error for ${event.type}:`, error);
        }
      }
    }
    
    private async startConsumer(type: EventType): Promise<void> {
      const streamKey = `stream:${type}`;
      const groupName = `group:${type}`;
      const consumerName = `consumer:${process.pid}`;
      
      // Create consumer group
      try {
        await this.redis.xgroup(
          'CREATE', streamKey, groupName, '0', 'MKSTREAM'
        );
      } catch (e) {
        // Group might already exist
      }
      
      // Start consuming
      this.consumeStream(streamKey, groupName, consumerName);
    }
    
    private async consumeStream(
      streamKey: string,
      groupName: string,
      consumerName: string
    ): Promise<void> {
      while (true) {
        try {
          const results = await this.redis.xreadgroup(
            'GROUP', groupName, consumerName,
            'COUNT', '10',
            'BLOCK', '1000',
            'STREAMS', streamKey, '>'
          );
          
          if (!results) continue;
          
          for (const [stream, messages] of results) {
            for (const [id, fields] of messages) {
              const payload = fields[1];  // fields is ['payload', '...']
              const event = JSON.parse(payload);
              
              await this.notifySubscribers(event);
              
              // Acknowledge
              await this.redis.xack(streamKey, groupName, id);
            }
          }
        } catch (error) {
          console.error('Stream consumption error:', error);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }
  
  type EventHandler = (event: CairoEvent) => Promise<void> | void;
  ```

- [ ] Create simple test script
  ```typescript
  // services/event-bus/src/test.ts
  import { EventBus } from './bus';
  
  async function test() {
    const bus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');
    await bus.connect();
    
    // Subscribe
    bus.subscribe('wake_word.detected', async (event) => {
      console.log('Received:', event);
    });
    
    // Publish
    await bus.publish('wake_word.detected', {
      confidence: 0.95
    });
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Test complete');
    process.exit(0);
  }
  
  test();
  ```

- [ ] Test event bus
  ```bash
  cd services/event-bus
  npx ts-node src/test.ts
  # Should see: Published and Received messages
  ```

### SQLite Database Setup

- [ ] Install SQLite tools
  ```bash
  sudo apt install sqlite3
  ```

- [ ] Create database schema
  ```sql
  -- data/sqlite/schema.sql
  
  -- Events log
  CREATE TABLE IF NOT EXISTS event (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    data_json TEXT NOT NULL,
    correlation_id TEXT
  );
  
  CREATE INDEX idx_event_type ON event(type);
  CREATE INDEX idx_event_timestamp ON event(timestamp);
  
  -- Conversations
  CREATE TABLE IF NOT EXISTS conversation (
    conversation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    turn_count INTEGER DEFAULT 0,
    summary TEXT
  );
  
  CREATE INDEX idx_conversation_user ON conversation(user_id);
  CREATE INDEX idx_conversation_started ON conversation(started_at);
  
  -- Conversation history (for RAG)
  CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
    conversation_id UNINDEXED,
    content,
    metadata,
    timestamp UNINDEXED
  );
  
  -- Voice profiles (speaker identification)
  CREATE TABLE IF NOT EXISTS voice_profile (
    user_id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,
    created_at TEXT NOT NULL,
    last_used TEXT,
    sample_count INTEGER DEFAULT 0
  );
  
  -- User preferences
  CREATE TABLE IF NOT EXISTS user_preference (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  
  -- Automations created by Cairo
  CREATE TABLE IF NOT EXISTS automation (
    automation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    friendly_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_via_conversation TEXT,
    trigger_summary TEXT,
    action_summary TEXT,
    enabled INTEGER DEFAULT 1
  );
  ```

- [ ] Initialize databases
  ```bash
  cd ~/smartbrain/cairo/data/sqlite
  sqlite3 cairo.db < ../../schema.sql
  sqlite3 rag.db "CREATE VIRTUAL TABLE documents USING fts5(id, content, metadata, timestamp);"
  ```

- [ ] Test database
  ```bash
  sqlite3 cairo.db "SELECT name FROM sqlite_master WHERE type='table';"
  # Should list: event, conversation, conversation_search, voice_profile, user_preference, automation
  ```

**Validation:** 
- Redis running and accepting connections
- Event bus can publish and subscribe
- SQLite databases created with schema

---

---

## Phase 2: Home Assistant Integration (Days 4-5)

### Get HA Access Token

- [ ] Create long-lived access token in Home Assistant
  ```
  1. Open Home Assistant: http://localhost:8123
  2. Go to Profile (bottom left)
  3. Scroll down to "Long-Lived Access Tokens"
  4. Click "Create Token"
  5. Name it "Cairo"
  6. Copy the token immediately (you can't see it again!)
  7. Add to cairo/.env: HA_TOKEN=your_token_here
  ```

### HA Tools Service (TypeScript)

- [ ] Initialize tools service
  ```bash
  cd ~/smartbrain/cairo/services/tools
  npm init -y
  npm install axios
  npm install -D typescript @types/node @types/axios ts-node
  npx tsc --init
  ```

- [ ] Create HA client
  ```typescript
  // services/tools/src/ha_client.ts
  import axios, { AxiosInstance } from 'axios';
  
  export class HomeAssistantClient {
    private client: AxiosInstance;
    
    constructor(baseURL: string, token: string) {
      this.client = axios.create({
        baseURL,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
    }
    
    async getState(entityId: string): Promise<EntityState> {
      const response = await this.client.get(`/api/states/${entityId}`);
      return response.data;
    }
    
    async callService(
      domain: string,
      service: string,
      data?: any
    ): Promise<any> {
      const response = await this.client.post(
        `/api/services/${domain}/${service}`,
        data || {}
      );
      return response.data;
    }
    
    async listEntities(): Promise<EntityState[]> {
      const response = await this.client.get('/api/states');
      return response.data;
    }
    
    async checkConnection(): Promise<boolean> {
      try {
        const response = await this.client.get('/api/');
        return response.data.message === 'API running.';
      } catch {
        return false;
      }
    }
  }
  
  export interface EntityState {
    entity_id: string;
    state: string;
    attributes: Record<string, any>;
    last_changed: string;
    last_updated: string;
  }
  ```

- [ ] Create MCP tool types
  ```typescript
  // services/tools/src/types.ts
  export interface MCPTool {
    name: string;
    description: string;
    inputSchema: JSONSchema;
    outputSchema?: JSONSchema;
    execute: (input: any) => Promise<any>;
    safety_level: 'read' | 'write_safe' | 'write_risky';
  }
  
  interface JSONSchema {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  }
  ```

- [ ] Create ha.read_state tool
  ```typescript
  // services/tools/src/tools/ha_read_state.ts
  import { MCPTool } from '../types';
  import { HomeAssistantClient } from '../ha_client';
  
  export function createReadStateTool(ha: HomeAssistantClient): MCPTool {
    return {
      name: 'ha.read_state',
      description: 'Read the current state of a Home Assistant entity',
      
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: {
            type: 'string',
            description: 'Entity ID (e.g., light.living_room_lamp)',
            pattern: '^[a-z_]+\\.[a-z0-9_]+$'
          }
        },
        required: ['entity_id']
      },
      
      outputSchema: {
        type: 'object',
        properties: {
          state: { type: 'string' },
          attributes: { type: 'object' },
          last_changed: { type: 'string' }
        }
      },
      
      async execute(input) {
        const { entity_id } = input;
        
        try {
          const state = await ha.getState(entity_id);
          
          return {
            state: state.state,
            attributes: state.attributes,
            last_changed: state.last_changed
          };
        } catch (error: any) {
          throw new Error(`Failed to read ${entity_id}: ${error.message}`);
        }
      },
      
      safety_level: 'read'
    };
  }
  ```

- [ ] Create ha.call_service tool
  ```typescript
  // services/tools/src/tools/ha_call_service.ts
  import { MCPTool } from '../types';
  import { HomeAssistantClient } from '../ha_client';
  
  export function createCallServiceTool(ha: HomeAssistantClient): MCPTool {
    return {
      name: 'ha.call_service',
      description: 'Call a Home Assistant service to control devices',
      
      inputSchema: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            enum: ['light', 'switch', 'lock', 'climate', 'cover', 'media_player'],
            description: 'Service domain'
          },
          service: {
            type: 'string',
            description: 'Service name (e.g., turn_on, turn_off)'
          },
          data: {
            type: 'object',
            description: 'Service data',
            properties: {
              entity_id: { type: 'string' },
              brightness_pct: { type: 'number', minimum: 0, maximum: 100 },
              color_temp: { type: 'number' },
              rgb_color: { 
                type: 'array', 
                items: { type: 'number' },
                minItems: 3,
                maxItems: 3
              }
            }
          }
        },
        required: ['domain', 'service']
      },
      
      async execute(input) {
        const { domain, service, data } = input;
        
        try {
          await ha.callService(domain, service, data);
          
          return {
            success: true,
            domain,
            service,
            entity_id: data?.entity_id
          };
        } catch (error: any) {
          throw new Error(`Service call failed: ${error.message}`);
        }
      },
      
      safety_level: 'write_safe'
    };
  }
  ```

- [ ] Create tool registry
  ```typescript
  // services/tools/src/registry.ts
  import { MCPTool } from './types';
  import { EventBus } from '../../event-bus/src/bus';
  
  export class ToolRegistry {
    private tools: Map<string, MCPTool>;
    private eventBus: EventBus;
    
    constructor(eventBus: EventBus) {
      this.tools = new Map();
      this.eventBus = eventBus;
      
      // Subscribe to tool requests
      this.eventBus.subscribe('tool.request', async (event) => {
        await this.handleToolRequest(event.data);
      });
    }
    
    registerTool(tool: MCPTool): void {
      this.tools.set(tool.name, tool);
      console.log(`Registered tool: ${tool.name}`);
    }
    
    getTool(name: string): MCPTool | undefined {
      return this.tools.get(name);
    }
    
    getAllTools(): MCPTool[] {
      return Array.from(this.tools.values());
    }
    
    private async handleToolRequest(data: any): Promise<void> {
      const { request_id, tool, args } = data;
      
      try {
        const toolDef = this.getTool(tool);
        
        if (!toolDef) {
          throw new Error(`Tool not found: ${tool}`);
        }
        
        console.log(`Executing ${tool}:`, args);
        
        const result = await toolDef.execute(args);
        
        // Publish success
        await this.eventBus.publish('tool.result', {
          request_id,
          tool,
          result
        });
        
      } catch (error: any) {
        console.error(`Tool ${tool} failed:`, error);
        
        // Publish error
        await this.eventBus.publish('tool.error', {
          request_id,
          tool,
          error: error.message
        });
      }
    }
  }
  ```

- [ ] Create main tools service
  ```typescript
  // services/tools/src/main.ts
  import { EventBus } from '../../event-bus/src/bus';
  import { HomeAssistantClient } from './ha_client';
  import { ToolRegistry } from './registry';
  import { createReadStateTool } from './tools/ha_read_state';
  import { createCallServiceTool } from './tools/ha_call_service';
  
  async function main() {
    // Connect to event bus
    const eventBus = new EventBus(
      process.env.REDIS_URL || 'redis://localhost:6379'
    );
    await eventBus.connect();
    
    // Connect to Home Assistant
    const ha = new HomeAssistantClient(
      process.env.HA_URL || 'http://localhost:8123',
      process.env.HA_TOKEN!
    );
    
    const connected = await ha.checkConnection();
    if (!connected) {
      throw new Error('Failed to connect to Home Assistant');
    }
    console.log('Connected to Home Assistant');
    
    // Create tool registry
    const registry = new ToolRegistry(eventBus);
    
    // Register tools
    registry.registerTool(createReadStateTool(ha));
    registry.registerTool(createCallServiceTool(ha));
    
    console.log('Tool service ready');
  }
  
  main().catch(console.error);
  ```

- [ ] Test HA integration
  ```typescript
  // services/tools/src/test.ts
  import { HomeAssistantClient } from './ha_client';
  
  async function test() {
    const ha = new HomeAssistantClient(
      process.env.HA_URL!,
      process.env.HA_TOKEN!
    );
    
    // Test connection
    console.log('Testing connection...');
    const connected = await ha.checkConnection();
    console.log('Connected:', connected);
    
    // List entities
    console.log('\nListing entities...');
    const entities = await ha.listEntities();
    console.log(`Found ${entities.length} entities`);
    
    // Show first 5 lights
    const lights = entities.filter(e => e.entity_id.startsWith('light.'));
    console.log('\nLights:');
    lights.slice(0, 5).forEach(light => {
      console.log(`- ${light.entity_id}: ${light.state}`);
    });
    
    // Test reading state of first light (if exists)
    if (lights.length > 0) {
      const firstLight = lights[0].entity_id;
      console.log(`\nReading state of ${firstLight}...`);
      const state = await ha.getState(firstLight);
      console.log('State:', state.state);
      console.log('Attributes:', state.attributes);
    }
  }
  
  test().catch(console.error);
  ```

- [ ] Run HA integration test
  ```bash
  cd ~/smartbrain/cairo/services/tools
  # Make sure HA_URL and HA_TOKEN are in .env
  npx ts-node src/test.ts
  # Should show: Connected, list of entities, light states
  ```

### Add Tools Service to Docker Compose

- [ ] Add to docker-compose.yml
  ```yaml
  # cairo/docker-compose.yml
    tools:
      container_name: cairo-tools
      build: ./services/tools
      restart: unless-stopped
      environment:
        - REDIS_URL=redis://redis:6379
        - HA_URL=http://host.docker.internal:8123
        - HA_TOKEN=${HA_TOKEN}
      depends_on:
        - redis
      # Use host network to access HA on host
      network_mode: host
  ```

- [ ] Create Dockerfile
  ```dockerfile
  # services/tools/Dockerfile
  FROM node:20-alpine
  
  WORKDIR /app
  
  COPY package*.json ./
  RUN npm install
  
  COPY tsconfig.json ./
  COPY src ./src
  
  RUN npm run build
  
  CMD ["node", "dist/main.js"]
  ```

- [ ] Add build script to package.json
  ```json
  {
    "scripts": {
      "build": "tsc",
      "start": "node dist/main.js",
      "dev": "ts-node src/main.ts"
    }
  }
  ```

**Validation:**
- Can connect to Home Assistant
- Can list entities
- Can read device states
- Can control devices via tools
- Tool registry receives and executes tool requests

### Wake Word Detection (Python)
- [ ] Create voice service
  - [ ] Set up Python project structure
  - [ ] Install dependencies (openwakeword, pyaudio)
  - [ ] Create requirements.txt

- [ ] Implement wake word detector
  - [ ] Load OpenWakeWord model
  - [ ] Audio stream setup
  - [ ] Detect "Cairo" wake word
  - [ ] Publish wake_word.detected event to Redis

- [ ] Test wake word
  - [ ] Say "Cairo" → see event in logs
  - [ ] Verify false positive rate

**Validation:** "Cairo" consistently triggers wake_word.detected event

---

### VAD (Python)
- [ ] Install webrtcvad
- [ ] Implement VoiceActivityDetector class
  - [ ] Frame-based speech detection
  - [ ] Ring buffer smoothing
  - [ ] Publish speech.started and speech.ended events

- [ ] Test VAD
  - [ ] Speak after wake word
  - [ ] Verify speech.ended triggers correctly
  - [ ] Test with silence

**Validation:** Speech boundaries detected accurately

---

### ASR (Python)
- [ ] Install faster-whisper
- [ ] Implement SpeechRecognizer class
  - [ ] Load base.en model with int8
  - [ ] Streaming transcription
  - [ ] Publish speech.partial and speech.final events

- [ ] Test ASR
  - [ ] Say "Turn on the desk lamp"
  - [ ] Verify transcription accuracy
  - [ ] Check latency (<800ms)

**Validation:** Speech transcribed to text accurately and quickly

---

### Voice Pipeline Integration
- [ ] Implement VoicePipeline orchestrator
  - [ ] Wake word → VAD → ASR flow
  - [ ] Audio buffer management
  - [ ] Timeout handling

- [ ] Test end-to-end
  - [ ] "Cairo, turn on the light"
  - [ ] Verify speech.final event with correct text
  - [ ] Measure total latency

**Validation:** Full voice pipeline working, <1 second latency

---

## Phase 5: MCP Tool Layer (Week 3, Days 1-3)

### Tool Registry (TypeScript)
- [ ] Create tool types
  - [ ] MCPTool interface
  - [ ] Tool input/output schemas

- [ ] Implement ToolRegistry class
  - [ ] registerTool()
  - [ ] getTool()
  - [ ] callTool() with validation

- [ ] Subscribe to tool.request events
- [ ] Publish tool.result events

**Validation:** Tool registry can register and call tools

---

### Home Assistant Tools
- [ ] Implement ha.read_state tool
  - [ ] JSON Schema for input
  - [ ] Call HA API
  - [ ] Return formatted result

- [ ] Implement ha.call_service tool
  - [ ] Schema for domain/service/data
  - [ ] Validate entity_id
  - [ ] Call HA API
  - [ ] Handle errors

- [ ] Test tools
  - [ ] Read light state
  - [ ] Turn light on/off via tool
  - [ ] Verify error handling

**Validation:** HA tools work reliably

---

## Phase 6: Basic Router (Week 3, Days 4-5)

### Fast Pattern Matcher (TypeScript)
- [ ] Create FastMatcher class
  - [ ] Regex patterns for common commands
  - [ ] Slot extraction
  - [ ] Intent classification

- [ ] Implement patterns
  - [ ] "turn on/off X" → device_control
  - [ ] "what is X" → query
  - [ ] "dim X" → device_control

- [ ] Test pattern matching
  - [ ] Test 10+ different commands
  - [ ] Verify intent and slots extracted

**Validation:** Pattern matcher handles simple commands

---

### Entity Catalog
- [ ] Load entities from Home Assistant
- [ ] Create entity mapping (friendly name → entity_id)
- [ ] Fuzzy name matching
  - [ ] "living room light" → light.living_room_lamp
  - [ ] "desk lamp" → light.desk_lamp

**Validation:** Can map natural language to entity_id

---

### Router Integration
- [ ] Subscribe to speech.final events
- [ ] Route through FastMatcher
- [ ] Publish intent.detected events
- [ ] For device_control intent:
  - [ ] Publish tool.request immediately
  - [ ] Don't use planner yet

- [ ] Test simple commands
  - [ ] "Turn on desk lamp"
  - [ ] "Turn off living room light"
  - [ ] Verify lights respond

**Validation:** Voice → Light control working end-to-end!

---

## Phase 7: TTS Response (Week 3, Days 6-7)

### Piper TTS (Python)
- [ ] Install Piper
- [ ] Load voice model
- [ ] Implement TTS class
  - [ ] Subscribe to tts.request events
  - [ ] Synthesize audio
  - [ ] Play audio
  - [ ] Publish tts.complete event

- [ ] Test TTS
  - [ ] Publish tts.request manually
  - [ ] Verify audio plays

**Validation:** TTS speaks responses

---

### Response Generation
- [ ] Router generates responses
  - [ ] After tool.result, create response text
  - [ ] "Desk lamp turned on"
  - [ ] "Temperature is 72 degrees"
  - [ ] Publish tts.request

- [ ] Test full loop
  - [ ] Say "Turn on desk lamp"
  - [ ] Hear "Desk lamp turned on"

**Validation:** Complete voice loop with feedback

---

## MILESTONE 1 COMPLETE ✓
**You now have:** Voice command → Light control → Audio feedback
**Time to celebrate and test heavily before proceeding!**

---

## Phase 8: Basic UI (Week 4, Days 1-3)

### Next.js Setup
- [ ] Create ui service
- [ ] Install Next.js, Tailwind, shadcn/ui
- [ ] Set up WebSocket connection to event bus

### Event Stream View
- [ ] Display real-time events
  - [ ] speech.partial, speech.final
  - [ ] intent.detected
  - [ ] tool.request, tool.result
  - [ ] Timeline view

- [ ] Add latency tracking
  - [ ] Show time between events
  - [ ] Highlight slow operations

**Validation:** UI shows all events in real-time

---

### Device Control Panel
- [ ] List all HA entities
- [ ] Manual control buttons
  - [ ] Turn on/off lights
  - [ ] See current state
- [ ] State updates in real-time (via MQTT)

**Validation:** Can control devices from UI

---

## Phase 9: MQTT Integration (Week 4, Days 4-5)

### MQTT Client (TypeScript)
- [ ] Install mqtt library
- [ ] Subscribe to homeassistant/#
- [ ] Parse state change messages
- [ ] Publish device.state_changed events

- [ ] Test MQTT
  - [ ] Change device in HA
  - [ ] See state change event
  - [ ] UI updates automatically

**Validation:** Device states flow through event bus

---

## Phase 10: ML Router Fallback (Week 4, Days 6-7)

### Claude API Integration (TypeScript)
- [ ] Install @anthropic-ai/sdk
- [ ] Implement MLClassifier class
- [ ] Build prompt with entity catalog
- [ ] Parse JSON response

### Router Enhancement
- [ ] Try FastMatcher first
- [ ] If no match → MLClassifier
- [ ] Publish intent with confidence
- [ ] Test complex commands
  - [ ] "Make it brighter in here"
  - [ ] "Is the living room light on?"

**Validation:** Complex commands work via ML

---

## MILESTONE 2 COMPLETE ✓
**You now have:** Full device control, UI showing events, ML fallback
**Test with 50+ different commands!**

---

## Phase 11: Vision Pipeline (Week 5)

### Camera Setup (Python)
- [ ] Connect USB camera
- [ ] Test OpenCV capture
- [ ] Set to 10 FPS

### Object Detection
- [ ] Install ultralytics (YOLOv8)
- [ ] Load yolov8n.pt model
- [ ] Detect objects in frames
- [ ] Test detection quality

### Vision Events
- [ ] Implement scene analyzer
  - [ ] Person detection → vision.person_detected
  - [ ] Low light + person → vision.low_light_with_person
  - [ ] Motion detection

- [ ] Subscribe router to vision events
  - [ ] Generate suggestions
  - [ ] "Turn on lights?" notification

**Validation:** Camera detects person, suggests lights

---

## Phase 12: Basic Planner (Week 6, Days 1-4)

### Planner Service (TypeScript)
- [ ] Create planner service
- [ ] Subscribe to planner.request events
- [ ] Implement plan() method
  - [ ] Call Claude API with tools context
  - [ ] Stream thinking to event bus
  - [ ] Parse plan JSON

### Plan Execution
- [ ] Execute steps sequentially
- [ ] Publish plan.step_complete events
- [ ] Handle step failures
- [ ] Retry logic

### Scene Commands
- [ ] Test "make it cozy"
  - [ ] Dim lights
  - [ ] Warm colors
  - [ ] Multiple steps execute

**Validation:** Multi-step scenes work

---

## Phase 13: Approval System (Week 6, Days 5-7)

### Approval Engine (TypeScript)
- [ ] Create approval requests
- [ ] Store in database
- [ ] Publish approval.requested events

### UI Approval Cards
- [ ] Display pending approvals
- [ ] Show plan preview
- [ ] Approve/Reject buttons
- [ ] Publish approval.approved/rejected

### Plan Integration
- [ ] Plans wait for approval if risky
- [ ] Execute after approval
- [ ] Cancel on rejection

**Validation:** Can approve/reject plans from UI

---

## MILESTONE 3 COMPLETE ✓
**You now have:** Vision, multi-step planning, approval workflow
**Record Demo Reel v1!**

---

## Phase 14: Speaker ID (Week 7, Days 1-3)

### Resemblyzer Integration (Python)
- [ ] Install resemblyzer
- [ ] Implement SpeakerIdentifier class
- [ ] Create/load embeddings

### Enrollment Flow
- [ ] Create enrollment script
- [ ] Record 5 phrases
- [ ] Generate embedding
- [ ] Store in database

### Integration
- [ ] Add speaker ID to voice pipeline
- [ ] Check before processing command
- [ ] Reject unknown speakers
- [ ] Add user_id to events

**Validation:** Only responds to enrolled users

---

## Phase 15: RAG Store (Week 7, Days 4-5)

### SQLite FTS5 Setup (TypeScript)
- [ ] Create RAGStore class
- [ ] FTS5 virtual table
- [ ] addDocument(), search() methods

### Integration
- [ ] Log all transcripts to RAG
- [ ] Router queries RAG for context
- [ ] Planner queries RAG for preferences

**Validation:** Commands use past context

---

## Phase 16: Self-Configuration (Week 8-9)

### Discovery Engine (TypeScript)
- [ ] Poll HA registry for new devices
- [ ] Detect new entities
- [ ] Publish discovery.new_device events

### Change Analyzer
- [ ] Analyze what changed
- [ ] Determine actions needed
- [ ] Calculate risk level

### Code Generator
- [ ] Template-based generation
- [ ] Generate MCP tools
- [ ] Generate router patterns
- [ ] Include tests

### Git Audit Trail
- [ ] Initialize git repo
- [ ] Commit changes with metadata
- [ ] Tag for rollback

### Approval + Hot Reload
- [ ] Request approval for changes
- [ ] Apply approved changes
- [ ] Hot reload services
- [ ] Rollback on error

**Validation:** New device auto-configures

---

## MILESTONE 4 COMPLETE ✓
**You now have:** Self-improving system, speaker ID, memory
**Ready for strategic outreach!**

---

## Phase 17: Safety Hardening (Week 10)

### Safety Policies
- [ ] Forbidden paths list
- [ ] Sensitive device list
- [ ] Max changes per day
- [ ] Test coverage requirements

### Security Audit
- [ ] Review all tool safety levels
- [ ] Add confirmation for risky actions
- [ ] Audit log review
- [ ] Penetration testing

**Validation:** System is safe and secure

---

## Phase 18: Reliability Testing (Week 11)

### 24/7 Operation
- [ ] Run continuously for 2 weeks
- [ ] Monitor uptime
- [ ] Track error rates
- [ ] Log all incidents

### Load Testing
- [ ] 100+ commands/day
- [ ] Multiple users
- [ ] Edge cases
- [ ] Recovery from failures

### Metrics Collection
- [ ] Success rate >95%
- [ ] Latency <800ms
- [ ] Zero safety incidents

**Validation:** System is production-ready

---

## MILESTONE 5 COMPLETE ✓
**You now have:** Bulletproof home system ready to demo
**Time to record Demo Reel v1 and do outreach!**

---

## Phase 19: Robot Hardware (Week 15-16)

### Hardware Acquisition
- [ ] Order robot arm + mobile base
- [ ] Wait for delivery (4-8 weeks)
- [ ] Unbox and test hardware
- [ ] Verify all actuators work

### ROS Setup
- [ ] Install ROS2 on Beelink
- [ ] Test basic robot control
- [ ] Verify camera feeds
- [ ] Manual teleoperation working

**Validation:** Can manually control robot

---

## Phase 20: ROS Bridge (Week 17-18)

### ROS Integration (Python)
- [ ] Create ROS node
- [ ] Subscribe to Cairo events
- [ ] Publish to ROS topics
- [ ] Map Cairo commands to ROS

### Robot Tools
- [ ] robot.move_arm tool
- [ ] robot.move_base tool
- [ ] robot.move_gripper tool
- [ ] robot.get_state tool

**Validation:** Commands control robot

---

## Phase 21: Grasp Planning (Week 19-20)

### Perception
- [ ] Depth camera integration
- [ ] Point cloud processing
- [ ] Object pose estimation

### Motion Planning
- [ ] MoveIt integration
- [ ] Grasp planning
- [ ] Collision avoidance
- [ ] Execute grasps

**Validation:** Robot picks up objects

---

## Phase 22: Robot Demos (Week 21-22)

### Five Killer Demos
- [ ] Demo 1: Fetch red cup
- [ ] Demo 2: Proactive assistance
- [ ] Demo 3: Dynamic replanning
- [ ] Demo 4: Safety confirmation
- [ ] Demo 5: Multi-step task

### Polish
- [ ] Rehearse 20+ times each
- [ ] Improve success rates
- [ ] Make it look effortless

**Validation:** All demos >70% success

---

## MILESTONE 6 COMPLETE ✓
**You now have:** Working robotics demos
**Record Demo Reel v2 and fundraise!**

---

## Key Principles

1. **Build incrementally** - Each phase adds ONE capability
2. **Test heavily** - Don't move on until current phase works
3. **Celebrate milestones** - They're real achievements
4. **Don't skip** - Each phase builds on the last
5. **It's okay to be slow** - Better to do it right

## When You Get Stuck

1. Check the architecture deep-dive doc
2. Review the milestone requirements
3. Test components in isolation
4. Ask for help (advisors, forums, me)
5. Take a break and come back fresh

## Estimated Timeline

- **Milestone 1 (Basic voice control):** 3 weeks
- **Milestone 2 (Full home system):** 4 weeks
- **Milestone 3 (Vision + planning):** 6 weeks
- **Milestone 4 (Self-config):** 9 weeks
- **Milestone 5 (Production-ready):** 11 weeks
- **Milestone 6 (Robotics):** 22 weeks

**Total: ~5-6 months to robotics demos**

You've got this! Start with Phase 0 tomorrow.
