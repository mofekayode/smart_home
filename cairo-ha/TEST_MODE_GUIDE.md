# Cairo TEST_MODE Guide

## Overview

You can now develop Cairo while away from your Home Assistant network using **real captured data** instead of hardcoded mock values.

## Quick Start

### Before You Leave

Capture your current HA state:
```bash
npm run capture
```

This saves all real device states, sensor readings, and history to `src/routes/mock/ha-responses.json`

### While You're Away

Run Cairo in TEST_MODE:
```bash
TEST_MODE=true npm start
```

## What Gets Captured

The capture script saves:

### Entity States
- **Lights**: `light.short_lamp`, `light.tall_lamp` (state + brightness)
- **Switches**: `switch.bot1` (on/off state)
- **Sensors**: `sensor.centralite_3310_g_temperature`, `sensor.centralite_3310_g_humidity`
- **Binary Sensors**: `binary_sensor.motion_sensor` (motion detection)

### Service Call Responses
- Light control responses (turn_on, turn_off)
- Switch control responses (turn_on, turn_off)
- Automation reload
- Config check

### Historical Data
- Last 6 hours of sensor readings
- Temperature changes over time
- Humidity fluctuations
- Motion detection events (128 events in last capture!)

## Current Captured Values

From your most recent capture (`2025-10-15T12:28:19Z`):

- **Temperature**: 70.196°F
- **Humidity**: 60.59%
- **Lights**: Both on at 40% brightness
- **Switch**: On
- **Motion**: No motion detected

## How It Works

1. **Capture Script** (`capture-ha-data.js`):
   - Connects to your real Home Assistant
   - Calls all actual HA APIs
   - Saves responses to JSON

2. **Mock Routes** (`src/routes/mock/command.js`):
   - Loads captured data on startup
   - Uses real values instead of hardcoded ones
   - Falls back to defaults if no capture file exists

3. **TEST_MODE Flag**:
   - Routes through mock endpoints instead of real HA
   - No HA connection required
   - All NLP and chat logic works identically

## Testing

Verify real data is loaded:
```bash
# Start server
TEST_MODE=true npm start

# In another terminal, test queries:
curl -X POST http://localhost:7860/chat \
  -H "Content-Type: application/json" \
  -d '{"text":"what is the temperature"}'

# Should return: 70.196°F (your real value)
```

## Benefits

✅ **Real Data**: Use actual sensor readings, not fake 72°F/45% values
✅ **Offline Development**: No HA connection needed
✅ **Realistic Testing**: Test with your actual device states
✅ **History Available**: Access last 6 hours of sensor data
✅ **Easy Updates**: Re-run `npm run capture` anytime to refresh data

## Files Created

- **`capture-ha-data.js`** - Capture script
- **`src/routes/mock/ha-responses.json`** - Captured HA data (61KB)
- **`package.json`** - Added `"capture": "node capture-ha-data.js"`

## Notes

- Captured data is a **snapshot** from when you ran `npm run capture`
- Device states won't update dynamically in TEST_MODE (lights stay at captured brightness)
- For fresh data before a trip, re-run the capture script
- The mock routes still allow you to "control" devices (states update in memory, just not in real HA)

## Production vs TEST_MODE

**Production Mode** (`npm start`):
- Connects to real Home Assistant
- Controls actual devices
- Real-time sensor data
- Requires HA network access

**TEST_MODE** (`TEST_MODE=true npm start`):
- No HA connection needed
- Uses captured snapshot data
- Perfect for development while traveling
- All API endpoints work identically
