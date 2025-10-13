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

// Listen for voice input with adaptive duration
async function listen(duration = 3000, mode = "normal") {
  // Use shorter duration for conversation mode, longer for wake word detection
  const listenDuration = mode === "conversation" ? 2500 : 
                         mode === "follow-up" ? 3000 : 
                         duration;
  
  console.log(`🎙  Listening...`);
  const file = "/tmp/cairo_voice.wav";

  const rec = record.record({
    sampleRate: 16000,
    channels: 1,
    device: "default",
    threshold: 0.5, // Voice activity threshold
  });

  const stream = rec.stream().pipe(fs.createWriteStream(file));
  await new Promise((r) => setTimeout(r, listenDuration));
  rec.stop();

  // Transcribe with Whisper
  try {
    const rsp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(file),
      model: "whisper-1",
      prompt: "Cairo, hey Cairo, okay Cairo", // Help Whisper recognize wake words
    });
    
    if (rsp.text && rsp.text.trim()) {
      console.log("📝 You said:", rsp.text);
    }
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

// Filter out background noise and false transcriptions
function isValidTranscription(text) {
  if (!text || text.trim().length === 0) return false;
  
  // Filter out very short transcriptions (likely noise)
  if (text.trim().length < 3) return false;
  
  // Filter out emoji-only transcriptions
  const emojiRegex = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\s]+$/u;
  if (emojiRegex.test(text)) {
    console.log("🚫 Filtered out emoji-only transcription");
    return false;
  }
  
  // Filter out single repeated words (like "and and and" or "Okay. Okay. Okay.")
  const words = text.toLowerCase().replace(/[.,!?]/g, '').split(/\s+/);
  const uniqueWords = new Set(words);
  if (words.length > 2 && uniqueWords.size === 1) {
    console.log("🚫 Filtered out repeated word transcription");
    return false;
  }
  
  // Filter out common video/media phrases that are likely background
  const backgroundPhrases = [
    /^share this video/i,
    /^thank you (so much )?for watching/i,
    /^subscribe to/i,
    /^like and subscribe/i,
    /^don't forget to/i,
    /^click the bell/i,
    /^follow me on/i,
    /^check out my/i,
    /^link in the description/i,
    /^comment below/i
  ];
  
  for (const phrase of backgroundPhrases) {
    if (phrase.test(text)) {
      console.log("🚫 Filtered out background media phrase");
      return false;
    }
  }
  
  // Filter out non-English characters (except common punctuation)
  // This helps filter out foreign language from videos
  const nonEnglishRegex = /[^\x00-\x7F\u00C0-\u00FF]/;
  const cleanText = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  if (nonEnglishRegex.test(cleanText) && !hasWakeWord(text)) {
    console.log("🚫 Filtered out non-English transcription");
    return false;
  }
  
  return true;
}

// Track if we're in conversation mode
let conversationMode = false;
let conversationTimer = null;

// Process a single voice command
async function processVoiceCommand(requireWakeWord = false) {
  try {
    // Determine listening mode
    const listenMode = conversationMode ? "conversation" : "normal";
    
    // Listen for voice input with appropriate duration
    const text = await listen(3000, listenMode);
    
    // Validate transcription (filter out noise/background)
    if (!isValidTranscription(text)) {
      // Silently ignore invalid transcriptions (no "Sorry, I didn't catch that")
      return;
    }

    // In conversation mode, we don't need wake word for 10 seconds after Cairo speaks
    const needsWakeWord = requireWakeWord && !conversationMode;
    
    // Show conversation mode status
    if (conversationMode) {
      console.log("💬 Conversation mode active - no wake word needed");
    }
    
    // Check for wake word if required
    if (needsWakeWord && !hasWakeWord(text)) {
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
      
      // If only wake word was said, acknowledge with faster response
      if (!command) {
        await speak("Yes, Mofe?");
        // Listen for actual command with shorter duration
        const followUp = await listen(3000, "follow-up");
        if (followUp && isValidTranscription(followUp)) {
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
    
    // Enable conversation mode for 10 seconds after Cairo speaks
    // This allows follow-up without wake word
    conversationMode = true;
    clearTimeout(conversationTimer);
    conversationTimer = setTimeout(() => {
      conversationMode = false;
      console.log("💤 Conversation mode ended, wake word required again");
    }, 10000);
    
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
    // Very small pause between listening sessions for responsiveness
    await new Promise(r => setTimeout(r, 100));
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