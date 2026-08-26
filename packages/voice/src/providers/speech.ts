// The speech provider.
//
// Q14 asked for constraints rather than a vendor, and the choice follows from
// them:
//
//   1. MUST WORK FROM A DATACENTER IP.  LESSONS §12: "ElevenLabs' free tier
//      blocks datacenter IPs. It cannot be a fallback from a serverless
//      host."  That rules out anything whose free tier is the plan.
//   2. MUST RESPECT persist:false AT THE SINGLE WRITE POINT.  That is about
//      our code, not theirs — but it means the provider must return bytes we
//      place ourselves, never a hosted URL we would have to store.
//   3. MUST CARRY A PER-USER MONTHLY CEILING.  So it must be billed per
//      character or per second, in a unit we can count BEFORE the call.
//
// Chosen default: OpenAI speech (TTS + transcription).  It satisfies all
// three, it is one integration for both halves rather than two vendors, and
// its transcription handles Arabic well — which matters because Arabic is a
// first-class language here, not a fallback.  Note this is the SPEECH
// provider only; the language model is unrelated and is chosen in @lian/llm.
//
// Documented alternative: Azure Speech, if Egyptian-dialect voice quality
// becomes the binding constraint — it exposes named ar-EG neural voices,
// which the default does not.  Swapping it is a file in this folder.
export type SpeechConfig = {
  readonly id: string;
  readonly ttsUrl: string;
  readonly sttUrl: string;
  readonly apiKey: string;
  readonly ttsModel: string;
  readonly sttModel: string;
};

export const DEFAULT_SPEECH: Omit<SpeechConfig, 'apiKey'> = {
  id: 'openai-speech',
  ttsUrl: 'https://api.openai.com/v1/audio/speech',
  sttUrl: 'https://api.openai.com/v1/audio/transcriptions',
  ttsModel: 'gpt-4o-mini-tts',
  sttModel: 'gpt-4o-transcribe',
};

export type SynthesisResult = { readonly audio: Uint8Array; readonly contentType: string };
export type TranscriptionResult = { readonly text: string; readonly language: string | null };

export type SpeechProvider = {
  readonly id: string;
  /** Returns BYTES, never a hosted URL: constraint 2 above.  Where they are
   *  written — if at all — is decided in speak.ts and nowhere else. */
  synthesise(input: { text: string; voiceId: string }): Promise<SynthesisResult>;
  transcribe(input: { audio: Uint8Array; contentType: string; languageHint: string | null }): Promise<TranscriptionResult>;
};

/** Untested against the live service — no key was available.  Treat the first
 *  call as unverified; the shapes are the documented ones. */
export function httpSpeechProvider(config: SpeechConfig): SpeechProvider {
  return {
    id: config.id,

    async synthesise({ text, voiceId }) {
      const response = await fetch(config.ttsUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: config.ttsModel, voice: voiceId, input: text, response_format: 'mp3' }),
      });
      if (!response.ok) throw new Error(`speech provider ${config.id} returned ${response.status}`);
      return { audio: new Uint8Array(await response.arrayBuffer()), contentType: 'audio/mpeg' };
    },

    async transcribe({ audio, contentType, languageHint }) {
      const form = new FormData();
      form.set('file', new Blob([audio], { type: contentType }), 'audio');
      form.set('model', config.sttModel);
      if (languageHint !== null) form.set('language', languageHint);
      const response = await fetch(config.sttUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: form,
      });
      if (!response.ok) throw new Error(`speech provider ${config.id} returned ${response.status}`);
      const body = (await response.json()) as { text?: string; language?: string };
      return { text: (body.text ?? '').trim(), language: body.language ?? null };
    },
  };
}
