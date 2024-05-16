// Function to generate a story and an image with the server endpoint
async function generateStory(prompt) {
    console.log('Contacting OpenAI server with prompt:', prompt); // Debugging code

    try {
        const response = await fetch('/generate-story', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: prompt })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Received story and image from OpenAI:', data); // Debugging code
        return data;
    } catch (error) {
        console.error('Network or server error:', error);
        return null;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Attach event listeners to story links
    const storyLinks = document.querySelectorAll('.story-link');
    storyLinks.forEach(link => {
        link.addEventListener('click', function(event) {
            event.preventDefault(); // Prevent default anchor click behavior
            const storyId = this.getAttribute('data-story-id');
            fetchAndDisplayStory(storyId);
        });
    });

    // Attach listener to the read button
    const readButton = document.getElementById('read-btn');
    if (readButton) {
        readButton.addEventListener('click', function() {
            const storyId = this.getAttribute('data-story-id');
            const story = stories.find(s => s.id === parseInt(storyId, 10));
            readText(story);
        });
    }

    // Load initial story on page load
    fetchAndDisplayStory(1);
});

const messages = [
    { lang: 'English', text: 'Welcome to Lisa 1000', flag: 'us' },
    { lang: 'French', text: 'Bienvenue à Lisa 1000', flag: 'fr' },
    { lang: 'German', text: 'Willkommen bei Lisa 1000', flag: 'de' },
    { lang: 'Spanish', text: 'Bienvenido a Lisa 1000', flag: 'es' },
    { lang: 'Chinese', text: '欢迎来到丽莎1000', flag: 'cn' },
    { lang: 'Arabic', text: 'مرحبا بك في ليزا 1000', flag: 'ar' }
];

function cycleText() {
    const animatedText = document.getElementById('intro-header');
    let i = 0;
    let timer;

    function typeWriter(text, flag, idx = 0) {
        if (idx < text.length) {
            animatedText.innerHTML = `<span class="${flag}"></span>${text.substring(0, idx + 1)}`;
            timer = setTimeout(() => typeWriter(text, flag, idx + 1), 150); // Adjust speed here
        } else {
            clearTimeout(timer); // Clear timer after finishing the typing animation
            setTimeout(nextMessage, 2000); // Wait a bit before starting next message
        }
    }

    function nextMessage() {
        const { lang, text, flag } = messages[i];
        animatedText.innerHTML = ''; // Clear previous text
        typeWriter(text, flag);
        i = (i + 1) % messages.length; // Loop through messages
    }

    nextMessage(); // Start the first message immediately
}

window.onload = cycleText;



document.getElementById('readButton').addEventListener('click', function() {
    // Get the title and content of the story
    const title = document.getElementById('story-title').textContent;
    const content = document.getElementById('story-content').textContent;

    // Combine the title and content with a separator
    const text = title + ". " + content; // Add a period and space to separate title and content

    fetch('/generate-speech', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: text }) // Send the text to the server
    })
    .then(response => {
        if (response.ok) return response.blob(); // Get the audio blob if response is OK
        throw new Error('Network response was not ok.');
    })
    .then(blob => {
        const url = URL.createObjectURL(blob); // Create a URL for the blob
        const audio = new Audio(url); // Create an audio element
        audio.play(); // Play the audio
    })
    .catch(error => console.error('Error playing the story:', error));
});



async function translateText(text, targetLanguage) {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?target=${targetLanguage}&q=${encodeURIComponent(text)}`, {
        headers: { 'Authorization': `Bearer AIzaSyD6I96KfvBxEaRwn0C67-D1OCMuKzJQJDM` }
    });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Failed to translate text: ${data.error.message}`);
    }

    return data.data.translations[0].translatedText;
}
document.body.addEventListener('dblclick', async () => {
    // Get the selected text
    const selectedText = window.getSelection().toString().trim();

    // Get the selected language
    const language = document.getElementById('language').value;

    try {
        // Translate the selected text into the selected language
        const translation = await translateText(selectedText, language);

        // Display the translation
        alert(`Translation of "${selectedText}" in ${language}:\n\n${translation}`);
    } catch (error) {
        console.error('Error translating text:', error);
    }
});

function languageName(lang) {
    switch (lang) {
        case 'fr': return 'French';
        case 'de': return 'German';
        case 'zh': return 'Chinese';
        case 'ar': return 'Arabic';
        default: return 'English';
    }
}

