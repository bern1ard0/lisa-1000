import express from 'express';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import Swal from 'sweetalert2';



const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
// Configure OpenAI SDK
const openai = new OpenAI({ apiKey:{Your_OPEN_AI_KEY} });

app.post('/generate-speech', async (req, res) => {
    const inputText = req.body.text; // Get text from client request
    if (!inputText) {
        return res.status(400).send({ error: 'No text provided' });
    }
    try {
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: "nova",
            input: inputText,
        });

        // Stream the audio directly to the client
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
});
import fetch from 'node-fetch';

app.get('/definition/:word', async (req, res) => {
    const word = req.params.word;

    try {
        const response = await fetch(`https://dictionaryapi.com/api/v3/references/collegiate/json/test?key=84fb4324-1c15-436d-8d28-96b1c7414ec1`);
        const data = await response.json();

        if (data[0] && data[0].shortdef && data[0].shortdef[0]) {
            res.json({ definition: data[0].shortdef[0] });
        } else {
            res.status(404).json({ error: `No definition found for ${word}` });
        }
    } catch (error) {
        console.error('Error getting definition:', error);
        res.status(500).json({ error: 'Failed to get definition' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
