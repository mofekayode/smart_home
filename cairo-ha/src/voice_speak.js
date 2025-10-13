import 'dotenv/config';
import fs from "fs";
import { OpenAI } from "openai";
import { File } from "node:buffer";
import { exec, spawn } from "child_process";
import { promisify } from "util";

// Fix for Node.js < 20
if (!globalThis.File) {
  globalThis.File = File;
}

const execAsync = promisify(exec);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Voice options: alloy, echo, fable, onyx, nova, shimmer
const VOICE = process.env.TTS_VOICE || "nova"; // Nova is friendly and clear

// Track the current audio process for interruption
let currentAudioProcess = null;

async function speak(text, interruptible = true) {
  try {
    // Stop any currently playing audio if interruptible
    if (interruptible && currentAudioProcess) {
      stopSpeaking();
    }
    
    console.log("🔊 Speaking:", text);
    
    // Generate speech using OpenAI TTS
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: VOICE,
      input: text,
      speed: 1.0
    });

    // Save to temporary file
    const buffer = Buffer.from(await mp3.arrayBuffer());
    const tempFile = "/tmp/cairo_speech.mp3";
    await fs.promises.writeFile(tempFile, buffer);

    // Play audio using system command
    const platform = process.platform;
    
    if (interruptible) {
      // Use spawn for interruptible playback
      let command, args;
      
      if (platform === "darwin") {
        command = "afplay";
        args = [tempFile];
      } else if (platform === "linux") {
        command = "mpg123";
        args = [tempFile];
      } else {
        console.error("❌ Unsupported platform for audio playback");
        return;
      }
      
      currentAudioProcess = spawn(command, args, { stdio: 'ignore' });
      
      // Wait for process to complete
      await new Promise((resolve) => {
        currentAudioProcess.on('exit', () => {
          currentAudioProcess = null;
          resolve();
        });
      });
    } else {
      // Non-interruptible playback using exec
      let playCommand;
      if (platform === "darwin") {
        playCommand = `afplay ${tempFile}`;
      } else if (platform === "linux") {
        playCommand = `(mpg123 ${tempFile} || ffplay -nodisp -autoexit ${tempFile}) 2>/dev/null`;
      } else {
        console.error("❌ Unsupported platform for audio playback");
        return;
      }
      await execAsync(playCommand);
    }
    
    // Clean up
    await fs.promises.unlink(tempFile).catch(() => {}); // Ignore errors if file already deleted
    
  } catch (error) {
    if (error.message && !error.message.includes('SIGTERM')) {
      console.error("❌ TTS Error:", error.message);
    }
  }
}

// Function to stop current speech
function stopSpeaking() {
  if (currentAudioProcess) {
    console.log("🔇 Interrupting speech");
    currentAudioProcess.kill('SIGTERM');
    currentAudioProcess = null;
  }
}

// Test function
async function testSpeak() {
  await speak("Hello Mofe! I'm Cairo, your smart home assistant. How can I help you today?");
}

// Export for use in other modules
export { speak, stopSpeaking };

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testSpeak();
}