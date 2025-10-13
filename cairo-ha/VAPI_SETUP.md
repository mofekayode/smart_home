# Vapi Voice Integration Setup

This guide helps you set up Vapi for natural, real-time voice conversations with Cairo.

## Why Vapi?

Current issues with the basic voice implementation:
- **5-8 second latency** between speaking and response
- **Fixed recording windows** that cut you off mid-sentence
- **No voice activity detection** - doesn't know when you're done speaking
- **Sequential processing** - record → transcribe → process → TTS → play

Vapi solves these with:
- **Sub-500ms latency** - near instant responses
- **Real-time streaming** - processes as you speak
- **Natural conversations** - waits for you to finish speaking
- **Full duplex** - can interrupt Cairo while she's speaking

## Setup Instructions

### 1. Get Vapi API Keys

1. Sign up at [https://vapi.ai](https://vapi.ai)
2. Go to Dashboard → API Keys
3. Copy your **Private API Key** and **Public Key**

### 2. Configure Environment

Add to your `.env` file:

```bash
# Vapi Configuration
VAPI_API_KEY=your-private-api-key-here
VAPI_PUBLIC_KEY=your-public-key-here
VAPI_SERVER_SECRET=cairo-secret-key
CAIRO_WEBHOOK_URL=https://your-domain.com/vapi/webhook
```

For local testing, you'll need ngrok:
```bash
# Install ngrok
npm install -g ngrok

# Expose local server
ngrok http 7860

# Copy the HTTPS URL to CAIRO_WEBHOOK_URL
```

### 3. Create Cairo Assistant

```bash
# Set up Cairo assistant on Vapi
npm run vapi:setup
```

This creates a voice assistant with:
- GPT-4 for natural conversation
- OpenAI's Nova voice
- Whisper for transcription
- Smart home function definitions

### 4. Test Voice Interaction

#### Option A: Command Line Client
```bash
# Start Cairo backend (in one terminal)
npm start

# Run Vapi voice client (in another terminal)
npm run vapi:client
```

#### Option B: Web Integration
```html
<!-- Add to your web app -->
<script src="https://cdn.jsdelivr.net/npm/@vapi-ai/web@latest/dist/vapi.min.js"></script>
<script>
  const vapi = new Vapi('your-public-key');
  
  // Start voice conversation
  async function startVoice() {
    await vapi.start('your-assistant-id');
  }
  
  // Listen to events
  vapi.on('message', (message) => {
    console.log('Cairo:', message);
  });
</script>
```

#### Option C: Phone Call
1. Get a phone number from Vapi Dashboard
2. Assign Cairo assistant to the number
3. Call the number to talk to Cairo!

## How It Works

```
1. You speak → Vapi captures audio in real-time
2. Vapi transcribes → Sends to GPT-4 with Cairo's personality
3. GPT-4 decides → Calls Cairo functions or responds directly
4. Cairo backend → Processes smart home commands via webhook
5. Vapi speaks → Real-time TTS back to you

All in < 500ms!
```

## Webhook Events

Cairo receives these events at `/vapi/webhook`:

- `function-call` - When Cairo needs to control devices
- `assistant-request` - Dynamic assistant configuration
- `call-started` - Voice session begins
- `call-ended` - Voice session ends
- `transcript` - Real-time conversation transcript

## Functions Available

Cairo can call these functions via Vapi:

- `control_lights` - Turn lights on/off
- `set_brightness` - Adjust light levels
- `check_temperature` - Get sensor readings
- `set_scene` - Activate scenes (movie, reading, etc.)
- `get_device_status` - Check device status
- `process_command` - General commands

## Testing

```bash
# Test webhook endpoint
curl -X POST http://localhost:7860/vapi/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "function-call",
    "functionCall": {
      "name": "control_lights",
      "parameters": {
        "action": "on",
        "room": "living room"
      }
    }
  }'
```

## Troubleshooting

### "Can't connect to Vapi"
- Check API keys in `.env`
- Ensure Cairo backend is running
- Verify webhook URL is accessible (use ngrok for local)

### "Cairo doesn't respond to commands"
- Check webhook logs in Cairo console
- Verify function definitions in `vapi-setup.js`
- Ensure `/vapi/webhook` endpoint is working

### "Audio issues"
- Check microphone permissions
- Ensure no other app is using the mic
- Try the web client instead of CLI

## Cost

Vapi pricing (as of 2024):
- **Free tier**: 10 minutes/month
- **Pay as you go**: ~$0.05/minute
- Includes transcription, LLM, and TTS

## Benefits Over Current System

| Feature | Current | Vapi |
|---------|---------|------|
| Latency | 5-8 seconds | <500ms |
| Recording | Fixed 3-5s windows | Continuous |
| Interruption | Not possible | Full duplex |
| Natural flow | Cuts off mid-sentence | Waits for you to finish |
| Quality | Basic | ChatGPT-level |

## Next Steps

1. Set up Vapi account
2. Configure webhooks
3. Test with `npm run vapi:client`
4. Integrate with your preferred client (web/mobile/phone)