import 'dotenv/config';
import fs from "fs";
import { OpenAI } from "openai";
import { File } from "node:buffer";
import { exec } from "child_process";
import { promisify } from "util";

// Fix for Node.js < 20
if (!globalThis.File) {
  globalThis.File = File;
}

const execAsync = promisify(exec);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Voice options: alloy, echo, fable, onyx, nova, shimmer
const VOICE = process.env.TTS_VOICE || "nova"; // Nova is friendly and clear

async function speak(text) {
  try {
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
    // Linux: use aplay, mpg123, or ffplay
    // macOS: use afplay
    const platform = process.platform;
    let playCommand;
    
    if (platform === "darwin") {
      // macOS
      playCommand = `afplay ${tempFile}`;
    } else if (platform === "linux") {
      // Linux - try multiple players in order of preference
      playCommand = `(mpg123 ${tempFile} || ffplay -nodisp -autoexit ${tempFile} || aplay ${tempFile}) 2>/dev/null`;
    } else {
      console.error("❌ Unsupported platform for audio playback");
      return;
    }

    // Play the audio
    await execAsync(playCommand);
    
    // Clean up
    await fs.promises.unlink(tempFile);
    
  } catch (error) {
    console.error("❌ TTS Error:", error.message);
  }
}

// Test function
async function testSpeak() {
  await speak("Hello Mofe! I'm Cairo, your smart home assistant. How can I help you today?");
}

// Export for use in other modules
export { speak };

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testSpeak();
}