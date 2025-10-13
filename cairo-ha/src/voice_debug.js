#!/usr/bin/env node

import 'dotenv/config';
import fs from "fs";
import record from "node-record-lpcm16";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

console.log("🔍 Cairo Voice Debugging Tool\n");

// Check audio devices
async function checkAudioDevices() {
  console.log("📋 Checking audio devices...");
  
  try {
    // List recording devices
    const { stdout: devices } = await execAsync("arecord -l 2>/dev/null || echo 'arecord not found'");
    console.log("\n🎤 Recording devices:");
    console.log(devices);
    
    // Check default device
    const { stdout: defaultDevice } = await execAsync("arecord -L | head -5 2>/dev/null || echo 'No default device'");
    console.log("\n🎯 Default audio device:");
    console.log(defaultDevice);
    
    // Check PulseAudio
    const { stdout: pulse } = await execAsync("pactl info 2>/dev/null | grep 'Default Source' || echo 'PulseAudio not running'");
    console.log("\n🔊 PulseAudio status:");
    console.log(pulse);
    
  } catch (error) {
    console.error("❌ Error checking devices:", error.message);
  }
}

// Test recording
async function testRecording() {
  console.log("\n🎙️ Testing recording for 3 seconds...");
  console.log("   Please speak now!");
  
  const testFile = "/tmp/cairo_test.wav";
  
  try {
    // Try different device configurations
    const devices = [
      { name: "default", device: "default" },
      { name: "pulse", device: "pulse" },
      { name: "plughw:0,0", device: "plughw:0,0" },
      { name: "hw:0,0", device: "hw:0,0" }
    ];
    
    for (const config of devices) {
      console.log(`\n🔧 Trying device: ${config.name}`);
      
      try {
        const rec = record.record({
          sampleRate: 16000,
          channels: 1,
          device: config.device,
          verbose: true
        });
        
        const stream = rec.stream().pipe(fs.createWriteStream(testFile));
        
        await new Promise((resolve) => setTimeout(resolve, 3000));
        rec.stop();
        
        // Check file size
        const stats = fs.statSync(testFile);
        console.log(`✅ Recorded ${stats.size} bytes with device ${config.name}`);
        
        if (stats.size > 1000) {
          console.log(`\n🎉 SUCCESS! Device '${config.device}' works!`);
          console.log(`\n💡 Add this to your .env file:`);
          console.log(`AUDIO_DEVICE=${config.device}`);
          
          // Try to play it back
          console.log("\n🔊 Playing back recording...");
          await execAsync(`aplay ${testFile} 2>/dev/null || cat ${testFile} | aplay 2>/dev/null`);
          
          return config.device;
        }
      } catch (error) {
        console.log(`❌ Device ${config.name} failed:`, error.message);
      }
    }
    
  } catch (error) {
    console.error("\n❌ Recording test failed:", error);
  }
  
  return null;
}

// Test microphone permissions
async function checkPermissions() {
  console.log("\n🔐 Checking permissions...");
  
  try {
    // Check if user is in audio group
    const { stdout: groups } = await execAsync("groups");
    if (groups.includes("audio")) {
      console.log("✅ User is in audio group");
    } else {
      console.log("⚠️  User is NOT in audio group");
      console.log("   Run: sudo usermod -a -G audio $USER");
      console.log("   Then logout and login again");
    }
    
    // Check if sox is installed
    const { stdout: sox } = await execAsync("which sox || echo 'not found'");
    if (sox.includes("not found")) {
      console.log("❌ sox is not installed");
      console.log("   Run: sudo apt-get install sox");
    } else {
      console.log("✅ sox is installed at:", sox.trim());
    }
    
  } catch (error) {
    console.error("Error checking permissions:", error.message);
  }
}

// Main debug flow
async function debug() {
  await checkPermissions();
  await checkAudioDevices();
  const workingDevice = await testRecording();
  
  if (workingDevice) {
    console.log("\n✅ Audio recording is working!");
    console.log("🚀 You can now use: npm run voice");
  } else {
    console.log("\n❌ Could not get audio recording to work");
    console.log("\n💡 Try these fixes:");
    console.log("1. Install PulseAudio: sudo apt-get install pulseaudio");
    console.log("2. Start PulseAudio: pulseaudio --start");
    console.log("3. Set default source: pactl set-default-source <your-mic>");
    console.log("4. Check mixer levels: alsamixer");
    console.log("5. Add user to audio group: sudo usermod -a -G audio $USER");
  }
}

debug();