function displayAlert(title, text, audioUrl) {
    Swal.fire({
        title: title,
        html: `
            <p>${text}</p>
            <button id="audioButton">Play Audio</button>
            <audio id="audioPlayer" src="${audioUrl}" style="display: none;"></audio>
        `,
        icon: 'success',
        confirmButtonText: 'Close',
        onOpen: () => {
            document.getElementById('audioButton').addEventListener('click', () => {
                readText
            });
        }
    });
}

async function getDefinitionAndPlayAudio(word) {
    const response = await fetch(`/definition/${word}`);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Failed to get definition: ${data.error}`);
    }

    const definition = data.definition; // Adjust this line to match your API

    displayAlert(`Definition of ${word}`, definition);
}
// Check if the browser supports SpeechRecognition
if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
    // Use the webkit prefix if needed
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    const recognition = new SpeechRecognition();

    recognition.onstart = function() {
        console.log('Speech recognition started');
    };

    recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
    };

    recognition.onresult = function(event) {
        // Get the transcript of the recognized speech
        const transcript = event.results[0][0].transcript;

        // Display an alert with the transcript
        displayAlert('You said:', transcript);
    };

    // Start the speech recognition
    recognition.start();
} else {
    console.error('Your browser does not support SpeechRecognition');
}


document.body.addEventListener('dblclick', async () => {
    // Get the selected text
    const selectedText = window.getSelection().toString().trim();

    // If there's no selected text, don't do anything
    if (!selectedText) {
        return;
    }

    try {
        // Get the definition of the selected text and show an alert with the definition
        await defineText(selectedText);
    } catch (error) {
        // If an error occurs, log it to the console
        console.error('Failed to get definition:', error);
    }
});
function fetchAndDisplayStory(storyId) {
    fetch('data/stories.json')
        .then(response => response.json())
        .then(stories => {
            const story = stories.find(s => s.id === parseInt(storyId, 10));
            if (story) {
                displayStory(story);
            } else {
                console.error('Story not found');
            }
        })
        .catch(error => console.error('Error fetching stories:', error));
}

function displayStory(story) {
    const storyContainer = document.getElementById('story-container');
    if (storyContainer) {
        const titleElement = document.getElementById('story-title'); // Directly access by ID
        const contentElement = document.getElementById('story-content'); // Directly access by ID

        titleElement.innerText = story.title; // Dynamically update the title
        contentElement.innerHTML = story.sentences.map(sentence => `<p>${sentence}</p>`).join(''); // Dynamically update the content
    }
}
async function defineText(text) {
    try {
        const response = await fetch('/definition', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: text })
        });
        const data = await response.json();
        return data.definition;
    } catch (error) {
        console.error('Error defining text:', error);
        return text;
    }
}

async function readText(input) {
    try {
        let sentences;

        // Check if the input is a string or a story object
        if (typeof input === 'string') {
            // If it's a string, split it into sentences
            sentences = input.match(/[^\.!\?]+[\.!\?]+/g);
        } else {
            // If it's a story object, use the sentences from the story
            sentences = input.sentences;
        }

        for (let i = 0; i < sentences.length; i++) {
            // If it's a story object, highlight the next sentence
            if (typeof input !== 'string') {
                const contentElement = document.getElementById('story-content');
                const sentenceElements = Array.from(contentElement.getElementsByTagName('p'));
                sentenceElements[i].classList.add('highlight');
            }

            // Synthesize speech for the current sentence
            const response = await fetch('/api/synthesize-speech', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: sentences[i] })
            });

            if (!response.ok) {
                throw new Error('Failed to synthesize speech');
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.play();

            // Wait for the audio to finish playing
            await new Promise(resolve => audio.onended = resolve);

            // If it's a story object, unhighlight the sentence
            if (typeof input !== 'string') {
                const contentElement = document.getElementById('story-content');
                const sentenceElements = Array.from(contentElement.getElementsByTagName('p'));
                sentenceElements[i].classList.remove('highlight');
            }
        }
    } catch (error) {
        console.error('Error synthesizing speech:', error);
    }
}

function updateRecommendations() {
    const recommendations = document.getElementById('recommendations');
    recommendations.innerHTML = '<li>New Story 1</li><li>New Story 2</li><li>More...</li>';
}