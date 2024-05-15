import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());
app.use(cors()); // Enable CORS for all routes
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

const request = require('request');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const util = require('util');
const requestPromise = util.promisify(request);




// Endpoint for generating speech
app.post('/generate-speech', async (req, res) => {
    const inputText = req.body.text;
    const voice = req.body.voice; // Get the voice from the request body

    if (!inputText) {
        return res.status(400).send({ error: 'No text provided' });
    }

    if (voice) {
        // Use the external API for the selected voice
        try {
            const options = {
                method: 'POST',
                url: 'https://modelslab.com/api/v6/voice/text_to_audio',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    key: 'um2zbDtJUXa5R5zZuomCyHjVp4APcNUQL45PUKk6ro85aTTwk11XW1OUR9W0', // replace with your actual API key
                    prompt: inputText,
                    language: 'english',
                    track_id: voice
                })
            };

            request(options, function (error, response) {
                if (error) {
                    console.error('Error reading story aloud:', error);
                    return res.status(500).send({ error: 'Failed to generate speech with the external API' });
                }

                const data = JSON.parse(response);
                if (data.links && data.links.length > 0) {
                    const audioUrl = data.links[0];
                    res.json({ audioUrl }); // Return the audio URL
                } else {
                    console.error('No audio link returned from the external API.');
                    res.status(500).send({ error: 'Failed to generate speech with the external API' });
                }
            });
        } catch (error) {
            console.error('Error generating speech with the external API:', error);
            res.status(500).send({ error: 'Failed to generate speech with the external API' });
        }
    } else {
        // Use OpenAI TTS as default
        try {
            const mp3 = await openai.audio.speech.create({
                model: "tts-1",
                voice: "nova",
                input: inputText,
            });

            const buffer = Buffer.from(await mp3.arrayBuffer());
            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Content-Length': buffer.length
            });
            res.end(buffer);
        } catch (error) {
            console.error('Error generating speech with OpenAI:', error);
            res.status(500).send({ error: 'Failed to generate speech with OpenAI' });
        }
    }
});


// Endpoint for generating definitions using OpenAI
app.get('/definition/:word', async (req, res) => {
    const word = req.params.word;

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a helpful assistant that provides definitions for words.' },
                { role: 'user', content: `Define the word "${word}" in a simple and clear manner plus example use case.` }
            ],
            response_format: { type: "json_object" }
        });

        const definition = completion.choices[0].message.content.trim();
        res.json({ definition });
    } catch (error) {
        console.error('Error getting definition:', error);
        res.status(500).json({ error: 'Failed to get definition' });
    }
});

// Endpoint for generating a story using GPT-4 model and then generating an image
app.post('/generate-story', async (req, res) => {
    const prompt = req.body.prompt;
    if (!prompt) {
        return res.status(400).send({ error: 'No prompt provided' });
    }
    try {
        // Generate the story and image prompt
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a helpful assistant designed to write short stories and suitable image prompts in plain text format: story|imagePrompt.'},
                { role: 'user', content: prompt }
            ]
        });

        const [story, imagePrompt] = completion.choices[0].message.content.split('|');

        // Generate the image based on the image prompt
        const imageResponse = await fetch('https://modelslab.com/api/v6/realtime/text2img', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                key: 'um2zbDtJUXa5R5zZuomCyHjVp4APcNUQL45PUKk6ro85aTTwk11XW1OUR9W0', // replace with your actual API key
                prompt: "Randomly create digital art with characters",
                negative_prompt: 'bad quality',
                width: '512',
                height: '512',
                safety_checker: false,
                seed: null,
                samples: 1,
                base64: false,
                temp: true,
                enhance_style: "digital-art"
            })
        });

        const imageData = await imageResponse.json();
        const imageUrl = imageData.output[0];

        res.json({ story, imageUrl });
    } catch (error) {
        console.error('Error generating story and image:', error);
        res.status(500).send({ error: 'Failed to generate story and image' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
