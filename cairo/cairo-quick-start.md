# Cairo Quick Start - Updated for Your Setup

## What Changed

**Your Existing Infrastructure (Already Working):**
- ✅ Home Assistant on `localhost:8123`
- ✅ Mosquitto MQTT on `localhost:1883`  
- ✅ Z-Wave and Zigbee devices configured
- ✅ Docker Compose managing everything

**What You're Building (New "cairo" folder):**
A separate Cairo system that **talks to** your existing HA setup.

---

## Key Architectural Decisions

### 1. Separate Docker Compose
```
~/smartbrain/
├── docker-compose.yml          ← Your existing (HA, Mosquitto, Z-Wave)
└── cairo/
    ├── docker-compose.yml      ← NEW (Cairo services)
    └── services/...
```

**Why?** Keep Cairo isolated. Easy to develop, restart, and eventually deploy separately.

### 2. Cairo Connects to Existing Services
- Cairo tools service connects to HA via: `http://host.docker.internal:8123`
- Cairo can subscribe to your existing MQTT broker: `localhost:1883`
- No changes needed to your existing setup

### 3. Services Architecture
```
Cairo Services (new):
├── redis (event bus)
├── voice (Python - wake word, ASR, TTS, speaker ID)
├── conversation (TypeScript - AI brain)
├── tools (TypeScript - HA integration)
└── ui (Next.js - web interface)

Existing Services (unchanged):
├── homeassistant
├── mosquitto  
└── zwavejsui
```

---

## Your First Steps (Week 1)

### Day 1: Project Setup
```bash
cd ~/smartbrain
mkdir cairo
cd cairo

# Create structure
mkdir -p services/{voice,conversation,tools,event-bus,ui}
mkdir -p services/voice/modules
mkdir -p services/conversation/src
mkdir -p services/tools/src/tools
mkdir -p shared/types
mkdir -p data/{sqlite,models}

# Initialize git
git init
```

**Goal:** Directory structure exists

---

### Day 2-3: Event Bus + Database
```bash
# Create docker-compose.yml with just Redis
# Initialize event-bus TypeScript service
# Create SQLite databases
# Test event pub/sub
```

**Goal:** Can publish/subscribe events, databases created

**Test:**
```bash
cd services/event-bus
npx ts-node src/test.ts
# Should see: "Published wake_word.detected" → "Received wake_word.detected"
```

---

### Day 4-5: Home Assistant Integration
```bash
# Get HA long-lived access token
# Create tools service (TypeScript)
# Implement ha.read_state and ha.call_service tools
# Test HA connection
```

**Goal:** Can control HA devices via TypeScript

**Test:**
```bash
cd services/tools
npx ts-node src/test.ts
# Should show: Connected ✓, list of entities, can read states
```

---

### Day 6-10: Voice Pipeline (Python)
```bash
# Initialize Python voice service
# Implement wake word detection (OpenWakeWord)
# Implement VAD (webrtcvad)
# Implement ASR (faster-whisper)
# Implement speaker ID (Resemblyzer)
# Implement TTS (Piper)
```

**Goal:** Say "Cairo, turn on the light" → it transcribes correctly

**Test:**
```bash
cd services/voice
python main.py
# Say "Cairo" → should see: Wake word detected
# Say "Turn on desk lamp" → should see: Transcribed text
```

---

### Day 11-14: Conversation Manager (TypeScript)
```bash
# Create conversation manager service
# Implement conversational state management
# Integrate Claude Sonnet 4 API
# Add fast-path pattern matching
# Add adaptive feedback system
```

**Goal:** Full voice loop working with conversational responses

**Test:**
- Say "Cairo, turn on the desk lamp"
- Hear "Desk lamp on" + light actually turns on
- Say "Dim it"
- Hear "Dimming to 50%" + light dims

---

## Updated Milestones

### MILESTONE 1 (Week 2-3): Basic Voice Control
✓ Voice → Text → HA Control → Audio Response
- Wake word working
- Speech-to-text accurate
- Can control lights/switches
- Text-to-speech responds
- **NO LLM** for simple commands (fast path)

**Demo:** "Cairo, turn on desk lamp" → 600ms total latency

---

### MILESTONE 2 (Week 4-5): Conversational AI
✓ Context awareness + Multi-turn conversations
- Speaker identification working
- Understands "it", "that", "more"
- Claude integration for complex requests
- RAG for memory
- Adaptive feedback ("Let me check that...")

**Demo:** 
- "Turn on desk lamp" 
- "Actually, dim it"
- "A bit more" 
- All work without repeating "desk lamp"

---

### MILESTONE 3 (Week 6-8): Planning & Automation
✓ Multi-step tasks + Automation creation
- Multi-step scenes ("Make it cozy")
- Automation creation ("Turn on lights when I get home")
- Approval workflow
- RAG learns preferences

**Demo:** 
- "Help me wake up better"
- Cairo proposes gradual lighting routine
- User approves with modifications
- Automation created and working

---

### MILESTONE 4 (Week 9-12): Vision & Self-Config
✓ Camera integration + Self-improvement
- Camera detects person + low light → suggests lights
- New device discovered → auto-generates tools
- Git audit trail
- Hot reload

**Demo:** Plug in new smart plug → Cairo auto-configures it

---

### MILESTONE 5 (Week 13-16): Production Ready
✓ 24/7 operation + Safety + Polish
- Runs continuously for 2+ weeks
- >95% success rate
- <800ms average latency
- Zero safety incidents
- Ready for Demo Reel v1

---

## Critical File: .env

Create `cairo/.env` with:

