// ElevenLabs narration: voice bank + streaming playback.
//
// The voice dropdowns hold voice KEYS ('lisa', 'adam'); voiceForLanguage()
// resolves a key + story language to a concrete ElevenLabs voice_id.
// window.currentStoryLanguage is updated after a translation so the reading
// voice follows the story's language.

// Per-language narrator bank. The default voices are multilingual, so they
// can already read any language; add a cloned voice_id under a language code
// to give that language its own dedicated narrator.
const VOICE_BANK = {
    default: {
        lisa: 'kv1Qe4fUcVPEC2ZisX5i',
        adam: 'IRHApOXLvnW57QJPQH2P',
    },
    // e.g. fr: { lisa: '<french-lisa-voice-id>', adam: '<french-adam-voice-id>' },
    fr: {},
    es: {},
    de: {},
    zh: {},
    ar: {},
};

window.currentStoryLanguage = 'en';

function voiceForLanguage(voiceKey, language) {
    const lang = (language || 'en').toLowerCase();
    const bank = VOICE_BANK[lang] || {};
    return bank[voiceKey] || VOICE_BANK.default[voiceKey] || VOICE_BANK.default.lisa;
}

// Stream narration from /generate-speech and start playing as soon as the
// first audio chunks arrive (MediaSource), falling back to whole-file
// playback where MSE isn't supported. Resolves when playback finishes.
async function streamSpeech(text, voiceKey, language) {
    const lang = language || window.currentStoryLanguage || 'en';
    const response = await fetch('/generate-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, voice: voiceForLanguage(voiceKey, lang), language: lang }),
    });
    if (!response.ok) {
        throw new Error(`Speech request failed (${response.status})`);
    }

    const mime = 'audio/mpeg';
    const canStream = window.MediaSource && MediaSource.isTypeSupported(mime) && response.body;

    if (!canStream) {
        const blob = await response.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        await audio.play();
        await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; });
        return;
    }

    const mediaSource = new MediaSource();
    const audio = new Audio(URL.createObjectURL(mediaSource));
    await new Promise((resolve) => mediaSource.addEventListener('sourceopen', resolve, { once: true }));
    const sourceBuffer = mediaSource.addSourceBuffer(mime);
    const reader = response.body.getReader();

    const appendChunk = (chunk) => new Promise((resolve, reject) => {
        sourceBuffer.addEventListener('updateend', resolve, { once: true });
        sourceBuffer.addEventListener('error', reject, { once: true });
        sourceBuffer.appendBuffer(chunk);
    });

    let started = false;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await appendChunk(value);
        if (!started) {
            started = true;
            audio.play().catch((e) => console.error('Audio playback blocked:', e));
        }
    }
    if (mediaSource.readyState === 'open') mediaSource.endOfStream();

    await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; });
}
