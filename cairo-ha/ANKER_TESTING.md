# Anker PowerConf S330 Testing Guide

## ✅ Changes Made

1. **Added Hardware AEC Mode** - New `USE_HARDWARE_AEC` flag (line 32 in voice_realtime_clean.js)
2. **Direct Device Routing** - Cairo now uses Anker devices directly:
   - Input: `alsa_input.usb-ANKER_Anker_PowerConf_S330_ACCUDP1F25509580-00.analog-stereo`
   - Output: `alsa_output.usb-ANKER_Anker_PowerConf_S330_ACCUDP1F25509580-00.analog-stereo`
3. **Removed Mic Blocking** - Microphone stays active during Cairo's speech
4. **Instant Response** - No more 1-second echo tail delay

## 🧪 How to Test

### Step 1: Start Cairo Voice Assistant

```bash
cd ~/smartbrain/cairo-ha
npm run voice
```

You should see:
```
✅ Connected to OpenAI

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 Say "hey Cairo" to activate
💡 Say "all done Cairo" when finished
💡 Auto-sleep after 60 seconds of silence
🎧 Hardware AEC Mode: Using Anker PowerConf S330
💡 You can interrupt Cairo while speaking!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 2: Test for Echo

**Goal:** Verify Cairo doesn't hear itself

1. Say: "**Hey Cairo**" - Should wake up
2. Say: "**Tell me a long story about smart homes**"
3. **Watch the console** while Cairo is speaking
4. ✅ **PASS:** You do NOT see transcripts like "📝 You: ..." of Cairo's own words
5. ❌ **FAIL:** You see Cairo transcribing its own speech

### Step 3: Test Interruption

**Goal:** Verify you can interrupt Cairo mid-sentence

1. Say: "**Hey Cairo**"
2. Say: "**Tell me about all the sensors in the house**" (long response)
3. **While Cairo is speaking**, interrupt by saying: "**Cairo, stop - what's the temperature?**"
4. ✅ **PASS:** Cairo stops and answers your temperature question
5. ❌ **FAIL:** Cairo ignores your interruption and keeps talking

### Step 4: Test Response Speed

**Goal:** Verify no artificial delays

1. Say: "**Turn on the lights**"
2. Time how long after Cairo finishes speaking before you can speak again
3. ✅ **PASS:** You can speak immediately after Cairo finishes (~0-100ms)
4. ❌ **FAIL:** There's a 1+ second delay before Cairo responds

## 📊 Expected Results

### ✅ If Hardware AEC Works:
- **No echo loops** - Cairo never transcribes its own voice
- **Interruptions work** - You can cut Cairo off mid-sentence
- **Instant response** - No artificial delays between turns
- **Better conversations** - Feels more natural and responsive

### ❌ If You Still Get Echo:
This means the Anker's AEC isn't working. Possible causes:
1. Device not properly configured in PulseAudio/PipeWire
2. Sample rate mismatch (we're downsampling 24kHz → 16kHz for input)
3. Anker AEC disabled (check device settings if available)

**Rollback:** Change line 32 in voice_realtime_clean.js:
```javascript
this.USE_HARDWARE_AEC = false;  // Back to software suppression
```

## 🔧 Troubleshooting

### Cairo can't find the Anker device

Check if device is properly connected:
```bash
pactl list sources short | grep ANKER
pactl list sinks short | grep ANKER
```

You should see:
```
237    alsa_input.usb-ANKER_Anker_PowerConf_S330_ACCUDP1F25509580-00.analog-stereo
236    alsa_output.usb-ANKER_Anker_PowerConf_S330_ACCUDP1F25509580-00.analog-stereo
```

If missing, unplug and replug the Anker device.

### Audio sounds distorted or robotic

The Anker might not like 24kHz playback. Try adjusting the sample rate:
- Line 356: Change `'-r', '24000'` to `'-r', '48000'` or `'-r', '16000'`

### High latency or slow responses

Check PipeWire/PulseAudio buffer settings. The Anker has internal buffering for AEC which adds ~20-50ms latency (normal for hardware AEC).

### Microphone too quiet or too loud

Adjust Anker volume:
```bash
# Increase mic volume
pactl set-source-volume alsa_input.usb-ANKER_Anker_PowerConf_S330_ACCUDP1F25509580-00.analog-stereo +10%

# Decrease mic volume
pactl set-source-volume alsa_input.usb-ANKER_Anker_PowerConf_S330_ACCUDP1F25509580-00.analog-stereo -10%

# Check current volume
pactl list sources | grep -A 15 ANKER | grep Volume
```

## 🎯 Next Steps After Testing

### If Hardware AEC Works Perfectly:
1. Delete old echo cancellation docs (ECHO_CANCELLATION.md, ECHO_SOLUTION.md)
2. Clean up unused code (remove software echo suppression entirely)
3. Update README with Anker setup instructions

### If Hardware AEC Needs Tuning:
1. Adjust sample rates, buffer sizes
2. Test different room positions for the Anker
3. Fine-tune VAD settings in OpenAI session config

### If Hardware AEC Doesn't Work:
1. Set `USE_HARDWARE_AEC = false`
2. Keep software echo suppression
3. Trade-off: No interruptions, but no echo either