```bash
# Home Assistant (REQUIRED)
HA_URL=http://localhost:8123
HA_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # Get from HA profile

# Anthropic API (REQUIRED for conversational AI)
ANTHROPIC_API_KEY=sk-ant-api03-...  # Get from console.anthropic.com

# Redis (defaults fine)
REDIS_URL=redis://localhost:6379

# MQTT (use your existing broker)
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=cairo
MQTT_PASSWORD=your_mqtt_password_here

# Voice settings
WAKE_WORD_THRESHOLD=0.75
SPEAKER_ID_THRESHOLD=0.75

# Database paths (defaults fine)
DATABASE_PATH=/data/sqlite/cairo.db
RAG_DATABASE_PATH=/data/sqlite/rag.db
```

---

## Quick Commands Reference

### Start Cairo services
```bash
cd ~/smartbrain/cairo
docker compose up -d
docker compose logs -f  # Watch logs
```

### Stop Cairo (HA keeps running)
```bash
cd ~/smartbrain/cairo
docker compose down
```

### Restart just one service
```bash
docker compose restart conversation
docker compose logs -f conversation
```

### See what's running
```bash
docker ps
# Should see: cairo-redis, cairo-voice, cairo-conversation, cairo-tools, cairo-ui
# Plus your existing: homeassistant, mosquitto, zwavejsui
```

### Check HA is accessible
```bash
curl http://localhost:8123/api/ \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
# Should return: {"message": "API running."}
```

### Test Redis
```bash
docker exec -it cairo-redis redis-cli ping
# Should return: PONG
```

---

## Folder Structure (Final)

```
~/smartbrain/
├── docker-compose.yml          # Your existing
├── ha_config/                  # Your existing HA config
├── mosquitto/                  # Your existing MQTT
├── zwavejsui/                  # Your existing Z-Wave
│
└── cairo/                      # NEW
    ├── docker-compose.yml      # Cairo services
    ├── .env                    # API keys
    ├── .gitignore
    │
    ├── services/
    │   ├── voice/              # Python
    │   ├── conversation/       # TypeScript
    │   ├── tools/              # TypeScript
    │   ├── event-bus/         # TypeScript
    │   └── ui/                 # Next.js
    │
    ├── shared/
    │   └── types/              # Shared TypeScript types
    │
    └── data/
        ├── sqlite/             # Databases
        │   ├── cairo.db
        │   └── rag.db
        └── models/             # Downloaded AI models
            ├── wake_word/
            ├── whisper/
            └── piper/
```

---

## What You DON'T Need to Change

✅ Your existing `docker-compose.yml` - leave it alone!
✅ Home Assistant config - no changes needed
✅ Mosquitto config - Cairo will just connect as a client
✅ Z-Wave setup - Cairo will control via HA API

---

## Next Steps

1. **Read the full checklist:** `cairo-implementation-checklist.md`
2. **Start with Phase 0:** Create directory structure
3. **Then Phase 1:** Get event bus working
4. **Then Phase 2:** Connect to your HA

**Don't skip phases!** Each builds on the last.

---

## Key Improvements in This Version

### 1. Conversational AI (not just commands)
- Full conversation state management
- Context across multiple turns
- Natural language understanding
- Learns preferences via RAG

### 2. Adaptive Feedback
- "Let me check that..." for slow operations
- Streaming responses
- Progress updates
- Feels responsive even when thinking

### 3. Speaker Identification
- Voice fingerprinting (Resemblyzer)
- Only responds to enrolled users
- Rejects TV/guests
- Per-user permissions

### 4. Hybrid Speed Strategy
- Simple commands: <300ms (regex, no LLM)
- Context resolution: ~500ms (Claude Haiku)
- Complex planning: ~2s (Claude Sonnet with streaming)

### 5. Real RAG Integration
- SQLite FTS5 for fast search
- Stores all conversations
- Learns preferences over time
- Retrieves relevant history

### 6. Production-Ready Architecture
- Event sourcing (Redis Streams)
- Complete audit trail
- Docker-based deployment
- Scales to robotics

---

## Cost Estimate (Monthly)

**Infrastructure:**
- Beelink hardware: Already owned
- Electricity: ~$5/month

**API Costs (100 commands/day):**
- Claude Haiku (20 calls): $0.60/month
- Claude Sonnet (10 calls): $4.50/month
- Faster-whisper (local): $0
- Piper TTS (local): $0
- **Total API: ~$5/month**

**Grand Total: ~$10/month** for Jarvis-level AI 🎯

---

## When You Get Stuck

1. **Check logs:** `docker compose logs -f [service]`
2. **Verify .env:** Make sure HA_TOKEN is correct
3. **Test components:** Each phase has test scripts
4. **Review architecture doc:** `cairo-architecture-deep-dive.md`
5. **Ask for help:** You have the full context now

---

## Success Criteria

**Week 1 Done:**
- ✓ Can publish/subscribe events
- ✓ Can control HA devices via TypeScript
- ✓ Databases created

**Week 2 Done:**
- ✓ Voice pipeline responds to "Cairo"
- ✓ Speech transcribed accurately
- ✓ Can control one light by voice

**Week 3 Done:**
- ✓ Full conversation loop working
- ✓ Responses feel natural
- ✓ Context carries across turns

**Week 6 Done:**
- ✓ Can create automations by voice
- ✓ Multi-step scenes work
- ✓ System learns preferences

**Week 12 Done:**
- ✓ Runs 24/7 reliably
- ✓ Ready for demos
- ✓ Revenue conversations possible

---

You're building this incrementally. Start with Phase 0 tomorrow! 🚀
