#!/usr/bin/env node

import 'dotenv/config';
import WebSocket from 'ws';
import record from 'node-record-lpcm16';
import { spawn } from 'child_process';
import axios from 'axios';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CAIRO_URL = 'http://localhost:7860';

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not found');
  process.exit(1);
}

console.log('🎧 Cairo Voice Assistant\n');

class VoiceAssistant {
  constructor() {
    this.ws = null;
    this.recorder = null;
    this.player = null;
    this.isPlaying = false;
    this.listeningMode = 'WAITING_FOR_WAKE';  // WAITING_FOR_WAKE or ACTIVE
    this.lastSpeechTime = null;
    this.idleCheckInterval = null;
    this.responseInProgress = false;  // Track if response is being generated

    // Hardware AEC mode - Set to true when using devices with built-in echo cancellation
    // like the Anker PowerConf S330
    // NOTE: Anker AEC didn't work well - Cairo still heard itself
    this.USE_HARDWARE_AEC = false;  // Use software echo suppression instead

    // Echo suppression tracking (only used when USE_HARDWARE_AEC = false)
    this.playbackStartTime = null;
    this.totalAudioBytes = 0;
    this.SAMPLE_RATE = 24000;  // OpenAI outputs 24kHz
    this.BYTES_PER_SAMPLE = 2;  // 16-bit = 2 bytes
    this.CHANNELS = 1;  // Mono
    this.ECHO_TAIL_MS = 500;  // Extra time for room echo to settle (reduced from 1000ms)
  }

  async connect() {
    this.ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    this.ws.on('open', () => this.onOpen());
    this.ws.on('message', (data) => this.onMessage(data));
    this.ws.on('error', (error) => console.error('WebSocket error:', error));
    this.ws.on('close', () => {
      console.log('\nDisconnected');
      this.cleanup();
      process.exit(0);
    });
  }

