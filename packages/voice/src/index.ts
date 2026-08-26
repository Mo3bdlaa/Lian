export { speak, hashText, type SpeakInput, type SpeakResult, type VoiceCachePort, type SynthesiserPort, type UsagePort } from './speak.ts';
export { transcribeVoiceNote, MAX_VOICE_NOTE_SECONDS, type VoiceNoteInput, type VoiceNoteResult, type TranscribePort, type TranscribeUsagePort } from './transcribe.ts';
export { httpSpeechProvider, DEFAULT_SPEECH, type SpeechProvider, type SpeechConfig, type SynthesisResult, type TranscriptionResult } from './providers/speech.ts';
