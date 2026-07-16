import express from 'express';
import cors from 'cors';
import { Readable } from 'node:stream';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { higgsfield } from '@higgsfield/client/v2';

const app = express();
app.use(express.json());
app.use(cors()); // Enable CORS for all routes
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// maxRetries: the SDK retries transient failures (429 rate limit, 529
// overloaded, 5xx) with exponential backoff before giving up.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 5 });

// Higgsfield reads HF_CREDENTIALS ("KEY_ID:KEY_SECRET") from the environment.
// OpenAI is kept for text-to-speech only (Claude does not generate audio).
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CLAUDE_MODEL = 'claude-sonnet-5'; // swap to 'claude-haiku-4-5' (cheaper) or 'claude-opus-4-8' (higher quality)
const OPENAI_TEXT_MODEL = 'gpt-4o'; // fallback only, when Claude is down — swap to 'gpt-4o-mini' for a cheaper (lower quality) fallback

// Extract the plain text from a Claude response (skips thinking blocks).
function claudeText(message) {
    const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
    if (!text) {
        throw new Error(`Claude returned no text (stop_reason: ${message.stop_reason})`);
    }
    return text;
}

// ---------- Claude with an OpenAI fallback ----------
// The rule is simple: if Anthropic isn't working — for any reason — use
// OpenAI. The Anthropic SDK retries transient failures first (maxRetries: 5
// above); anything that still fails switches provider.

async function openaiChatText(system, prompt, maxTokens) {
    const completion = await openai.chat.completions.create({
        model: OPENAI_TEXT_MODEL,
        max_tokens: maxTokens,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
        ],
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI returned no text');
    return text;
}

// Try Claude; if it fails for any reason and an OpenAI key is configured,
// run the same prompt against OpenAI instead.
async function generateText({ system, prompt, maxTokens }) {
    try {
        const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: prompt }],
        });
        return { text: claudeText(message), provider: 'claude' };
    } catch (error) {
        if (!process.env.OPENAI_API_KEY) throw error;
        // Still logged so a config problem (e.g. bad Anthropic key) is
        // visible in the logs even while OpenAI keeps the site alive.
        console.error('Claude unavailable, falling back to OpenAI:', error.message);
        const text = await openaiChatText(system, prompt, maxTokens);
        return { text, provider: 'openai' };
    }
}


// Look up a single English word in the free dictionary API.
// Returns { word, phonetic, audioUrl, meanings } or null if not found.
async function lookupDictionary(word) {
    const resp = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
    );
    if (!resp.ok) return null;

    const entries = await resp.json();
    const entry = Array.isArray(entries) ? entries[0] : null;
    if (!entry) return null;

    const phonetics = entry.phonetics || [];
    const phonetic = entry.phonetic || phonetics.find((p) => p.text)?.text || '';
    const audioUrl = phonetics.find((p) => p.audio)?.audio || '';
    const meanings = (entry.meanings || []).slice(0, 3).map((m) => ({
        partOfSpeech: m.partOfSpeech,
        definition: m.definitions?.[0]?.definition || '',
        example: m.definitions?.[0]?.example || '',
    }));
    if (!meanings.length) return null;

    return { word: entry.word, phonetic, audioUrl, meanings };
}

// Endpoint for definitions: dictionary API first, Claude as fallback
app.post('/definition', async (req, res) => {
    const { word } = req.body;

    if (!word) {
        return res.status(400).send({ error: 'No word provided' });
    }

    // Single English words: free dictionary API (definition + phonetics + audio)
    if (/^[a-zA-Z'-]+$/.test(word.trim())) {
        try {
            const result = await lookupDictionary(word.trim());
            if (result) {
                const definition = result.meanings
                    .map((m) => `(${m.partOfSpeech}) ${m.definition}${m.example ? ` — e.g. "${m.example}"` : ''}`)
                    .join('\n');
                return res.json({ ...result, definition, source: 'dictionary' });
            }
        } catch (error) {
            console.error('Dictionary API failed, falling back to Claude:', error.message);
        }
    }

    // Fallback: phrases, non-English words, or anything the dictionary missed
    try {
        const { text, provider } = await generateText({
            system: 'You are a Dictionary that provides definitions for words in a simple and clear manner plus example use case. You return In Dictionary Format.',
            prompt: `Define the word "${word}".`,
            maxTokens: 1024,
        });

        res.json({ word, definition: text, phonetic: '', audioUrl: '', meanings: [], source: provider });
    } catch (error) {
        console.error('Error getting definition:', error);
        res.status(500).json({ error: 'Failed to get definition' });
    }
});


// Endpoint for translating text using Claude
app.post('/translate', async (req, res) => {
    const { text, targetLanguage } = req.body;

    if (!text || !targetLanguage) {
        return res.status(400).send({ error: 'Text or target language not provided' });
    }

    try {
        const { text: translatedText } = await generateText({
            system: 'You are a helpful assistant that translates text. Reply with the translation only — no preamble.',
            prompt: `Translate the following text to ${targetLanguage}: ${text}`,
            maxTokens: 8192,
        });

        res.json({ translatedText });
    } catch (error) {
        console.error('Error translating text:', error);
        res.status(500).json({ error: 'Failed to translate text' });
    }
});


// ---------- Text-to-speech (ElevenLabs streaming, OpenAI fallback) ----------

// Cloned narrator voices. The client normally sends a concrete voice_id;
// these cover named keys and legacy OpenAI voice names still in the wild.
const ELEVEN_VOICES = { lisa: 'kv1Qe4fUcVPEC2ZisX5i', adam: 'IRHApOXLvnW57QJPQH2P' };

function resolveElevenVoiceId(voice) {
    if (!voice) return ELEVEN_VOICES.lisa;
    if (ELEVEN_VOICES[voice]) return ELEVEN_VOICES[voice];
    if (/^[a-zA-Z0-9]{16,}$/.test(voice)) return voice; // already a voice_id
    return ['onyx', 'echo', 'adam'].includes(voice) ? ELEVEN_VOICES.adam : ELEVEN_VOICES.lisa;
}

// Emotional delivery cues like [whispers]/[excited] need the v3 model;
// plain text uses multilingual v2 (same voice can read any language).
function elevenModelFor(text) {
    return /\[[^\]\n]{2,30}\]/.test(text) ? 'eleven_v3' : 'eleven_multilingual_v2';
}

