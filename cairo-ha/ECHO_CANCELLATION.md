# Echo Cancellation Setup

Cairo now uses PulseAudio/PipeWire echo cancellation to prevent hearing itself.

## What Was Done

1. **Loaded echo cancellation module:**
   ```bash
   pactl load-module module-echo-cancel \
       source_master=cairo_mic \
       sink_master=cairo_speaker \
       source_name=cairo_mic_echo_cancel \
       sink_name=cairo_speaker_echo_cancel \
       aec_method=webrtc
   ```

2. **Set echo-cancelled devices as defaults:**
   ```bash
   pactl set-default-source cairo_mic_echo_cancel
   pactl set-default-sink cairo_speaker_echo_cancel
   ```

3. **Updated Cairo to use default audio devices:**
   - Cairo now uses 'default' which points to echo-cancelled devices
   - This ensures all audio goes through AEC

4. **Removed speaker verification code:**
   - Deleted all fingerprinting/VAD logic
   - Cairo now relies 100% on AEC for echo prevention

## Testing

Run Cairo:
```bash
npm run voice
```

Say "Hey Cairo" to activate, then test:
- **Does Cairo hear itself?** → Should NOT see Cairo's own responses transcribed as "📝 You: ..."
- **Can you interrupt Cairo?** → Start speaking while Cairo is responding
- **Audio quality good?** → Cairo's voice should sound normal, no distortion

## If It Works

Make it permanent by adding to PulseAudio config:

**Edit:** `~/.config/pulse/default.pa` (create if doesn't exist)

**Add this line:**
```
load-module module-echo-cancel source_master=cairo_mic sink_master=cairo_speaker source_name=cairo_mic_echo_cancel sink_name=cairo_speaker_echo_cancel aec_method=webrtc
```

Restart PulseAudio:
```bash
systemctl --user restart pipewire-pulse
```

## If It Doesn't Work

### Rollback (Unload Module)

```bash
# Unload echo cancellation
pactl unload-module module-echo-cancel

# Restore default devices (optional - will auto-reset on reboot anyway)
pactl set-default-source cairo_mic
pactl set-default-sink cairo_speaker
```

This removes the echo cancellation and returns audio to normal.

### Revert Code Changes

```bash
cd /home/mofe/smartbrain/cairo-ha
git checkout src/voice_realtime_clean.js
```

### Check What Went Wrong

1. **No audio at all?**
   - Check devices: `pactl list sinks short` and `pactl list sources short`
   - Verify `cairo_mic_echo_cancel` and `cairo_speaker_echo_cancel` exist

2. **Still hearing echo?**
   - AEC may not work well with your hardware
   - Try different AEC method: `aec_method=speex` instead of `webrtc`

3. **Audio distortion/robotic sound?**
   - Lower the sample rate or disable AEC
   - Your hardware may not support it well

4. **High latency?**
   - This is expected with AEC (~50-100ms delay)
   - If unacceptable, must choose between echo prevention and low latency

## Alternative: Fallback to Mic Blocking

If AEC doesn't work, we can go back to blocking the microphone while Cairo speaks:

1. Unload the module: `pactl unload-module module-echo-cancel`
2. I'll add back: `if (this.isPlaying) return;` in the recording handler
3. Trade-off: No echo but also no interruptions

## Module ID

Current module ID: **536870914**

To unload this specific module:
```bash
pactl unload-module 536870914
```
