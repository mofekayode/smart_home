import 'dotenv/config';
import fs from "fs";
import { OpenAI } from "openai";
import { File } from "node:buffer";
import record from "node-record-lpcm16";
import axios from "axios";
import { speak } from "./voice_speak.js";

// Fix for Node.js < 20
if (!globalThis.File) {
  globalThis.File = File;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CAIRO_URL = process.env.CAIRO_URL || "http://localhost:7860";

// Listen for voice input
async function listen(duration = 5000) {
  console.log(`🎙  Listening for ${duration/1000} seconds...`);
  const file = "/tmp/cairo_voice.wav";

  const rec = record.record({
    sampleRate: 16000,
    channels: 1,
    device: "default",
  });

  const stream = rec.stream().pipe(fs.createWriteStream(file));
  await new Promise((r) => setTimeout(r, duration));
  rec.stop();

  // Transcribe with Whisper
  try {
    const rsp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(file),
      model: "whisper-1",
    });
    
    console.log("📝 You said:", rsp.text);
    return rsp.text;
  } catch (error) {
    console.error("❌ Transcription error:", error.message);
    return null;
  }
}

// Send command to Cairo
async function sendToCairo(text) {
  try {
    console.log("🤖 Processing:", text);
    
    // Send to Cairo's chat endpoint
    const response = await axios.post(`${CAIRO_URL}/chat`, {
      text: text  // Changed from 'message' to 'text'
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    // The chat endpoint returns {reply: "...", ...}
    const cairoResponse = response.data?.reply || response.data?.response || response.data?.message;
    
    // Make sure we have a valid string
    const responseText = cairoResponse || "I've completed that action for you.";
    
    console.log("💬 Cairo says:", responseText);
    return responseText;
  } catch (error) {
    console.error("❌ Cairo error:", error.message);
    return "Sorry, I'm having trouble connecting to the smart home system.";
  }
}

// Check if wake word is present
function hasWakeWord(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return lowerText.includes("cairo") || lowerText.includes("hey cairo") || lowerText.includes("okay cairo");
}

// Process a single voice command
async function processVoiceCommand(requireWakeWord = false) {
  try {
    // Listen for voice input
    const text = await listen();
    if (!text) {
      await speak("Sorry, I didn't catch that.");
      return;
    }

    // Check for wake word if required
    if (requireWakeWord && !hasWakeWord(text)) {
      console.log("⏭️  No wake word detected, ignoring...");
      return;
    }

    // Remove wake word from command if present
    let command = text;
    if (hasWakeWord(text)) {
      command = text.toLowerCase()
        .replace(/hey cairo,?\s*/i, "")
        .replace(/okay cairo,?\s*/i, "")
        .replace(/cairo,?\s*/i, "")
        .trim();
      
      // If only wake word was said, acknowledge
      if (!command) {
        await speak("Yes, Mofe? How can I help?");
        // Listen for actual command
        const followUp = await listen();
        if (followUp) {
          command = followUp;
        } else {
          return;
        }
      }
    }

    // Send to Cairo and get response
    const response = await sendToCairo(command);
    
    // Speak the response
    await speak(response);
    
  } catch (error) {
    console.error("❌ Error in voice processing:", error);
    await speak("Sorry, something went wrong.");
  }
}

// Continuous listening mode
async function continuousMode() {
  console.log("🎧 Cairo Voice Assistant - Continuous Mode");
  console.log("💡 Say 'Hey Cairo' or 'Cairo' followed by your command");
  console.log("🛑 Press Ctrl+C to stop\n");

  // Initial greeting
  await speak("Voice mode activated. Say 'Hey Cairo' to get started.");

  // Keep listening
  while (true) {
    await processVoiceCommand(true);
    // Small pause between listening sessions
    await new Promise(r => setTimeout(r, 500));
  }
}

// Single command mode
async function singleMode() {
  console.log("🎧 Cairo Voice Assistant - Single Command Mode");
  console.log("💡 Speak your command now...\n");
  
  await processVoiceCommand(false);
}

// Export functions
export { listen, sendToCairo, processVoiceCommand, continuousMode, singleMode };

// Test if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  singleMode().catch(console.error);
}