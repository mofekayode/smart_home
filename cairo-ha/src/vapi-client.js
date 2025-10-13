#!/usr/bin/env node

import 'dotenv/config';
import WebSocket from 'ws';
import fs from 'fs';
import record from 'node-record-lpcm16';
import Speaker from 'speaker';

// Load Vapi config
if (!fs.existsSync('.vapi-config.json')) {
  console.error('❌ No Vapi configuration found. Run: node src/vapi-setup.js');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync('.vapi-config.json', 'utf8'));
const VAPI_PUBLIC_KEY = process.env.VAPI_PUBLIC_KEY || config.publicKey;

if (!VAPI_PUBLIC_KEY) {
  console.error('❌ Please set VAPI_PUBLIC_KEY in your .env file');
  process.exit(1);
}

class VapiVoiceClient {
  constructor() {
    this.ws = null;
    this.audioRecorder = null;
    this.audioPlayer = null;
    this.isConnected = false;
  }

  async connect() {
    console.log('🎧 Cairo Voice Assistant - Vapi Mode');
    console.log('🚀 Connecting to Vapi...');
    
    // Connect to Vapi WebSocket
    this.ws = new WebSocket(`wss://api.vapi.ai/ws?apiKey=${VAPI_PUBLIC_KEY}`);
    
    this.ws.on('open', () => {
      console.log('✅ Connected to Vapi');
      this.isConnected = true;
      this.startCall();
    });
    
    this.ws.on('message', (data) => {
      const message = JSON.parse(data);
      this.handleMessage(message);
    });
    
    this.ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });
    
    this.ws.on('close', () => {
      console.log('📴 Disconnected from Vapi');
      this.isConnected = false;
      this.cleanup();
    });
  }

  startCall() {
    // Start call with Cairo assistant
    this.send({
      type: 'start',
      assistantId: config.assistantId,
      customer: {
        name: 'Mofe'
      }
    });
    
    console.log('📞 Starting call with Cairo...');
  }

  handleMessage(message) {
    switch (message.type) {
      case 'call-started':
        console.log('🎙️ Call started - Cairo is listening');
        this.startAudioStream();
        break;
        
      case 'transcript':
        if (message.role === 'user') {
          console.log(`🗣️ You: ${message.text}`);
        } else if (message.role === 'assistant') {
          console.log(`🤖 Cairo: ${message.text}`);
        }
        break;
        
      case 'function-call':
        console.log(`🔧 Function: ${message.functionCall.name}`, message.functionCall.parameters);
        break;
        
      case 'audio':
        // Play audio from Vapi
        this.playAudio(message.audio);
        break;
        
      case 'call-ended':
        console.log('📴 Call ended');
        this.cleanup();
        break;
        
      case 'error':
        console.error('❌ Error:', message.error);
        break;
        
      default:
        // console.log('📨 Message:', message.type);
    }
  }

  startAudioStream() {
    // Start recording from microphone
    this.audioRecorder = record.record({
      sampleRate: 16000,
      channels: 1,
      device: 'default'
    });
    
    // Stream audio to Vapi
    this.audioRecorder.stream().on('data', (chunk) => {
      if (this.isConnected) {
        this.send({
          type: 'audio',
          audio: chunk.toString('base64')
        });
      }
    });
    
    console.log('🎤 Microphone active - speak naturally!');
  }

  playAudio(audioData) {
    // Decode and play audio
    const audioBuffer = Buffer.from(audioData, 'base64');
    
    if (!this.audioPlayer) {
      this.audioPlayer = new Speaker({
        channels: 1,
        bitDepth: 16,
        sampleRate: 16000
      });
    }
    
    this.audioPlayer.write(audioBuffer);
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  cleanup() {
    if (this.audioRecorder) {
      this.audioRecorder.stop();
      this.audioRecorder = null;
    }
    
    if (this.audioPlayer) {
      this.audioPlayer.end();
      this.audioPlayer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Handle exit
process.on('SIGINT', () => {
  console.log('\n👋 Goodbye!');
  process.exit(0);
});

// Start client
const client = new VapiVoiceClient();
client.connect().catch(console.error);