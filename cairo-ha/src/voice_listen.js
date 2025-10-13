import 'dotenv/config';
import fs from "fs";
import { OpenAI } from "openai";
import record from "node-record-lpcm16";
import { File } from "node:buffer";

// Fix for Node.js < 20
if (!globalThis.File) {
  globalThis.File = File;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function listenOnce() {
  console.log("🎙 Listening for 5 seconds...");
  const file = "/tmp/cairo_voice.wav";

  // Use device from env or try pulse for Bluetooth compatibility
  const audioDevice = process.env.AUDIO_DEVICE || "pulse";
  console.log("📡 Using audio device:", audioDevice);
  
  const rec = record.record({
    sampleRate: 16000,
    channels: 1,
    device: audioDevice,
    verbose: process.env.DEBUG === "true"
  });

  const stream = rec.stream().pipe(fs.createWriteStream(file));
  await new Promise((r) => setTimeout(r, 5000)); // record 5 sec
  rec.stop();

  const rsp = await openai.audio.transcriptions.create({
    file: fs.createReadStream(file),
    model: "whisper-1",
  });

  console.log("🗣 You said:", rsp.text);
  return rsp.text;
}

listenOnce();