// Stream ElevenLabs audio straight through to the client so playback can
// start before synthesis finishes. eleven_multilingual_v2 reads any language
// with the same voice, so translated stories keep their narrator.
async function streamElevenLabs(res, text, voice) {
    const voiceId = resolveElevenVoiceId(voice);
    const resp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
        {
            method: 'POST',
            headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text, model_id: elevenModelFor(text) }),
        }
    );
    if (!resp.ok) {
        throw new Error(`ElevenLabs TTS failed (${resp.status}): ${await resp.text()}`);
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    Readable.fromWeb(resp.body).pipe(res);
}

async function generateSpeech(req, res) {
    const { text, voice } = req.body;

    if (!text) {
        return res.status(400).send({ error: 'No text provided' });
    }

    if (process.env.ELEVENLABS_API_KEY) {
        try {
            return await streamElevenLabs(res, text, voice);
        } catch (error) {
            console.error('ElevenLabs failed, falling back to OpenAI TTS:', error.message);
            if (res.headersSent) return; // stream already started; nothing to salvage
        }
    }

    try {
        // Fallback: OpenAI TTS (non-streaming). Strip emotional cues (OpenAI
        // would read them out) and map voices onto the closest equivalents.
        const plain = text.replace(/\[[^\]\n]{2,30}\]\s*/g, '');
        const openaiVoice = ['adam', 'onyx', 'echo', ELEVEN_VOICES.adam].includes(voice) ? 'onyx' : 'nova';
        const mp3 = await openai.audio.speech.create({
            model: 'tts-1',
            voice: /^(alloy|echo|fable|onyx|nova|shimmer)$/.test(voice || '') ? voice : openaiVoice,
            input: plain,
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': buffer.length
        });
        res.end(buffer);
    } catch (error) {
        console.error('Error generating speech:', error);
        res.status(500).send({ error: 'Failed to generate speech' });
    }
}

app.post('/generate-speech', generateSpeech);
// The library/index reader posts here — same handler, default voice.
app.post('/api/synthesize-speech', generateSpeech);


// Endpoint for generating definitions using Claude (GET variant)
app.get('/definition/:word', async (req, res) => {
    const word = req.params.word;

    try {
        const { text } = await generateText({
            system: 'You are a helpful assistant that provides definitions for words.',
            prompt: `Define the word "${word}" in a simple and clear manner plus example use case.`,
            maxTokens: 1024,
        });

        res.json({ definition: text });
    } catch (error) {
        console.error('Error getting definition:', error);
        res.status(500).json({ error: 'Failed to get definition' });
    }
});


// Endpoint for generating a story (Claude) and an illustration (Higgsfield Soul)
app.post('/generate-story', async (req, res) => {
    const prompt = req.body.prompt;
    if (!prompt) {
        return res.status(400).send({ error: 'No prompt provided' });
    }
    try {
        const { text } = await generateText({
            system: 'You are a helpful assistant designed to write short stories. Output plain text in exactly this format: story|narration|imagePrompt. '
                + 'The story is the clean text shown to the reader. '
                + 'The narration is the SAME story with inline emotional delivery cues in square brackets placed before the phrases they affect — e.g. [warmly], [excited], [whispers], [sighs], [laughs] — for an expressive text-to-speech narrator. '
                + 'The imagePrompt is a highly detailed illustration prompt for the story. '
                + 'Output exactly two "|" characters separating the three parts, and nothing else.',
            prompt,
            maxTokens: 8192,
        });

        const parts = text.split('|').map((part) => part.trim());
        // Expected: [story, narration, imagePrompt] — tolerate a missing narration part.
        const story = parts[0] || '';
        const narration = parts.length >= 3 ? parts[1] : story;
        const imagePrompt = parts[parts.length - 1] || '';

        // Image via OpenAI GPT Image (returns base64 -> served as a data URL).
        // To switch back to Higgsfield Soul (needs platform.higgsfield.ai keys):
        // higgsfield.subscribe('/v1/text2image/soul', { input: { prompt, ... }, withPolling: true })
        const imageResponse = await openai.images.generate({
            model: 'gpt-image-2',
            prompt: (imagePrompt || story).substring(0, 1000),
            size: '1024x1024',
        });

        res.json({ story, narration, imageUrl: `data:image/png;base64,${imageResponse.data[0].b64_json}` });
    } catch (error) {
        console.error('Error generating story and image:', error);
        res.status(500).send({ error: 'Failed to generate story and image' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