  onOpen() {
    console.log('✅ Connected to OpenAI\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💡 Say "hey Cairo" to activate');
    console.log('💡 Say "all done Cairo" when finished');
    console.log('💡 Auto-sleep after 60 seconds of silence');
    if (this.USE_HARDWARE_AEC) {
      console.log('🎧 Hardware AEC Mode: Using Anker PowerConf S330');
      console.log('💡 You can interrupt Cairo while speaking!');
    } else {
      console.log('⏰ Software Echo Suppression: No interruptions allowed');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Configure session
    this.send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: `You are Cairo, Mofe's smart home assistant.

ABSOLUTE RULE: For ANY request about lights, switches, temperature, humidity, or devices - you MUST call process_command function IMMEDIATELY. DO NOT respond with text first!

WRONG: "Sure, turning off the lights" (just talking, no function call)
RIGHT: Call process_command("turn off the lights") (actual function call)

If the user mentions ANY of these keywords, call process_command RIGHT NOW:
- lights, lamp, brightness, dim, bright, on, off
- switch, plug, power
- temperature, temp, hot, cold, degrees
- humidity, humid, dry
- sensor, motion, detect

You can ONLY talk after calling the function. The function result will tell you what to say.`,
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.6,  // Less sensitive to avoid false triggers (was 0.5)
          prefix_padding_ms: 300,
          silence_duration_ms: 800  // Wait longer for pauses
        },
        tools: [{
          type: 'function',
          name: 'process_command',
          description: 'REQUIRED for ALL smart home requests. Execute ANY command related to lights, switches, sensors, temperature, humidity, or devices. Call this IMMEDIATELY when user mentions devices - do NOT respond with text first!',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The exact user command to execute (e.g., "turn on the lights", "what is the temperature")'
              }
            },
            required: ['command']
          }
        }],
        tool_choice: 'auto'  // Encourage function calling
      }
    });

    this.startRecording();
    this.setListeningMode('WAITING_FOR_WAKE');
    this.startIdleCheck();
  }

  setListeningMode(mode) {
    this.listeningMode = mode;
    if (mode === 'WAITING_FOR_WAKE') {
      console.log('😴 Sleeping... (say "hey Cairo" to wake me)');
    } else if (mode === 'ACTIVE') {
      console.log('👂 Active and listening...');
      this.lastSpeechTime = Date.now();
    }
  }

  startIdleCheck() {
    // Check every 10 seconds if we should auto-sleep
    this.idleCheckInterval = setInterval(() => {
      if (this.listeningMode === 'ACTIVE' && this.lastSpeechTime) {
        const idleTime = Date.now() - this.lastSpeechTime;
        if (idleTime > 60000) {  // 60 seconds
          console.log('\n⏰ Auto-sleep after 60 seconds of inactivity');
          this.setListeningMode('WAITING_FOR_WAKE');
        }
      }
    }, 10000);
  }

  onMessage(data) {
    const event = JSON.parse(data);

    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        if (this.listeningMode === 'ACTIVE') {
          console.log('🎤 Listening...');
        }
        break;

      case 'input_audio_buffer.speech_stopped':
        if (this.listeningMode === 'ACTIVE') {
          console.log('⏸️  Processing...');
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) {
          const text = event.transcript.toLowerCase();
          // Strip punctuation for wake word matching
          const cleanText = text.replace(/[.,!?;:]/g, ' ');
          console.log(`\n📝 You: ${event.transcript}`);

          // Check for wake word - be forgiving with mishearings
          if (this.listeningMode === 'WAITING_FOR_WAKE') {
            // Match variations: "hey cairo", "hey kyra", "hey kyle", "hey hyle", "hello cairo", etc.
            const wakePatterns = ['hey cairo', 'hey kyra', 'hey kyla', 'hey kyle', 'hey hyle', 'hey kairou',
                                  'hello cairo', 'hello kyra', 'hi cairo', 'hi kyra', 'hi kairou'];

            const hasWakeWord = wakePatterns.some(pattern => cleanText.includes(pattern));

            if (hasWakeWord) {
              this.setListeningMode('ACTIVE');
              // Don't return - continue processing so the full utterance gets handled
              // If they just said "hey cairo", there will be more speech detected
              // If they said "hey cairo, turn off lights", that will be in the transcript
            }
          }

          // Check for sleep command
          if (this.listeningMode === 'ACTIVE') {
            const sleepPatterns = ['all done cairo', 'all done kyra', 'done cairo', 'goodbye cairo'];
            const hasSleepWord = sleepPatterns.some(pattern => cleanText.includes(pattern));

            if (hasSleepWord) {
              console.log('');
              this.setListeningMode('WAITING_FOR_WAKE');
              return;
            }

            // Update last speech time
            this.lastSpeechTime = Date.now();
          }
        }
        break;

      case 'conversation.item.input_audio_transcription.failed':
        console.log('⚠️  Transcription failed');
        break;

      case 'response.function_call_arguments.done':
        console.log('\n[DEBUG] Function call detected:', event.name, event.arguments);
        // ALWAYS execute function calls regardless of mode
        // The wake word is for user experience, but if OpenAI wants to call a function, let it
        // Auto-activate if we're somehow still sleeping
        if (this.listeningMode === 'WAITING_FOR_WAKE') {
          console.log('[DEBUG] Auto-activating from function call');
          this.listeningMode = 'ACTIVE';
        }
        this.handleFunctionCall(event);
        break;

      case 'response.created':
        // Block mic immediately when response starts (software echo suppression)
        if (!this.USE_HARDWARE_AEC) {
          this.isPlaying = true;
          this.totalAudioBytes = 0;
        }
        // Always clear buffer to prevent echo/feedback
        this.send({ type: 'input_audio_buffer.clear' });
        break;

      case 'response.audio_transcript.delta':
        if (event.delta) {
          process.stdout.write(event.delta);
        }
        break;

      case 'response.audio_transcript.done':
        console.log('\n');
        // Always clear buffer after audio to prevent echo
        this.send({ type: 'input_audio_buffer.clear' });
        break;

      case 'response.audio.delta':
        if (event.delta) {
          const audioBuffer = Buffer.from(event.delta, 'base64');
          if (!this.USE_HARDWARE_AEC) {
            this.totalAudioBytes += audioBuffer.length;
          }
          this.responseInProgress = true;
          this.playAudio(audioBuffer);
        }
        break;

      case 'response.audio.done':
        // Close the player stdin to signal end of audio stream
        if (this.player?.stdin.writable) {
          this.player.stdin.end();
        }

        if (this.USE_HARDWARE_AEC) {
          // With hardware AEC, immediately unblock
          this.responseInProgress = false;
        } else {
          // With software echo suppression, wait for audio to finish + echo tail
          const audioDurationMs = (this.totalAudioBytes / (this.SAMPLE_RATE * this.BYTES_PER_SAMPLE * this.CHANNELS)) * 1000;
          const totalWaitMs = audioDurationMs + this.ECHO_TAIL_MS;

          console.log(`[ECHO] Audio: ${audioDurationMs.toFixed(0)}ms + Echo tail: ${this.ECHO_TAIL_MS}ms = ${totalWaitMs.toFixed(0)}ms wait`);

          setTimeout(() => {
            this.isPlaying = false;
            this.responseInProgress = false;
            this.totalAudioBytes = 0;
          }, totalWaitMs);
        }
        break;

      case 'error':
        // Handle API errors gracefully
        if (event.error?.code === 'conversation_already_has_active_response') {
          console.log('⚠️  Response already in progress, waiting...');
          this.responseInProgress = true;
        } else {
          console.error('❌ Error:', event.error);
        }
        break;
    }
  }

  async handleFunctionCall(event) {
    try {
      console.log('[DEBUG] handleFunctionCall called with event:', JSON.stringify(event).substring(0, 200));

      const args = JSON.parse(event.arguments);
      console.log('[DEBUG] Executing command:', args.command);

      const response = await axios.post(`${CAIRO_URL}/chat`, { text: args.command });
      const result = response.data?.reply || 'Done';
      console.log('[DEBUG] Command result:', result);

      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: event.call_id,
          output: JSON.stringify({ result })
        }
      });

      this.send({ type: 'response.create' });
    } catch (error) {
      console.error('[ERROR] Function call failed:', error.message);
      console.error('[ERROR] Stack:', error.stack);
      console.error('[ERROR] Is the Cairo server running on port 7860?');
    }
  }

  startRecording() {
    // When USE_HARDWARE_AEC is true, we rely on the system default (Anker)
    // The default source is already set to the Anker PowerConf S330
    this.recorder = record.record({
      sampleRate: 16000,
      channels: 1,
      audioType: 'raw',
      device: 'default'  // Uses system default (Anker when set via pactl)
    });

    this.recorder.stream().on('data', (chunk) => {
      // Only block microphone if using software echo suppression
      if (!this.USE_HARDWARE_AEC && this.isPlaying) return;

      // In WAITING_FOR_WAKE mode, always send audio (to detect "hey cairo")
      if (this.listeningMode === 'WAITING_FOR_WAKE') {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.send({
            type: 'input_audio_buffer.append',
            audio: chunk.toString('base64')
          });
        }
        return;
      }

      // In ACTIVE mode, send all audio
      if (this.listeningMode === 'ACTIVE') {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.send({
            type: 'input_audio_buffer.append',
            audio: chunk.toString('base64')
          });
        }
      }
    });

    this.recorder.stream().on('error', (error) => {
      console.error('❌ Microphone error:', error);
    });
  }

  playAudio(audioBuffer) {
    if (!this.player) {
      // OpenAI sends 24kHz audio, but Anker expects 48kHz
      // Use sox to resample on the fly: 24kHz mono → 48kHz mono
      this.player = spawn('sox', [
        '-t', 'raw',           // Input type: raw PCM
        '-r', '24000',         // Input rate: 24kHz (from OpenAI)
        '-e', 'signed',        // Encoding: signed integer
        '-b', '16',            // Bits: 16-bit
        '-c', '1',             // Channels: mono
        '-',                   // Read from stdin
        '-t', 'alsa',          // Output to ALSA
        'default',             // Use default device (Anker)
        'rate', '48000'        // Resample to 48kHz
      ], {
        stdio: ['pipe', 'pipe', 'pipe']  // Capture stderr to see sox errors
      });

      this.player.stderr?.on('data', (data) => {
        // Only log actual errors, not normal sox output
        const msg = data.toString();
        if (msg.includes('FAIL') || msg.includes('Error')) {
          console.error('[SOX ERROR]', msg);
        }
      });

      this.player.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error('[SOX] Exited with code:', code);
        }
        // Don't immediately set to null - let it finish
        setTimeout(() => {
          this.player = null;
          this.isPlaying = false;
        }, 100);  // Give it 100ms to flush
      });

      this.player.on('error', (error) => {
        console.error('❌ Audio playback error:', error);
        console.error('   Make sure sox is installed: sudo apt-get install sox');
        this.isPlaying = false;
      });
    }

    if (this.player?.stdin.writable) {
      this.player.stdin.write(audioBuffer);
    }
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  cleanup() {
    if (this.recorder) this.recorder.stop();
    if (this.player) this.player.kill();
    if (this.ws) this.ws.close();
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
  }
}

process.on('SIGINT', () => {
  console.log('\n\nGoodbye!');
  process.exit(0);
});

const assistant = new VoiceAssistant();
assistant.connect();
