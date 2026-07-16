import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { higgsfield } from '@higgsfield/client/v2';

const app = express();
app.use(express.json());
app.use(cors()); // Enable CORS for all routes
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Higgsfield reads HF_CREDENTIALS ("KEY_ID:KEY_SECRET") from the environment.
// OpenAI is kept for text-to-speech only (Claude does not generate audio).
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CLAUDE_MODEL = 'claude-opus-4-8';

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
        const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 1024,
            system: 'You are a Dictionary that provides definitions for words in a simple and clear manner plus example use case. You return In Dictionary Format.',
            messages: [
                { role: 'user', content: `Define the word "${word}".` }
            ]
        });

        res.json({ word, definition: claudeText(message), phonetic: '', audioUrl: '', meanings: [], source: 'claude' });
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
        const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 8192,
            system: 'You are a helpful assistant that translates text. Reply with the translation only — no preamble.',
            messages: [
                { role: 'user', content: `Translate the following text to ${targetLanguage}: ${text}` }
            ]
        });

        res.json({ translatedText: claudeText(message) });
    } catch (error) {
        console.error('Error translating text:', error);
        res.status(500).json({ error: 'Failed to translate text' });
    }
});


// Endpoint for generating speech (OpenAI TTS — Claude does not do audio)
async function generateSpeech(req, res) {
    const { text, voice } = req.body;

    if (!text) {
        return res.status(400).send({ error: 'No text provided' });
    }

    try {
        const mp3 = await openai.audio.speech.create({
            model: 'tts-1',
            voice: voice || 'nova',
            input: text,
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
        const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 1024,
            system: 'You are a helpful assistant that provides definitions for words.',
            messages: [
                { role: 'user', content: `Define the word "${word}" in a simple and clear manner plus example use case.` }
            ]
        });

        res.json({ definition: claudeText(message) });
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
        const message = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 8192,
            thinking: { type: 'adaptive' },
            system: 'You are a helpful assistant designed to write short stories and suitable image prompts in plain text format: story|imagePrompt. Output exactly one "|" separating the story from the image prompt, and nothing else.',
            messages: [
                { role: 'user', content: prompt }
            ]
        });

        const [story = '', imagePrompt = ''] = claudeText(message)
            .split('|')
            .map((part) => part.trim());

        const generation = await higgsfield.subscribe('/v1/text2image/soul', {
            input: {
                prompt: (imagePrompt || story).substring(0, 1000),
                width_and_height: '1536x1536',
                quality: '1080p',
                batch_size: 1,
                enhance_prompt: true,
            },
            withPolling: true,
        });

        if (generation.status !== 'completed' || !generation.images?.length) {
            throw new Error(`Higgsfield image generation ${generation.status}`);
        }

        res.json({ story, imageUrl: generation.images[0].url });
    } catch (error) {
        console.error('Error generating story and image:', error);
        res.status(500).send({ error: 'Failed to generate story and image' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
