# Cairo Architecture Deep Dive
## Understanding Every Component

This document explains exactly how each piece of Cairo works, with code examples and data flows.

---

## Table of Contents
1. [Voice Pipeline](#voice-pipeline)
2. [Router](#router)
3. [Planner](#planner)
4. [Vision Pipeline](#vision-pipeline)
5. [RAG Store](#rag-store)
6. [Event Bus](#event-bus)
7. [MQTT Integration](#mqtt-integration)
8. [MCP Tool Layer](#mcp-tool-layer)
9. [Self-Update System](#self-update-system)
10. [How It All Connects](#how-it-all-connects)

---

## 1. Voice Pipeline {#voice-pipeline}

The voice pipeline transforms audio into actionable commands. It has 4 stages:

```
Audio Input → Wake Word → VAD → ASR → Text Output
```

### **1.1 Wake Word Detection**

**What it does:** Constantly listens for "Hey Cairo" or "Cairo" to activate

**Technology:** OpenWakeWord (runs locally, open source)

**How it works:**
```python
# voice_pipeline/wake_word.py
from openwakeword import Model
import numpy as np
import pyaudio

class WakeWordDetector:
    def __init__(self):
        # Load wake word model (trained on "Cairo")
        self.model = Model(
            wakeword_models=['cairo_v1.tflite'],
            inference_framework='tflite'
        )
        
        # Audio stream config
        self.chunk_size = 1280  # 80ms at 16kHz
        self.sample_rate = 16000
        
        # Initialize audio stream
        self.audio = pyaudio.PyAudio()
        self.stream = self.audio.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=self.sample_rate,
            input=True,
            frames_per_buffer=self.chunk_size
        )
    
    def listen(self):
        """Continuously listen for wake word"""
        while True:
            # Read audio chunk
            audio_data = np.frombuffer(
                self.stream.read(self.chunk_size),
                dtype=np.int16
            )
            
            # Run inference
            predictions = self.model.predict(audio_data)
            
            # Check if wake word detected (threshold 0.5)
            if predictions['cairo_v1'] > 0.5:
                print(f"Wake word detected! Confidence: {predictions['cairo_v1']}")
                
                # Publish to event bus
                publish_event({
                    'type': 'wake_word.detected',
                    'confidence': predictions['cairo_v1'],
                    'timestamp': datetime.now()
                })
                
                # Start VAD and ASR
                return True
```

**Latency:** 40-100ms per chunk, processes in real-time

**CPU Usage:** ~5-10% on Beelink

---

### **1.2 Voice Activity Detection (VAD)**

**What it does:** Determines when you start and stop speaking

**Technology:** WebRTC VAD or Silero VAD

**Why needed:** So Cairo knows when to process your complete sentence

**How it works:**
```python
# voice_pipeline/vad.py
import webrtcvad
from collections import deque

class VoiceActivityDetector:
    def __init__(self):
        self.vad = webrtcvad.Vad(3)  # Aggressiveness 3 (most aggressive)
        self.sample_rate = 16000
        self.frame_duration = 30  # ms
        self.frame_size = int(self.sample_rate * self.frame_duration / 1000)
        
        # Ring buffer to smooth detection
        self.ring_buffer = deque(maxlen=10)
        self.triggered = False
        
        # Speech detection thresholds
        self.num_voiced = 0
        self.num_unvoiced = 0
        
    def process_frame(self, audio_frame):
        """Process single audio frame"""
        is_speech = self.vad.is_speech(audio_frame, self.sample_rate)
        
        self.ring_buffer.append((audio_frame, is_speech))
        
        # Start of speech detection
        if not self.triggered:
            self.num_voiced = sum(1 for f, speech in self.ring_buffer if speech)
            
            if self.num_voiced > 7:  # 7/10 frames are speech
                self.triggered = True
                print("Speech started")
                
                publish_event({
                    'type': 'speech.started',
                    'timestamp': datetime.now()
                })
                
                return 'SPEECH_STARTED'
        
        # End of speech detection
        else:
            self.num_unvoiced = sum(1 for f, speech in self.ring_buffer if not speech)
            
            if self.num_unvoiced > 8:  # 8/10 frames are silence
                self.triggered = False
                print("Speech ended")
                
                publish_event({
                    'type': 'speech.ended',
                    'timestamp': datetime.now()
                })
                
                return 'SPEECH_ENDED'
        
        return 'SPEECH_CONTINUING' if self.triggered else 'SILENCE'
```

**Latency:** 20-40ms windowing

**Why it matters:** Without VAD, Cairo wouldn't know when you finished speaking

---

### **1.3 Automatic Speech Recognition (ASR)**

**What it does:** Converts audio to text

**Technology:** faster-whisper (optimized Whisper implementation)

**How it works:**
```python
# voice_pipeline/asr.py
from faster_whisper import WhisperModel
import numpy as np

class SpeechRecognizer:
    def __init__(self):
        # Load model (int8 quantized for CPU)
        self.model = WhisperModel(
            "base.en",  # English-only, faster than multilingual
            device="cpu",
            compute_type="int8",
            num_workers=4
        )
        
        self.sample_rate = 16000
        
    def transcribe_stream(self, audio_buffer):
        """
        Transcribe audio with streaming support
        Returns partial results as they become available
        """
        # Convert buffer to numpy array
        audio_array = np.frombuffer(audio_buffer, dtype=np.int16)
        audio_float = audio_array.astype(np.float32) / 32768.0
        
        # Run transcription with streaming
        segments, info = self.model.transcribe(
            audio_float,
            beam_size=5,
            best_of=5,
            temperature=0.0,  # Greedy decoding for speed
            vad_filter=True,  # Use VAD to skip silence
            vad_parameters={
                'threshold': 0.5,
                'min_speech_duration_ms': 250
            }
        )
        
        # Stream results
        partial_text = ""
        for segment in segments:
            partial_text += segment.text
            
            # Publish partial result
            publish_event({
                'type': 'speech.partial',
                'text': partial_text,
                'confidence': segment.avg_logprob,
                'timestamp': datetime.now()
            })
            
            print(f"Partial: {partial_text}")
        
        # Publish final result
        publish_event({
            'type': 'speech.final',
            'text': partial_text.strip(),
            'language': info.language,
            'confidence': info.language_probability,
            'timestamp': datetime.now()
        })
        
        return partial_text.strip()
    
    def transcribe_batch(self, audio_buffer):
        """
        Faster batch transcription when streaming not needed
        """
        audio_array = np.frombuffer(audio_buffer, dtype=np.int16)
        audio_float = audio_array.astype(np.float32) / 32768.0
        
        segments, info = self.model.transcribe(audio_float, beam_size=1)
        
        full_text = " ".join([segment.text for segment in segments])
        
        return full_text.strip()
```

**Latency:**
- First partial: <300ms for short commands
- Final result: <800ms for 5-second utterances
- Batch mode: <500ms for short commands

**Model sizes and trade-offs:**
- `tiny.en` - Fastest (100ms), less accurate
- `base.en` - Balanced (300ms), good accuracy
- `small.en` - Slower (800ms), better accuracy

**You'll use:** `base.en` with int8 quantization

---

### **1.4 Voice Fingerprinting / Speaker ID**

**What it does:** Identifies WHO is speaking to prevent responding to TV/guests/wrong people

**Technology:** Resemblyzer or pyannote.audio for speaker embeddings

**Why needed:**
- Don't respond to TV dialogue
- Don't respond to guests unless authorized
- Per-user preferences and permissions
- Security for sensitive commands (locks, etc.)

---

**How Speaker ID Works:**

```python
# voice_pipeline/speaker_id.py
from resemblyzer import VoiceEncoder, preprocess_wav
import numpy as np
from scipy.spatial.distance import cosine

class SpeakerIdentifier:
    def __init__(self):
        # Load voice encoder model
        self.encoder = VoiceEncoder()
        
        # Load enrolled users from database
        self.enrolled_users = self.load_enrolled_users()
        
        # Similarity threshold (0.0-1.0, higher = stricter)
        self.threshold = 0.75
        
        # Minimum audio length for reliable ID (seconds)
        self.min_audio_length = 1.0
        
    def load_enrolled_users(self) -> Dict[str, np.ndarray]:
        """Load voice embeddings for enrolled users"""
        users = {}
        
        # Query database for enrolled users
        rows = db.query("SELECT user_id, embedding FROM voice_profile")
        
        for row in rows:
            users[row['user_id']] = np.frombuffer(
                row['embedding'], 
                dtype=np.float32
            )
        
        return users
    
    def create_embedding(self, audio_buffer: bytes) -> np.ndarray:
        """
        Create speaker embedding from audio
        
        Args:
            audio_buffer: Raw audio bytes (16kHz, mono, int16)
        
        Returns:
            256-dimensional embedding vector
        """
        # Convert to numpy array
        audio_array = np.frombuffer(audio_buffer, dtype=np.int16)
        audio_float = audio_array.astype(np.float32) / 32768.0
        
        # Preprocess for encoder
        wav = preprocess_wav(audio_float, source_sr=16000)
        
        # Generate embedding
        embedding = self.encoder.embed_utterance(wav)
        
        return embedding
    
    def identify_speaker(self, audio_buffer: bytes) -> Optional[SpeakerResult]:
        """
        Identify who is speaking
        
        Returns:
            SpeakerResult with user_id and confidence, or None if unknown
        """
        # Check minimum length
        duration = len(audio_buffer) / (16000 * 2)  # 16kHz, 16-bit
        
        if duration < self.min_audio_length:
            print(f"Audio too short for ID: {duration:.2f}s")
            return None
        
        # Create embedding for this audio
        embedding = self.create_embedding(audio_buffer)
        
        # Compare with enrolled users
        best_match = None
        best_similarity = 0.0
        
        for user_id, user_embedding in self.enrolled_users.items():
            # Calculate cosine similarity
            similarity = 1 - cosine(embedding, user_embedding)
            
            if similarity > best_similarity:
                best_similarity = similarity
                best_match = user_id
        
        # Check if similarity meets threshold
        if best_similarity >= self.threshold:
            print(f"Speaker identified: {best_match} (confidence: {best_similarity:.2f})")
            
            return SpeakerResult(
                user_id=best_match,
                confidence=best_similarity,
                embedding=embedding
            )
        else:
            print(f"Unknown speaker (best match: {best_similarity:.2f})")
            return None
    
    def enroll_user(self, user_id: str, audio_samples: List[bytes]) -> bool:
        """
        Enroll new user with multiple audio samples
        
        Args:
            user_id: Unique identifier for user
            audio_samples: 3-5 voice samples (different sentences)
        
        Returns:
            True if enrollment successful
        """
        if len(audio_samples) < 3:
            raise ValueError("Need at least 3 audio samples for enrollment")
        
        # Create embeddings for all samples
        embeddings = []
        for sample in audio_samples:
            emb = self.create_embedding(sample)
            embeddings.append(emb)
        
        # Average embeddings for robustness
        avg_embedding = np.mean(embeddings, axis=0)
        
        # Verify embeddings are consistent (self-similarity check)
        similarities = []
        for emb in embeddings:
            sim = 1 - cosine(emb, avg_embedding)
            similarities.append(sim)
        
        avg_similarity = np.mean(similarities)
        
        if avg_similarity < 0.8:
            print(f"Warning: Enrollment samples inconsistent (avg similarity: {avg_similarity:.2f})")
            return False
        
        # Store in database
        db.execute("""
            INSERT OR REPLACE INTO voice_profile (user_id, embedding, created_at)
            VALUES (?, ?, ?)
        """, [
            user_id,
            avg_embedding.tobytes(),
            datetime.now()
        ])
        
        # Update in-memory cache
        self.enrolled_users[user_id] = avg_embedding
        
        print(f"User {user_id} enrolled successfully (consistency: {avg_similarity:.2f})")
        return True
    
    def remove_user(self, user_id: str):
        """Remove enrolled user"""
        db.execute("DELETE FROM voice_profile WHERE user_id = ?", [user_id])
        
        if user_id in self.enrolled_users:
            del self.enrolled_users[user_id]
        
        print(f"User {user_id} removed")

@dataclass
class SpeakerResult:
    user_id: str
    confidence: float
    embedding: np.ndarray
```

---

### **1.5 Voice Pipeline Orchestrator (with Speaker ID)**

**Puts it all together:**

```python
# voice_pipeline/orchestrator.py
class VoicePipeline:
    def __init__(self):
        self.wake_word = WakeWordDetector()
        self.vad = VoiceActivityDetector()
        self.asr = SpeechRecognizer()
        self.speaker_id = SpeakerIdentifier()
        self.audio_buffer = bytearray()
        
        # Policy settings
        self.require_speaker_id = True  # Reject unknown speakers
        self.allow_guest_mode = False   # Allow limited commands for guests
        
    async def run(self):
        """Main voice pipeline loop"""
        while True:
            # Wait for wake word
            if self.wake_word.listen():
                print("Wake word detected, listening...")
                
                # Start recording
                self.audio_buffer.clear()
                recording = True
                
                while recording:
                    # Read audio frame
                    frame = self.read_audio_frame()
                    
                    # Check VAD
                    vad_status = self.vad.process_frame(frame)
                    
                    if vad_status == 'SPEECH_STARTED':
                        # Add frame to buffer
                        self.audio_buffer.extend(frame)
                        
                    elif vad_status == 'SPEECH_CONTINUING':
                        # Keep adding to buffer
                        self.audio_buffer.extend(frame)
                        
                    elif vad_status == 'SPEECH_ENDED':
                        # STEP 1: Identify speaker FIRST
                        speaker = self.speaker_id.identify_speaker(self.audio_buffer)
                        
                        if speaker is None and self.require_speaker_id:
                            print("Unknown speaker, ignoring command")
                            
                            # Optional: Play rejection sound
                            await self.play_rejection_tone()
                            
                            # Publish event
                            publish_event({
                                'type': 'speech.rejected',
                                'reason': 'unknown_speaker',
                                'timestamp': datetime.now()
                            })
                            
                            recording = False
                            continue
                        
                        # STEP 2: Check permissions
                        user_id = speaker.user_id if speaker else 'guest'
                        permissions = self.get_user_permissions(user_id)
                        
                        # STEP 3: Transcribe
                        text = await self.asr.transcribe_stream(self.audio_buffer)
                        
                        print(f"{user_id} said: {text}")
                        
                        # STEP 4: Verify command is allowed for this user
                        if not self.is_command_allowed(text, permissions):
                            print(f"Command not allowed for {user_id}")
                            
                            await self.speak("Sorry, you don't have permission for that command")
                            
                            publish_event({
                                'type': 'speech.rejected',
                                'reason': 'insufficient_permissions',
                                'user_id': user_id,
                                'command': text,
                                'timestamp': datetime.now()
                            })
                            
                            recording = False
                            continue
                        
                        # STEP 5: Send to router with user context
                        publish_event({
                            'type': 'speech.final',
                            'text': text,
                            'user_id': user_id,
                            'confidence': speaker.confidence if speaker else 0.0,
                            'permissions': permissions,
                            'timestamp': datetime.now()
                        })
                        
                        recording = False
                        
                    # Timeout after 10 seconds
                    if len(self.audio_buffer) > self.sample_rate * 10 * 2:
                        print("Timeout, processing what we have...")
                        
                        # Still do speaker ID even on timeout
                        speaker = self.speaker_id.identify_speaker(self.audio_buffer)
                        
                        if speaker is None and self.require_speaker_id:
                            recording = False
                            continue
                        
                        text = await self.asr.transcribe_stream(self.audio_buffer)
                        recording = False
    
    def get_user_permissions(self, user_id: str) -> Permissions:
        """Get user permission level from database"""
        if user_id == 'guest':
            return Permissions(
                can_read_sensors=True,
                can_control_lights=False,
                can_control_locks=False,
                can_create_automations=False
            )
        
        # Query database
        row = db.query(
            "SELECT permissions FROM users WHERE user_id = ?", 
            [user_id]
        )
        
        if row:
            return Permissions(**json.loads(row['permissions']))
        
        # Default permissions for enrolled users
        return Permissions(
            can_read_sensors=True,
            can_control_lights=True,
            can_control_locks=True,  # Requires confirmation
            can_create_automations=True
        )
    
    def is_command_allowed(self, text: str, permissions: Permissions) -> bool:
        """
        Quick pre-check if command is allowed
        Router will do deeper permission checking
        """
        text_lower = text.lower()
        
        # Lock commands require permission
        if 'unlock' in text_lower or 'lock' in text_lower:
            return permissions.can_control_locks
        
        # Automation commands require permission
        if 'create' in text_lower and 'automation' in text_lower:
            return permissions.can_create_automations
        
        # Light/switch control
        if any(word in text_lower for word in ['turn on', 'turn off', 'dim', 'brighten']):
            return permissions.can_control_lights
        
        # Read-only queries always allowed
        if any(word in text_lower for word in ['what', 'is', 'show', 'tell me']):
            return permissions.can_read_sensors
        
        # Default: allow (router will do full check)
        return True
    
    async def play_rejection_tone(self):
        """Play tone to indicate rejection"""
        # Play low beep or say "I don't recognize your voice"
        pass

@dataclass
class Permissions:
    can_read_sensors: bool = True
    can_control_lights: bool = False
    can_control_locks: bool = False
    can_create_automations: bool = False
    can_modify_settings: bool = False
```

---

### **1.6 Speaker Enrollment Flow**

**How users get enrolled:**

```python
# voice_pipeline/enrollment.py
class EnrollmentFlow:
    def __init__(self, speaker_id: SpeakerIdentifier):
        self.speaker_id = speaker_id
        
        # Enrollment phrases (diverse for better embeddings)
        self.enrollment_phrases = [
            "Cairo, this is my voice for enrollment",
            "I want to control my smart home",
            "Please remember my voice",
            "Turn on the living room lights",
            "What's the temperature in the bedroom"
        ]
    
    async def enroll_new_user(self, user_id: str) -> bool:
        """
        Interactive enrollment process
        
        User speaks 5 different phrases
        """
        print(f"\nEnrolling user: {user_id}")
        print("Please speak the following phrases clearly:\n")
        
        audio_samples = []
        
        for i, phrase in enumerate(self.enrollment_phrases):
            print(f"{i+1}/5: '{phrase}'")
            print("Press ENTER when ready to speak...")
            input()
            
            # Record phrase
            audio = await self.record_phrase(duration=3.0)
            
            # Transcribe to verify they said it correctly
            text = await self.asr.transcribe_batch(audio)
            
            # Simple similarity check (70% match is fine)
            if self.is_similar(text, phrase, threshold=0.7):
                print(f"✓ Captured: '{text}'\n")
                audio_samples.append(audio)
            else:
                print(f"✗ Didn't match. You said: '{text}'")
                print("Let's try that one again.\n")
                continue
        
        # Enroll with all samples
        success = self.speaker_id.enroll_user(user_id, audio_samples)
        
        if success:
            print(f"\n✓ {user_id} enrolled successfully!")
            print("Try saying: 'Cairo, turn on the desk lamp'")
            
            # Test immediately
            await self.test_enrollment(user_id)
        else:
            print("\n✗ Enrollment failed. Please try again.")
        
        return success
    
    async def test_enrollment(self, user_id: str):
        """Test if enrollment worked"""
        print("\nTesting enrollment... Say something:")
        
        audio = await self.record_phrase(duration=3.0)
        
        speaker = self.speaker_id.identify_speaker(audio)
        
        if speaker and speaker.user_id == user_id:
            print(f"✓ Recognized as {user_id} (confidence: {speaker.confidence:.2f})")
        else:
            print(f"✗ Not recognized. Best match: {speaker.user_id if speaker else 'unknown'}")
    
    async def record_phrase(self, duration: float) -> bytes:
        """Record audio for specified duration"""
        # Implementation depends on audio library
        # Returns raw audio bytes
        pass
    
    def is_similar(self, text1: str, text2: str, threshold: float) -> bool:
        """Simple text similarity check"""
        # Use fuzzy matching or just check key words present
        from difflib import SequenceMatcher
        
        similarity = SequenceMatcher(None, text1.lower(), text2.lower()).ratio()
        return similarity >= threshold
```

---

### **1.7 Handling TV / Background Noise**

**Strategy 1: Audio Source Localization (Advanced)**

If you add multiple microphones, you can use beamforming to determine direction:

```python
# voice_pipeline/source_localization.py
class AudioSourceLocalizer:
    def __init__(self, mic_positions: List[Tuple[float, float, float]]):
        """
        mic_positions: 3D coordinates of each microphone in meters
        Example: [(0, 0, 0), (0.1, 0, 0), (0, 0.1, 0), (0.1, 0.1, 0)]
        """
        self.mic_positions = mic_positions
        
    def estimate_direction(self, audio_channels: List[np.ndarray]) -> Direction:
        """
        Estimate direction of audio source using TDOA
        (Time Difference of Arrival)
        """
        # Calculate cross-correlations between mic pairs
        # Determine time delays
        # Triangulate source position
        # Return azimuth and elevation
        pass
    
    def is_from_tv(self, direction: Direction) -> bool:
        """Check if audio is coming from TV direction"""
        # If you know TV is at azimuth 90°, elevation 0°
        tv_direction = Direction(azimuth=90, elevation=0)
        
        # Allow some tolerance (±15 degrees)
        return (
            abs(direction.azimuth - tv_direction.azimuth) < 15 and
            abs(direction.elevation - tv_direction.elevation) < 15
        )
```

**Strategy 2: Voice Liveness Detection (Simpler)**

Detect if audio is from a speaker vs. a human:

```python
# voice_pipeline/liveness.py
class VoiceLivenessDetector:
    def __init__(self):
        # Characteristics of live voice vs. speaker playback
        pass
    
    def is_live_voice(self, audio: np.ndarray) -> bool:
        """
        Detect if voice is live (human speaking) vs. playback (TV/speaker)
        
        Techniques:
        1. Frequency analysis (speakers have different freq response)
        2. Echo/reverb patterns
        3. Background noise consistency
        4. Dynamic range
        """
        # Check for speaker artifacts
        has_speaker_artifacts = self.detect_speaker_artifacts(audio)
        
        if has_speaker_artifacts:
            return False
        
        # Check for environmental acoustics consistent with room
        has_natural_acoustics = self.analyze_acoustics(audio)
        
        return has_natural_acoustics
    
    def detect_speaker_artifacts(self, audio: np.ndarray) -> bool:
        """Detect frequency response typical of speakers"""
        # Speakers often have:
        # - Boosted bass
        # - Compressed dynamic range
        # - Specific distortion patterns
        pass
```

**Strategy 3: Context + Speaker ID (Recommended for v1)**

Simplest approach for first version:

```python
# Combined approach
def should_respond(audio_buffer: bytes) -> bool:
    # 1. Speaker ID check (most important)
    speaker = speaker_id.identify_speaker(audio_buffer)
    
    if speaker is None:
        # Unknown voice - reject
        return False
    
    # 2. Confidence threshold
    if speaker.confidence < 0.75:
        # Not confident enough - reject
        print(f"Low confidence: {speaker.confidence:.2f}")
        return False
    
    # 3. Volume check (TV is usually louder)
    volume = np.abs(audio_buffer).mean()
    
    if volume > VOLUME_THRESHOLD:
        # Might be TV - extra verification
        print("High volume detected, requiring higher confidence")
        return speaker.confidence > 0.85
    
    # 4. Check if TV is on (from Home Assistant)
    tv_state = ha.get_state('media_player.living_room_tv')
    
    if tv_state == 'playing' and speaker.confidence < 0.80:
        # TV is on, require higher confidence
        print("TV is playing, requiring higher confidence")
        return False
    
    return True
```

---

### **1.8 Multi-Speaker Scenarios**

**Scenario: Multiple people in room**

```python
# voice_pipeline/multi_speaker.py
class MultiSpeakerHandler:
    def __init__(self):
        self.current_conversation_user = None
        self.conversation_timeout = 30  # seconds
        self.last_command_time = None
    
    def handle_command(self, speaker: SpeakerResult, text: str):
        """
        Handle commands from multiple users
        
        Rules:
        1. First command sets "active user" for 30 seconds
        2. Only active user can issue commands during this window
        3. After timeout, anyone can become active user
        4. "Cairo, stop" from any enrolled user stops everything
        """
        current_time = time.time()
        
        # Check if conversation timed out
        if (self.last_command_time and 
            current_time - self.last_command_time > self.conversation_timeout):
            self.current_conversation_user = None
        
        # Emergency stop from any enrolled user
        if text.lower() in ['stop', 'cancel', 'never mind']:
            self.current_conversation_user = None
            return True
        
        # If no active conversation, this user becomes active
        if self.current_conversation_user is None:
            self.current_conversation_user = speaker.user_id
            self.last_command_time = current_time
            return True
        
        # If active conversation, only that user can command
        if speaker.user_id == self.current_conversation_user:
            self.last_command_time = current_time
            return True
        else:
            print(f"{speaker.user_id} tried to interrupt {self.current_conversation_user}'s conversation")
            # Could say: "I'm currently talking to {active_user}"
            return False
```

---

### **Updated Total Voice Pipeline Latency:**

**With Speaker ID:**
- Wake word detection: 50ms
- VAD speech end detection: 30ms
- **Speaker identification: 100-200ms** (NEW)
- ASR processing: 300-800ms
- **Total: 480-1080ms** from "you stop speaking" to "router gets text"

**Trade-off:** +100-200ms latency for security and personalization

**CPU Impact:** Speaker ID adds ~5% CPU usage (Resemblyzer is efficient)

---

### **Database Schema for Voice Profiles**

```sql
-- Already in original schema, but expanded:
CREATE TABLE voice_profile (
  user_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,  -- 256 float32 values = 1KB
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used DATETIME,
  confidence_history TEXT,  -- JSON array of recent confidences
  sample_count INTEGER DEFAULT 5
);

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  friendly_name TEXT,
  permissions TEXT,  -- JSON permissions object
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_voice_profile_last_used ON voice_profile(last_used);
```

---

## Summary of Voice Fingerprinting

**What it does:**
- Identifies WHO is speaking
- Rejects unknown speakers (TV, guests)
- Per-user permissions
- Prevents accidental triggering from media

**How it works:**
- Creates 256-dimensional voice embedding
- Compares with enrolled user embeddings
- Requires 75%+ similarity to match
- 100-200ms latency

**Enrollment:**
- User speaks 5 different phrases
- System creates average embedding
- Stored in database
- Takes 2-3 minutes total

**Security:**
- Unknown speakers rejected by default
- Per-user permissions (lights vs. locks)
- Multi-speaker handling (conversation tracking)
- Optional "guest mode" for limited access

**For robotics:**
- Same system works for robot commands
- "Only I can command the robot to pick things up"
- Safety-critical for physical manipulation

This solves your TV problem! 🎯

---

## 2. Router {#router}

The router is the **traffic cop** of Cairo. It decides what to do with incoming text.

```
Text Input → Intent Classification → Slot Filling → Route Decision → Output
```

### **2.1 What the Router Does**

**Primary job:** Fast intent classification

**Intents it handles:**
- `device_control` - Turn on lights, adjust temperature, etc.
- `query` - What's the temperature? Is door locked?
- `automation` - Create rule, suggest automation
- `scene` - Make it cozy, movie time, etc.
- `planning` - Multi-step tasks (needs planner)
- `smalltalk` - Hi, how are you?
- `unknown` - Can't understand

**Why separate router from planner?**
- Router is FAST (10-30ms) for simple commands
- Planner is SLOW (1-3 seconds) for complex tasks
- 80% of commands are simple, don't need planning

---

### **2.2 Router Architecture**

```typescript
// router/types.ts
export interface RouterInput {
  text: string;
  context?: {
    user_id?: string;
    location?: string;
    time?: Date;
    recent_history?: string[];
  };
}

export interface RouterOutput {
  intent: Intent;
  confidence: number;
  slots: Record<string, any>;
  needs_planner: boolean;
  suggested_response?: string;
}

export type Intent = 
  | 'device_control'
  | 'query'
  | 'automation'
  | 'scene'
  | 'planning'
  | 'smalltalk'
  | 'unknown';
```

---

### **2.3 Router Implementation (Two-Stage)**

**Stage 1: Fast Pattern Matching (Regex + Keywords)**

```typescript
// router/fast_matcher.ts
export class FastMatcher {
  private patterns: Map<Intent, RegExp[]>;
  
  constructor() {
    this.patterns = new Map([
      ['device_control', [
        /turn (on|off) (the )?(.+)/i,
        /set (.+) to (\d+)/i,
        /(dim|brighten) (the )?(.+)/i,
        /(open|close) (the )?(.+)/i
      ]],
      ['query', [
        /what('s| is) (the )?(.+)/i,
        /is (the )?(.+) (on|off|locked|open)/i,
        /how (hot|cold|warm|bright) is (.+)/i,
        /(check|show|tell me) (the )?(.+)/i
      ]],
      ['scene', [
        /make it (cozy|bright|dark|warm|cool)/i,
        /(movie|focus|sleep|morning|bedtime|evening) (time|mode)/i,
        /i('m| am) (leaving|home|going to bed)/i
      ]]
    ]);
  }
  
  match(text: string): RouterOutput | null {
    for (const [intent, patterns] of this.patterns) {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        
        if (match) {
          // Extract slots from regex groups
          const slots = this.extractSlots(intent, match);
          
          return {
            intent,
            confidence: 0.95,
            slots,
            needs_planner: this.needsPlanning(intent, slots)
          };
        }
      }
    }
    
    return null; // No match, fall through to ML
  }
  
  private extractSlots(intent: Intent, match: RegExpMatchArray): Record<string, any> {
    switch (intent) {
      case 'device_control':
        return {
          action: match[1],  // on/off
          entity: match[3]   // device name
        };
      
      case 'query':
        return {
          property: match[1],
          entity: match[3]
        };
      
      case 'scene':
        return {
          scene_type: match[1]
        };
      
      default:
        return {};
    }
  }
  
  private needsPlanning(intent: Intent, slots: Record<string, any>): boolean {
    // Scenes always need planning (multi-step)
    if (intent === 'scene') return true;
    
    // Simple device control doesn't need planning
    if (intent === 'device_control' && slots.entity) return false;
    
    // Everything else might need planning
    return true;
  }
}
```

**Latency:** 1-5ms (extremely fast)

**Accuracy:** ~85% on simple commands

---

**Stage 2: ML-Based Classification (for harder cases)**

```typescript
// router/ml_classifier.ts
import Anthropic from '@anthropic-ai/sdk';

export class MLClassifier {
  private client: Anthropic;
  private entityCatalog: Map<string, EntityInfo>;
  
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    
    // Load entity catalog
    this.entityCatalog = this.loadEntityCatalog();
  }
  
  async classify(text: string, context?: any): Promise<RouterOutput> {
    // Build prompt with context
    const prompt = this.buildPrompt(text, context);
    
    // Call Claude (fast Haiku model)
    const response = await this.client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 200,
      temperature: 0,
      system: `You are a smart home intent classifier. Return JSON only.`,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    // Parse response
    const result = JSON.parse(response.content[0].text);
    
    return {
      intent: result.intent,
      confidence: result.confidence,
      slots: result.slots,
      needs_planner: result.needs_planner
    };
  }
  
  private buildPrompt(text: string, context?: any): string {
    const availableDevices = Array.from(this.entityCatalog.keys()).join(', ');
    
    return `
Classify this command and extract entities:

Command: "${text}"

Available devices: ${availableDevices}

Context:
- Time: ${context?.time || 'unknown'}
- Location: ${context?.location || 'unknown'}
- Recent commands: ${context?.recent_history?.join(', ') || 'none'}

Return JSON:
{
  "intent": "device_control" | "query" | "scene" | "automation" | "planning" | "smalltalk" | "unknown",
  "confidence": 0.0-1.0,
  "slots": {
    // Extracted entities (entity_id, action, value, etc.)
  },
  "needs_planner": boolean,
  "reasoning": "brief explanation"
}

Rules:
- Match device names fuzzy ("living room light" → "light.living_room_lamp")
- Simple commands don't need planner
- Scenes and multi-step tasks need planner
`;
  }
  
  private loadEntityCatalog(): Map<string, EntityInfo> {
    // Load from database
    const catalog = new Map();
    
    // Example entries
    catalog.set('light.desk_lamp', {
      friendly_name: 'Desk Lamp',
      aliases: ['desk light', 'desk', 'lamp'],
      domain: 'light',
      capabilities: ['on_off', 'brightness', 'color']
    });
    
    catalog.set('switch.coffee_maker', {
      friendly_name: 'Coffee Maker',
      aliases: ['coffee', 'coffee machine'],
      domain: 'switch',
      capabilities: ['on_off']
    });
    
    return catalog;
  }
}
```

**Latency:** 100-300ms (API call)

**Accuracy:** ~98% (very good with context)

**Cost:** ~$0.001 per classification (cheap)

---

### **2.4 Router Orchestrator**

```typescript
// router/router.ts
export class Router {
  private fastMatcher: FastMatcher;
  private mlClassifier: MLClassifier;
  private ragStore: RAGStore;
  
  constructor(eventBus: EventBus) {
    this.fastMatcher = new FastMatcher();
    this.mlClassifier = new MLClassifier();
    this.ragStore = new RAGStore();
    
    // Listen for speech.final events
    eventBus.subscribe('speech.final', async (event) => {
      await this.route(event.data.text);
    });
  }
  
  async route(text: string): Promise<RouterOutput> {
    const startTime = Date.now();
    
    // Try fast matcher first
    let result = this.fastMatcher.match(text);
    
    if (!result) {
      // Fall back to ML
      console.log('Fast match failed, using ML classifier...');
      result = await this.mlClassifier.classify(text);
    }
    
    const latency = Date.now() - startTime;
    
    // Log metrics
    console.log(`Router: ${text} → ${result.intent} (${latency}ms)`);
    
    // Publish result
    await this.eventBus.publish('intent.detected', {
      text,
      ...result,
      latency_ms: latency
    });
    
    // Decide next step
    if (result.needs_planner) {
      // Send to planner
      await this.eventBus.publish('planner.request', {
        intent: result.intent,
        slots: result.slots,
        original_text: text
      });
    } else {
      // Execute directly
      await this.executeDirect(result);
    }
    
    return result;
  }
  
  private async executeDirect(result: RouterOutput) {
    // Simple device control can execute immediately
    if (result.intent === 'device_control') {
      await this.eventBus.publish('tool.request', {
        tool: 'ha.call_service',
        args: {
          domain: result.slots.domain || 'light',
          service: result.slots.action,
          entity_id: result.slots.entity_id
        }
      });
    }
    
    // Queries execute immediately
    else if (result.intent === 'query') {
      await this.eventBus.publish('tool.request', {
        tool: 'ha.read_state',
        args: {
          entity_id: result.slots.entity_id
        }
      });
    }
    
    // Smalltalk gets a canned response
    else if (result.intent === 'smalltalk') {
      await this.eventBus.publish('tts.request', {
        text: "Hi! I'm here to help with your home."
      });
    }
  }
}
```

**Total Router Latency:**
- Fast path: 1-5ms
- ML path: 100-300ms
- **Average: ~150ms for 80% of commands**

---

## 3. Planner {#planner}

The planner handles **complex, multi-step tasks** that the router can't execute directly.

### **3.1 When Planner is Needed**

- **Scenes:** "Make it cozy" → dim lights + warm colors + soft music
- **Routines:** "Good morning" → open blinds + coffee + news
- **Context-dependent:** "Turn on the lights" when multiple rooms
- **Multi-step:** "Lock all doors and turn off all lights"
- **Conditional:** "If temperature > 75, turn on AC"

---

### **3.2 Planner Architecture**

```typescript
// planner/types.ts
export interface PlannerRequest {
  intent: Intent;
  slots: Record<string, any>;
  original_text: string;
  context?: any;
}

export interface Plan {
  id: string;
  steps: PlanStep[];
  preview: string;
  estimated_duration_ms: number;
  requires_approval: boolean;
}

export interface PlanStep {
  id: string;
  kind: 'tool' | 'think' | 'ask' | 'wait';
  description: string;
  tool?: string;
  args?: any;
  depends_on?: string[];  // IDs of steps that must complete first
  timeout_ms?: number;
}
```

---

### **3.3 Planner Implementation**

```typescript
// planner/planner.ts
import Anthropic from '@anthropic-ai/sdk';

export class Planner {
  private client: Anthropic;
  private toolRegistry: ToolRegistry;
  
  constructor(eventBus: EventBus) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    
    this.toolRegistry = new ToolRegistry();
    
    // Listen for planner requests
    eventBus.subscribe('planner.request', async (event) => {
      await this.plan(event.data);
    });
  }
  
  async plan(request: PlannerRequest): Promise<Plan> {
    console.log(`Planning for: ${request.original_text}`);
    
    // Get available tools
    const tools = await this.toolRegistry.getAllTools();
    
    // Get current state
    const currentState = await this.getCurrentState();
    
    // Build prompt
    const prompt = this.buildPrompt(request, tools, currentState);
    
    // Call Claude with streaming
    const stream = await this.client.messages.stream({
      model: 'claude-sonnet-4-20250514',  // Smarter model for planning
      max_tokens: 2000,
      temperature: 0,
      system: this.getSystemPrompt(tools),
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    // Stream thinking process to UI
    let fullResponse = '';
    
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && 
          chunk.delta.type === 'text_delta') {
        
        const text = chunk.delta.text;
        fullResponse += text;
        
        // Publish streaming updates
        await this.eventBus.publish('planner.thinking', {
          text,
          full_text_so_far: fullResponse
        });
      }
    }
    
    // Parse plan from response
    const plan = this.parsePlan(fullResponse);
    
    // Publish complete plan
    await this.eventBus.publish('plan.created', plan);
    
    // If requires approval, wait for it
    if (plan.requires_approval) {
      await this.requestApproval(plan);
    } else {
      // Execute immediately
      await this.executePlan(plan);
    }
    
    return plan;
  }
  
  private buildPrompt(
    request: PlannerRequest, 
    tools: Tool[], 
    state: any
  ): string {
    return `
User command: "${request.original_text}"

Intent: ${request.intent}
Extracted slots: ${JSON.stringify(request.slots, null, 2)}

Current state:
${JSON.stringify(state, null, 2)}

Available tools:
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Create a step-by-step plan to fulfill this request.

Requirements:
1. Break down into atomic steps
2. Each step must use an available tool
3. Consider dependencies between steps
4. Include error handling
5. Provide natural language preview

Return plan as JSON:
{
  "preview": "I'll dim the lights to 30%, set color to warm white, and play soft jazz music.",
  "steps": [
    {
      "id": "step_1",
      "kind": "tool",
      "description": "Dim living room light to 30%",
      "tool": "ha.call_service",
      "args": {
        "domain": "light",
        "service": "turn_on",
        "data": {
          "entity_id": "light.living_room_lamp",
          "brightness_pct": 30
        }
      }
    },
    ...
  ],
  "requires_approval": false
}
`;
  }
  
  private getSystemPrompt(tools: Tool[]): string {
    return `You are Cairo's task planner. You break down complex requests into executable steps.

Rules:
1. Use ONLY tools from the available list
2. Steps must be executable and atomic
3. Consider current device states
4. Handle edge cases gracefully
5. If unsure, ask for clarification (kind: "ask")
6. Require approval for risky actions (locks, thermostats, etc.)

Output valid JSON only.`;
  }
  
  private parsePlan(response: string): Plan {
    // Extract JSON from response (might have thinking text before/after)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('Failed to parse plan from response');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      id: generateId(),
      steps: parsed.steps,
      preview: parsed.preview,
      estimated_duration_ms: this.estimateDuration(parsed.steps),
      requires_approval: parsed.requires_approval || false
    };
  }
  
  private async executePlan(plan: Plan) {
    console.log(`Executing plan: ${plan.id}`);
    
    // Publish plan execution start
    await this.eventBus.publish('plan.executing', {
      plan_id: plan.id,
      total_steps: plan.steps.length
    });
    
    // Execute steps in order (respecting dependencies)
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      // Check dependencies
      if (step.depends_on && step.depends_on.length > 0) {
        // Wait for dependent steps to complete
        await this.waitForSteps(step.depends_on);
      }
      
      // Execute step
      try {
        await this.executeStep(step);
        
        // Publish progress
        await this.eventBus.publish('plan.step_complete', {
          plan_id: plan.id,
          step_id: step.id,
          step_number: i + 1,
          total_steps: plan.steps.length
        });
        
      } catch (error) {
        console.error(`Step ${step.id} failed:`, error);
        
        // Publish error
        await this.eventBus.publish('plan.step_failed', {
          plan_id: plan.id,
          step_id: step.id,
          error: error.message
        });
        
        // Attempt recovery or abort
        const shouldContinue = await this.handleStepFailure(plan, step, error);
        
        if (!shouldContinue) {
          await this.eventBus.publish('plan.aborted', {
            plan_id: plan.id,
            reason: 'Step failure, cannot continue'
          });
          break;
        }
      }
    }
    
    // Plan complete
    await this.eventBus.publish('plan.complete', {
      plan_id: plan.id
    });
  }
  
  private async executeStep(step: PlanStep) {
    switch (step.kind) {
      case 'tool':
        // Call tool via event bus
        const result = await this.callTool(step.tool!, step.args!);
        return result;
      
      case 'wait':
        // Wait for specified duration
        await new Promise(resolve => 
          setTimeout(resolve, step.args.duration_ms)
        );
        return;
      
      case 'ask':
        // Ask user for input
        const answer = await this.askUser(step.description);
        return answer;
      
      case 'think':
        // Just log the thinking step
        console.log(`Thinking: ${step.description}`);
        return;
    }
  }
  
  private async handleStepFailure(
    plan: Plan, 
    failedStep: PlanStep, 
    error: Error
  ): Promise<boolean> {
    // Simple retry logic
    console.log(`Attempting to recover from step failure...`);
    
    // If step is not critical, continue
    if (failedStep.args?.optional) {
      return true;
    }
    
    // Try to replan
    console.log('Replanning...');
    await this.eventBus.publish('plan.replanning', {
      plan_id: plan.id,
      failed_step: failedStep.id
    });
    
    // ... replanning logic ...
    
    return false; // Abort for now
  }
}
```

**Planner Latency:**
- Planning: 1-3 seconds (LLM call + streaming)
- Execution: Depends on steps (typically 2-10 seconds for 3-5 steps)
- **Total: 3-13 seconds for complex multi-step tasks**

---

## 4. Vision Pipeline {#vision-pipeline}

Vision converts camera feeds into **semantic events**, not raw pixels.

```
Camera → Frame Capture → Object Detection → Scene Understanding → Events
```

### **4.1 Architecture**

```python
# vision/pipeline.py
import cv2
from ultralytics import YOLO
import numpy as np

class VisionPipeline:
    def __init__(self):
        # Load object detection model
        self.model = YOLO('yolov8n.pt')  # Nano model for speed
        
        # Camera config
        self.camera = cv2.VideoCapture(0)  # USB camera
        self.camera.set(cv2.CAP_PROP_FPS, 10)  # 10 FPS is enough
        
        # Tracking state
        self.previous_detections = {}
        self.motion_detector = MotionDetector()
        
    def process_frame(self):
        """Process single frame and return events"""
        # Capture frame
        ret, frame = self.camera.read()
        if not ret:
            return []
        
        # Run object detection
        results = self.model(frame, conf=0.5, verbose=False)
        
        # Extract detections
        detections = []
        for r in results:
            for box in r.boxes:
                detections.append({
                    'class': r.names[int(box.cls[0])],
                    'confidence': float(box.conf[0]),
                    'bbox': box.xyxy[0].tolist(),
                    'timestamp': datetime.now()
                })
        
        # Detect motion
        motion_events = self.motion_detector.detect(frame)
        
        # Generate semantic events
        events = self.analyze_scene(detections, motion_events)
        
        # Update state
        self.previous_detections = {d['class']: d for d in detections}
        
        return events
    
    def analyze_scene(self, detections, motion_events):
        """Convert detections into semantic events"""
        events = []
        
        # Person detection
        persons = [d for d in detections if d['class'] == 'person']
        if len(persons) > 0 and 'person' not in self.previous_detections:
            events.append({
                'type': 'vision.person_detected',
                'count': len(persons),
                'location': self.estimate_location(persons[0]['bbox']),
                'confidence': persons[0]['confidence']
            })
        
        # Low light detection
        brightness = self.estimate_brightness(frame)
        if brightness < 50 and len(persons) > 0:
            events.append({
                'type': 'vision.low_light_with_person',
                'brightness': brightness,
                'suggestion': 'turn_on_lights'
            })
        
        # Object left unattended
        for detection in detections:
            if detection['class'] in ['backpack', 'suitcase', 'handbag']:
                if self.is_stationary(detection):
                    events.append({
                        'type': 'vision.object_left',
                        'object_type': detection['class'],
                        'duration_sec': self.get_stationary_duration(detection)
                    })
        
        # Package delivery
        if 'box' in [d['class'] for d in detections]:
            if self.is_near_door(detections[0]['bbox']):
                events.append({
                    'type': 'vision.package_delivered',
                    'location': 'front_door'
                })
        
        return events
    
    async def run(self):
        """Main loop"""
        while True:
            events = self.process_frame()
            
            # Publish events to event bus
            for event in events:
                await publish_event(event)
            
            # Sleep to maintain frame rate
            await asyncio.sleep(0.1)  # 10 FPS
```

**Vision Events Examples:**
```python
{
  'type': 'vision.person_detected',
  'count': 1,
  'location': 'living_room',
  'confidence': 0.92
}

{
  'type': 'vision.low_light_with_person',
  'brightness': 35,
  'suggestion': 'turn_on_lights'
}

{
  'type': 'vision.package_delivered',
  'location': 'front_door',
  'timestamp': '2025-10-27T14:30:00Z'
}
```

**Vision Pipeline Latency:**
- Frame capture: 10ms
- Object detection: 50-100ms (YOLOv8n on CPU)
- Scene analysis: 5-10ms
- **Total: 65-120ms per frame @ 10 FPS**

**CPU Usage:** ~15-20% continuous

---

## 5. RAG Store {#rag-store}

RAG (Retrieval Augmented Generation) store provides **memory** and **context** to the router and planner.

### **5.1 What Goes in RAG Store**

- **Transcripts:** All voice commands and responses
- **User preferences:** Learned from behavior
- **Automation history:** What automations worked well
- **Entity metadata:** Device names, locations, capabilities
- **Patterns:** Detected behavioral patterns
- **Context:** Room names, user names, schedule info

---

### **5.2 RAG Store Architecture**

Using **SQLite FTS5** (Full Text Search) for simplicity:

```sql
-- rag_store.db schema

-- Full text search table for documents
CREATE VIRTUAL TABLE documents USING fts5(
  id UNINDEXED,
  content,
  metadata,
  embedding UNINDEXED,
  timestamp UNINDEXED
);

-- Index for fast retrieval
CREATE INDEX idx_documents_timestamp ON documents(timestamp);

-- Embeddings table (if using vector search later)
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  embedding BLOB,  -- Vector embedding
  source_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### **5.3 RAG Store Implementation**

```typescript
// rag/store.ts
import Database from 'better-sqlite3';

export class RAGStore {
  private db: Database.Database;
  
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }
  
  async addDocument(doc: Document) {
    const stmt = this.db.prepare(`
      INSERT INTO documents (id, content, metadata, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(
      doc.id,
      doc.content,
      JSON.stringify(doc.metadata),
      doc.timestamp || new Date().toISOString()
    );
  }
  
  async search(query: string, limit: number = 5): Promise<Document[]> {
    // FTS5 full-text search
    const stmt = this.db.prepare(`
      SELECT id, content, metadata, timestamp, rank
      FROM documents
      WHERE documents MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    
    const results = stmt.all(query, limit);
    
    return results.map(row => ({
      id: row.id,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      timestamp: row.timestamp,
      relevance: -row.rank  // FTS5 rank is negative
    }));
  }
  
  async addTranscript(text: string, response: string, metadata: any) {
    const doc = {
      id: generateId(),
      content: `User: ${text}\nCairo: ${response}`,
      metadata: {
        type: 'transcript',
        user_text: text,
        cairo_response: response,
        ...metadata
      }
    };
    
    await this.addDocument(doc);
  }
  
  async addUserPreference(preference: string, value: any) {
    const doc = {
      id: generateId(),
      content: `Preference: ${preference} = ${value}`,
      metadata: {
        type: 'preference',
        key: preference,
        value
      }
    };
    
    await this.addDocument(doc);
  }
  
  async findRelevantContext(query: string): Promise<string> {
    const results = await this.search(query, 3);
    
    if (results.length === 0) {
      return '';
    }
    
    return results.map(r => r.content).join('\n\n');
  }
}
```

---

### **5.4 How RAG is Used**

**In Router:**
```typescript
// router/router.ts
async route(text: string): Promise<RouterOutput> {
  // Get relevant context from RAG
  const context = await this.ragStore.findRelevantContext(text);
  
  // Use context in ML classification
  const result = await this.mlClassifier.classify(text, {
    relevant_history: context
  });
  
  return result;
}
```

**In Planner:**
```typescript
// planner/planner.ts
async plan(request: PlannerRequest): Promise<Plan> {
  // Get user preferences
  const preferences = await this.ragStore.search('preference', 10);
  
  // Get similar past commands
  const similar = await this.ragStore.search(request.original_text, 5);
  
  // Include in planning prompt
  const prompt = `
    User command: ${request.original_text}
    
    User preferences:
    ${preferences.map(p => p.content).join('\n')}
    
    Similar past interactions:
    ${similar.map(s => s.content).join('\n')}
    
    ...
  `;
  
  return await this.createPlan(prompt);
}
```

**RAG Store Size:**
- ~1KB per transcript
- ~500 bytes per preference
- **Expected size after 6 months: ~50MB**

---

## 6. Event Bus {#event-bus}

The event bus is Cairo's **nervous system**. Everything communicates through it.

### **6.1 Why Event Bus?**

**Benefits:**
- Decoupled components
- Easy to add new services
- Replay events for debugging
- Time-travel debugging
- Audit trail built-in

**Alternative (without event bus):**
- Direct function calls between services
- Tight coupling
- Hard to test
- No audit trail

---

### **6.2 Event Bus Architecture**

Using **Redis Streams** for durability and ordering:

```typescript
// event_bus/bus.ts
import { createClient } from 'redis';

export class EventBus {
  private redis: RedisClient;
  private subscribers: Map<string, Subscriber[]>;
  
  constructor() {
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.subscribers = new Map();
    
    await this.redis.connect();
  }
  
  async publish(topic: string, data: any): Promise<string> {
    // Create event with metadata
    const event = {
      id: generateId(),
      topic,
      data,
      timestamp: new Date().toISOString(),
      correlation_id: this.getCurrentCorrelationId()
    };
    
    // Add to Redis Stream
    const eventId = await this.redis.xAdd(
      `stream:${topic}`,
      '*',  // Auto-generate ID
      {
        payload: JSON.stringify(event)
      },
      {
        TRIM: {
          strategy: 'MAXLEN',
          threshold: 10000,  // Keep last 10k events
          strategyModifier: '~'
        }
      }
    );
    
    // Also log to SQLite for long-term storage
    await this.logToDatabase(event);
    
    // Notify local subscribers immediately
    await this.notifySubscribers(topic, event);
    
    return eventId;
  }
  
  async subscribe(topic: string, handler: EventHandler): Promise<void> {
    // Add to local subscribers
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, []);
    }
    
    this.subscribers.get(topic)!.push({
      handler,
      id: generateId()
    });
    
    // Start consumer group for this topic (if not already running)
    await this.startConsumerGroup(topic);
  }
  
  private async startConsumerGroup(topic: string) {
    const groupName = `group:${topic}`;
    const consumerName = `consumer:${process.pid}`;
    const streamKey = `stream:${topic}`;
    
    // Create consumer group if doesn't exist
    try {
      await this.redis.xGroupCreate(streamKey, groupName, '0', {
        MKSTREAM: true
      });
    } catch (e) {
      // Group already exists
    }
    
    // Start consuming
    this.consumeStream(streamKey, groupName, consumerName);
  }
  
  private async consumeStream(
    streamKey: string, 
    groupName: string, 
    consumerName: string
  ) {
    while (true) {
      try {
        // Read from stream
        const results = await this.redis.xReadGroup(
          groupName,
          consumerName,
          [{ key: streamKey, id: '>' }],  // Read new messages
          {
            COUNT: 10,
            BLOCK: 1000  // Block for 1 second
          }
        );
        
        if (!results || results.length === 0) {
          continue;
        }
        
        // Process messages
        for (const result of results) {
          for (const message of result.messages) {
            const event = JSON.parse(message.message.payload);
            
            // Notify subscribers
            await this.notifySubscribers(event.topic, event);
            
            // Acknowledge message
            await this.redis.xAck(streamKey, groupName, message.id);
          }
        }
        
      } catch (error) {
        console.error('Stream consumption error:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  
  private async notifySubscribers(topic: string, event: Event) {
    const subscribers = this.subscribers.get(topic) || [];
    
    for (const sub of subscribers) {
      try {
        await sub.handler(event);
      } catch (error) {
        console.error(`Subscriber error for ${topic}:`, error);
      }
    }
  }
  
  private async logToDatabase(event: Event) {
    // Log to SQLite for long-term storage
    await db.run(`
      INSERT INTO event (ts, source, type, key, data_json)
      VALUES (?, ?, ?, ?, ?)
    `, [
      event.timestamp,
      'event_bus',
      event.topic,
      event.id,
      JSON.stringify(event.data)
    ]);
  }
}
```

---

### **6.3 Event Topics**

```typescript
// All topics Cairo uses:

// Speech
'wake_word.detected'
'speech.started'
'speech.partial'
'speech.final'
'speech.ended'

// Intent
'intent.detected'
'intent.unknown'

// Planning
'planner.request'
'planner.thinking'
'plan.created'
'plan.executing'
'plan.step_complete'
'plan.step_failed'
'plan.complete'
'plan.aborted'

// Tools
'tool.request'
'tool.result'
'tool.error'

// Devices
'device.state_changed'
'device.discovered'
'device.offline'

// Vision
'vision.frame'
'vision.person_detected'
'vision.low_light_with_person'
'vision.package_delivered'
'vision.event'

// Automation
'automation.suggested'
'automation.created'
'automation.triggered'
'automation.disabled'

// Self-config
'discovery.new_device'
'self_config.approval_requested'
'self_config.approved'
'self_config.applied'
'self_config.rolled_back'

// TTS
'tts.request'
'tts.started'
'tts.complete'

// Notifications
'notif.push'
'notif.displayed'
```

---

### **6.4 Event Flow Example**

**"Turn on the desk lamp":**

```
1. wake_word.detected → Voice pipeline activates
2. speech.partial → "Turn on..." (streaming)
3. speech.final → "Turn on the desk lamp"
4. intent.detected → {intent: device_control, entity: desk_lamp}
5. tool.request → ha.call_service(light, turn_on, desk_lamp)
6. tool.result → {success: true, state: on}
7. device.state_changed → desk_lamp: off → on
8. tts.request → "Desk lamp turned on"
9. tts.complete
```

**Total events: 9**
**Total latency: ~600ms**

---

## 7. MQTT Integration {#mqtt-integration}

MQTT is how Home Assistant communicates with Zigbee/Z-Wave devices.

### **7.1 What is MQTT?**

**MQTT = Message Queue Telemetry Transport**
- Lightweight pub/sub protocol
- Used by IoT devices
- Home Assistant uses it for device communication

```
Device → Zigbee Stick → MQTT Broker → Home Assistant
                           ↓
                         Cairo
```

---

### **7.2 MQTT in Cairo**

Cairo **listens** to MQTT for device state changes:

```typescript
// mqtt/client.ts
import mqtt from 'mqtt';

export class MQTTClient {
  private client: mqtt.MqttClient;
  
  constructor(eventBus: EventBus) {
    this.client = mqtt.connect('mqtt://localhost:1883', {
      username: 'cairo',
      password: process.env.MQTT_PASSWORD
    });
    
    // Subscribe to all Home Assistant topics
    this.client.on('connect', () => {
      console.log('Connected to MQTT broker');
      
      // Subscribe to state changes
      this.client.subscribe('homeassistant/#');
      
      // Subscribe to discovery
      this.client.subscribe('homeassistant/status');
    });
    
    // Handle incoming messages
    this.client.on('message', async (topic, payload) => {
      await this.handleMessage(topic, payload.toString());
    });
  }
  
  async handleMessage(topic: string, payload: string) {
    // Parse topic
    const parts = topic.split('/');
    
    if (parts[0] === 'homeassistant') {
      // Device state change
      if (parts[1] && parts[2]) {
        const domain = parts[1];  // light, switch, sensor, etc.
        const entity_id = parts[2];
        
        const data = JSON.parse(payload);
        
        // Publish to event bus
        await this.eventBus.publish('device.state_changed', {
          entity_id: `${domain}.${entity_id}`,
          state: data.state,
          attributes: data.attributes,
          timestamp: new Date()
        });
      }
      
      // Discovery message
      else if (parts[1] === 'status' && payload === 'online') {
        // Home Assistant came online
        await this.eventBus.publish('ha.online', {});
      }
    }
  }
  
  async publish(topic: string, payload: any) {
    // Cairo can also publish to MQTT (rare, usually goes through HA)
    this.client.publish(
      topic,
      JSON.stringify(payload),
      { qos: 1, retain: false }
    );
  }
}
```

**Why Cairo uses MQTT:**
- Get real-time device state changes (faster than polling HA)
- Listen for discovery messages (new devices)
- Optional: Publish directly to devices (bypass HA)

**In practice:**
- MQTT runs in Docker container (Mosquitto)
- HA and Cairo both connect as clients
- Cairo mostly **listens**, rarely publishes

---

## 8. MCP Tool Layer {#mcp-tool-layer}

**MCP = Model Context Protocol**

It's a standardized way for AI models to use tools.

### **8.1 Why MCP?**

**Problem:** Every AI system has custom tool formats
**Solution:** MCP provides a standard: tool definitions, calls, results

**Benefits:**
- Swap LLM providers easily
- Reuse tools across projects
- Type safety with JSON Schema
- Clear separation of concerns

---

### **8.2 MCP Tool Structure**

```typescript
// mcp/types.ts
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  execute: (input: any) => Promise<any>;
  safety_level: 'read' | 'write_safe' | 'write_risky';
}

// Example: HA read state tool
export const readStateTool: MCPTool = {
  name: 'ha.read_state',
  description: 'Read the current state of a Home Assistant entity',
  
  inputSchema: {
    type: 'object',
    properties: {
      entity_id: {
        type: 'string',
        description: 'Entity ID (e.g. light.living_room_lamp)',
        pattern: '^[a-z_]+\.[a-z0-9_]+$'
      }
    },
    required: ['entity_id']
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string' },
      attributes: { type: 'object' },
      last_changed: { type: 'string' }
    }
  },
  
  async execute(input) {
    // Validate input
    const valid = validate(this.inputSchema, input);
    if (!valid) {
      throw new Error('Invalid input');
    }
    
    // Call Home Assistant API
    const response = await fetch(
      `${HA_URL}/api/states/${input.entity_id}`,
      {
        headers: {
          'Authorization': `Bearer ${HA_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Entity not found: ${input.entity_id}`);
    }
    
    const data = await response.json();
    
    return {
      state: data.state,
      attributes: data.attributes,
      last_changed: data.last_changed
    };
  },
  
  safety_level: 'read'  // Safe, read-only
};
```

---

### **8.3 MCP Tool Registry**

```typescript
// mcp/registry.ts
export class ToolRegistry {
  private tools: Map<string, MCPTool>;
  
  constructor() {
    this.tools = new Map();
    this.loadDefaultTools();
  }
  
  registerTool(tool: MCPTool) {
    this.tools.set(tool.name, tool);
    console.log(`Registered tool: ${tool.name}`);
  }
  
  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }
  
  getAllTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }
  
  async callTool(name: string, input: any): Promise<any> {
    const tool = this.getTool(name);
    
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    
    // Log call
    console.log(`Calling tool: ${name}`, input);
    
    // Check safety level
    if (tool.safety_level === 'write_risky') {
      // Require confirmation
      const confirmed = await requestConfirmation(
        `Execute ${name} with ${JSON.stringify(input)}?`
      );
      
      if (!confirmed) {
        throw new Error('User did not confirm');
      }
    }
    
    // Execute
    const startTime = Date.now();
    
    try {
      const result = await tool.execute(input);
      
      const duration = Date.now() - startTime;
      console.log(`Tool ${name} completed in ${duration}ms`);
      
      // Log to event bus
      await eventBus.publish('tool.result', {
        tool: name,
        input,
        result,
        duration_ms: duration,
        timestamp: new Date()
      });
      
      return result;
      
    } catch (error) {
      console.error(`Tool ${name} failed:`, error);
      
      // Log error
      await eventBus.publish('tool.error', {
        tool: name,
        input,
        error: error.message,
        timestamp: new Date()
      });
      
      throw error;
    }
  }
  
  private loadDefaultTools() {
    // Register all HA tools
    this.registerTool(readStateTool);
    this.registerTool(callServiceTool);
    this.registerTool(listEntitiesTo);
    this.registerTool(createAutomationTool);
    // ... etc
  }
}
```

---

### **8.4 Key HA Tools**

```typescript
// tools/ha/call_service.ts
export const callServiceTool: MCPTool = {
  name: 'ha.call_service',
  description: 'Call a Home Assistant service to control devices',
  
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        enum: ['light', 'switch', 'lock', 'climate', 'cover', 'media_player']
      },
      service: {
        type: 'string',
        description: 'Service name (e.g. turn_on, turn_off, set_temperature)'
      },
      data: {
        type: 'object',
        description: 'Service data',
        properties: {
          entity_id: { type: 'string' },
          brightness_pct: { type: 'number', minimum: 0, maximum: 100 },
          color_temp: { type: 'number' },
          rgb_color: { type: 'array', items: { type: 'number' } }
        }
      }
    },
    required: ['domain', 'service']
  },
  
  async execute(input) {
    const { domain, service, data } = input;
    
    // Call HA API
    const response = await fetch(
      `${HA_URL}/api/services/${domain}/${service}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HA_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data || {})
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`HA service call failed: ${error.message}`);
    }
    
    return { success: true };
  },
  
  safety_level: 'write_safe'  // Safe for most devices
};

// tools/ha/list_entities.ts
export const listEntitiesTool: MCPTool = {
  name: 'ha.list_entities',
  description: 'List all available Home Assistant entities with optional filtering',
  
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Filter by domain (e.g. light, switch)'
      },
      area: {
        type: 'string',
        description: 'Filter by area (e.g. living_room, bedroom)'
      }
    }
  },
  
  async execute(input) {
    // Get all states
    const response = await fetch(`${HA_URL}/api/states`, {
      headers: { 'Authorization': `Bearer ${HA_TOKEN}` }
    });
    
    let entities = await response.json();
    
    // Apply filters
    if (input.domain) {
      entities = entities.filter(e => 
        e.entity_id.startsWith(input.domain + '.')
      );
    }
    
    if (input.area) {
      entities = entities.filter(e => 
        e.attributes.area === input.area
      );
    }
    
    return entities.map(e => ({
      entity_id: e.entity_id,
      state: e.state,
      friendly_name: e.attributes.friendly_name,
      area: e.attributes.area
    }));
  },
  
  safety_level: 'read'
};
```

---

## 9. Self-Update System {#self-update-system}

This is the **magic** - Cairo modifies itself safely.

### **9.1 Self-Update Architecture**

```
Discovery → Analysis → Generation → Approval → Commit → Hot Reload
```

We already covered this in detail in Milestone 5, but here's how it integrates:

---

### **9.2 How Self-Update Works**

**Example: New light bulb added**

```typescript
// self_config/orchestrator.ts
export class SelfConfigOrchestrator {
  private discoveryEngine: DiscoveryEngine;
  private analyzer: ChangeAnalyzer;
  private generator: CodeGenerator;
  private approvalEngine: ApprovalEngine;
  private gitAudit: GitAuditTrail;
  private hotReload: HotReloadManager;
  
  async run() {
    // Listen for discoveries
    this.eventBus.subscribe('discovery.new_device', async (event) => {
      const device = event.data;
      
      console.log(`New device discovered: ${device.entity_id}`);
      
      // Step 1: Analyze what needs to change
      const changes = await this.analyzer.analyze(device);
      
      console.log(`Analysis: ${changes.suggested_actions.join(', ')}`);
      
      // Step 2: Generate code artifacts
      const artifacts = await this.generator.generateArtifacts(changes);
      
      console.log(`Generated ${artifacts.length} artifacts`);
      
      // Step 3: Request approval
      const approval = await this.approvalEngine.requestApproval(artifacts);
      
      // Wait for user approval
      const approved = await this.waitForApproval(approval.id);
      
      if (!approved) {
        console.log('User rejected changes');
        return;
      }
      
      // Step 4: Commit to git
      const tag = await this.gitAudit.commitChange(artifacts, approval);
      
      console.log(`Committed: ${tag}`);
      
      // Step 5: Hot reload services
      await this.hotReload.applyChanges(artifacts);
      
      console.log('Changes applied successfully!');
      
      // Publish success
      await this.eventBus.publish('self_config.applied', {
        device: device.entity_id,
        artifacts: artifacts.map(a => a.file_path),
        tag
      });
    });
  }
}
```

---

### **9.3 Generated Tool Example**

**Before self-config:**
```typescript
// tools/ha/light_control.ts
export const lightControlTools = [
  readStateTool,
  callServiceTool
];
```

**After new climate device discovered, Cairo generates:**

```typescript
// tools/ha/climate_control.ts (GENERATED)
export const climateControlTool: MCPTool = {
  name: 'ha.climate_control',
  description: 'Control climate devices (thermostats, AC)',
  
  inputSchema: {
    type: 'object',
    properties: {
      entity_id: { type: 'string' },
      action: {
        type: 'string',
        enum: ['set_temperature', 'set_mode', 'get_state']
      },
      temperature: { type: 'number', minimum: 60, maximum: 85 },
      mode: {
        type: 'string',
        enum: ['heat', 'cool', 'auto', 'off']
      }
    },
    required: ['entity_id', 'action']
  },
  
  async execute(input) {
    const { entity_id, action, temperature, mode } = input;
    
    if (action === 'get_state') {
      return await callTool('ha.read_state', { entity_id });
    }
    
    const data: any = { entity_id };
    
    if (action === 'set_temperature' && temperature) {
      data.temperature = temperature;
    }
    
    if (action === 'set_mode' && mode) {
      data.hvac_mode = mode;
    }
    
    return await callTool('ha.call_service', {
      domain: 'climate',
      service: action,
      data
    });
  },
  
  safety_level: 'write_safe'
};

// Auto-register
toolRegistry.registerTool(climateControlTool);
```

**What changed:**
- New file: `tools/ha/climate_control.ts`
- New vocabulary: Updated `router/patterns/climate.json`
- New tests: `tests/climate_control.test.ts`
- Git commit with full audit trail

**Result:** Cairo can now control thermostats without you writing code!

---

## 10. How It All Connects {#how-it-all-connects}

### **10.1 Complete Flow: "Turn on desk lamp"**

```
1. AUDIO INPUT
   └─> Wake word detector hears "Cairo"
   
2. WAKE WORD DETECTED
   └─> wake_word.detected event → Event Bus
   
3. VAD STARTS
   └─> Listens for speech
   └─> Detects "Turn on desk lamp"
   └─> speech.ended event → Event Bus
   
4. ASR PROCESSES
   └─> faster-whisper transcribes
   └─> speech.final: "Turn on desk lamp" → Event Bus
   
5. ROUTER RECEIVES
   └─> Fast matcher finds pattern: "turn on (.+)"
   └─> Extracts: action=turn_on, entity=desk_lamp
   └─> Queries RAG: finds entity_id=light.desk_lamp
   └─> intent.detected → Event Bus
   
6. ROUTER DECIDES
   └─> Simple command, no planner needed
   └─> Calls tool directly
   └─> tool.request: ha.call_service → Event Bus
   
7. TOOL EXECUTES
   └─> Tool registry receives tool.request
   └─> Calls ha.call_service(light, turn_on, light.desk_lamp)
   └─> HA API responds: success
   └─> tool.result → Event Bus
   
8. HA UPDATES
   └─> Light turns on physically
   └─> MQTT message: light.desk_lamp state=on
   └─> device.state_changed → Event Bus
   
9. TTS RESPONDS
   └─> Router generates response: "Desk lamp turned on"
   └─> tts.request → Event Bus
   └─> Piper synthesizes audio
   └─> Plays through speaker
   └─> tts.complete → Event Bus
   
10. UI UPDATES
    └─> UI subscribed to all events
    └─> Shows timeline:
        - Speech detected
        - Intent classified
        - Tool called
        - Device responded
        - Confirmation spoken
    └─> Total latency: 680ms

11. LOGGING
    └─> All events stored in SQLite
    └─> RAG updated with transcript
    └─> Metrics logged (latency, success)
```

**Total Events: 10**
**Total Components Involved: 8**
**Total Latency: ~680ms**

---

### **10.2 Complete Flow: "Make it cozy" (Complex)**

```
1-4. [Same as simple flow through ASR]

5. ROUTER RECEIVES
   └─> speech.final: "Make it cozy"
   └─> Fast matcher: no pattern match
   └─> ML classifier: intent=scene
   └─> intent.detected: scene (needs_planner=true) → Event Bus

6. PLANNER RECEIVES
   └─> planner.request → Event Bus
   └─> Planner loads context:
       - Gets all light entities from HA
       - Gets user preferences from RAG
       - Gets current time (7:30 PM)
   
7. PLANNER THINKS
   └─> Calls Claude API with streaming
   └─> planner.thinking: "I'll create a cozy atmosphere..." → Event Bus
   └─> UI shows streaming thoughts
   
8. PLAN CREATED
   └─> Planner generates:
       Step 1: Dim living room light to 30%
       Step 2: Set color to warm white (2700K)
       Step 3: Dim desk lamp to 20%
       Step 4: Play soft jazz music
   └─> plan.created → Event Bus
   └─> UI shows plan preview
   └─> Waits for approval (or auto-executes if low risk)

9. USER APPROVES
   └─> User clicks "Approve" in UI
   └─> plan.approved → Event Bus

10. EXECUTE STEP 1
    └─> tool.request: ha.call_service(light, turn_on, {
          entity_id: light.living_room_lamp,
          brightness_pct: 30
        })
    └─> tool.result: success → Event Bus
    └─> plan.step_complete: 1/4 → Event Bus

11. EXECUTE STEP 2
    └─> tool.request: ha.call_service(light, turn_on, {
          entity_id: light.living_room_lamp,
          color_temp: 370  # 2700K in mireds
        })
    └─> tool.result: success → Event Bus
    └─> plan.step_complete: 2/4 → Event Bus

12. EXECUTE STEP 3
    └─> tool.request: ha.call_service(light, turn_on, {
          entity_id: light.desk_lamp,
          brightness_pct: 20
        })
    └─> tool.result: success → Event Bus
    └─> plan.step_complete: 3/4 → Event Bus

13. EXECUTE STEP 4
    └─> tool.request: media_player.play_media(...)
    └─> tool.result: success → Event Bus
    └─> plan.step_complete: 4/4 → Event Bus

14. PLAN COMPLETE
    └─> plan.complete → Event Bus
    └─> TTS: "Done! I've set a cozy atmosphere"
    └─> UI shows: ✅ All steps complete (3.2 seconds)

15. PATTERN LEARNING
    └─> RAG stores: User said "make it cozy" at 7:30 PM
    └─> Next time, planner will remember this preference
```

**Total Events: ~25**
**Total Latency: ~4 seconds (including user approval)**

---

### **10.3 System Diagram**

```
┌─────────────────────────────────────────────────────────────┐
│                        CAIRO BRAIN                           │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Voice   │  │  Vision  │  │  MQTT    │  │ Discovery│   │
│  │ Pipeline │  │ Pipeline │  │  Client  │  │  Engine  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │              │             │          │
│       │             │              │             │          │
│       └─────────────┴──────────────┴─────────────┘          │
│                          │                                   │
│                    ┌─────▼─────┐                            │
│                    │   Event   │                            │
│                    │    Bus    │◀──────────────┐            │
│                    │  (Redis)  │               │            │
│                    └─────┬─────┘               │            │
│                          │                     │            │
│       ┌──────────────────┼──────────────────┐  │            │
│       │                  │                  │  │            │
│  ┌────▼────┐      ┌──────▼─────┐   ┌───────▼──▼───┐       │
│  │ Router  │      │  Planner   │   │ Self-Config  │       │
│  │         │      │            │   │              │       │
│  └────┬────┘      └──────┬─────┘   └──────────────┘       │
│       │                  │                                 │
│       │     ┌────────────┼───────────────┐                │
│       │     │            │               │                │
│  ┌────▼─────▼────┐  ┌────▼────┐   ┌─────▼─────┐          │
│  │   RAG Store   │  │  Tool   │   │    TTS    │          │
│  │   (SQLite)    │  │Registry │   │  (Piper)  │          │
│  └───────────────┘  └────┬────┘   └───────────┘          │
│                          │                                 │
└──────────────────────────┼─────────────────────────────────┘
                           │
                      ┌────▼────┐
                      │  MCP    │
                      │  Tools  │
                      └────┬────┘
                           │
                    ┌──────▼──────┐
                    │    Home     │
                    │  Assistant  │
                    └──────┬──────┘
                           │
                   ┌───────┴───────┐
              Physical Devices (lights, sensors, etc.)
```

---

## Summary

**Voice Pipeline:**
- Wake word → VAD → ASR → Text (400-800ms)

**Router:**
- Fast regex matching OR ML classification (10-300ms)
- Decides: execute directly OR send to planner

**Planner:**
- Multi-step task decomposition (1-3 seconds)
- Streaming thinking process
- Execution with retries

**Vision Pipeline:**
- Camera → YOLO → Semantic events (65-120ms @ 10 FPS)

**RAG Store:**
- SQLite FTS5 for context/memory
- Used by router and planner

**Event Bus:**
- Redis Streams for pub/sub
- All components communicate through it
- Audit trail built-in

**MQTT:**
- Listens to Home Assistant device changes
- Real-time state updates

**MCP Tools:**
- Standardized tool interface
- Type-safe with JSON Schema
- Safety levels enforced

**Self-Update:**
- Discovers new devices automatically
- Generates code safely
- Git audit trail
- Hot reload without restart

---

Everything flows through the **Event Bus**.
Everything is **auditable** in SQLite.
Everything is **modular** and replaceable.

This architecture scales to robotics because:
- Robot actuators = just different MCP tools
- Perception works the same (vision + sensors)
- Planning works the same (task decomposition)
- Safety works the same (approval + audit)

**Any questions on specific components?**
