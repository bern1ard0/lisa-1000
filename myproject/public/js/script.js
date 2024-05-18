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
    { lang: 'English', text: 'Welcome to LISA 1000', flag: 'us' },
    { lang: 'French', text: 'Bienvenue à LISA 1000', flag: 'fr' },
    { lang: 'German', text: 'Willkommen bei LISA 1000', flag: 'de' },
    { lang: 'Spanish', text: 'Bienvenido a LISA 1000', flag: 'es' },
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

// Function to read the story aloud
async function readStoryAloud(text, voice) {
    try {
        const response = await fetch('/generate-speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: text, voice: voice }) // Pass the voice to the server
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.play();
        } else {
            throw new Error('Network response was not ok.');
        }
    } catch (error) {
        console.error('Error reading story aloud:', error);
    }
}


document.getElementById('readButton').addEventListener('click', function() {
    // Get the title and content of the story
    const title = document.getElementById('story-title').textContent;
    const content = document.getElementById('story-content').textContent;

    // Combine the title and content with a separator
    const text = title + ". " + content; // Add a period and space to separate title and content

    // Get the selected voice
    const selectedVoice = document.getElementById('voiceDropdown').value;
    
    if (selectedVoice) {
        readStoryAloud(text, selectedVoice);
    } else {
        console.log('No voice selected.');
    }
});



// Function to fetch the definition of a word
async function defineText(word) {
    try {
        const response = await fetch('/definition', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ word: word })
        });
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        const data = await response.json();
        return data.definition;
    } catch (error) {
        console.error('Error getting definition:', error);
        return null;
    }
}

// Function to translate text
async function translateText(text, targetLanguage) {
    try {
        const response = await fetch('/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: text, targetLanguage: targetLanguage })
        });
        const data = await response.json();
        return data.translatedText;
    } catch (error) {
        console.error('Error translating text:', error);
        return null;
    }
}
async function handleDoubleClick() {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
        const translationToggle = document.getElementById('translation-toggle').classList.contains('active');
        if (translationToggle) {
            let targetLanguage = document.getElementById('nativeLanguage').value;
            if (targetLanguage === 'other') {
                targetLanguage = document.getElementById('otherLanguage').value.trim();
            }

            if (targetLanguage && targetLanguage !== 'default') {
                const translation = await translateText(selectedText, targetLanguage);
                if (translation) {
                    showTranslation(selectedText, translation);
                }
            }
        } else {
            const definition = await defineText(selectedText);
            if (definition) {
                showPopup(`
                    <h2>Definition</h2>
                    <p>${definition}</p>
                `);
            }
        }
    }
}



// Function to show popup with content
function showPopup(content) {
    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.innerHTML = `
        <div class="popup-content">
            <span class="close-btn">&times;</span>
            ${content}
        </div>
    `;
    document.body.appendChild(popup);

    const closeButton = popup.querySelector('.close-btn');
    closeButton.addEventListener('click', () => {
        popup.remove();
    });
}

// Function to show translation above the selected text
function showTranslation(selectedText, translation) {
    const range = window.getSelection().getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const tooltip = document.createElement('div');
    tooltip.className = 'translation-tooltip';
    tooltip.innerText = translation;
    document.body.appendChild(tooltip);

    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight}px`;

    setTimeout(() => {
        tooltip.remove();
    }, 3000);
}

// Function to translate the entire story
async function translateStory() {
    const storyContent = document.getElementById('story-content').textContent;
    let targetLanguage = document.getElementById('nativeLanguage').value;
    if (targetLanguage === 'other') {
        targetLanguage = document.getElementById('otherLanguage').value.trim();
    }
    if (targetLanguage && targetLanguage !== 'default') {
        const translatedStory = await translateText(storyContent, targetLanguage);
        if (translatedStory) {
            document.getElementById('story-content').textContent = translatedStory;
        }
    }
}


// Event listener for double-click on story content
document.addEventListener('dblclick', handleDoubleClick);

document.addEventListener('DOMContentLoaded', function() {
    const nativeLanguage = document.getElementById('nativeLanguage');
    const otherLanguageInput = document.getElementById('otherLanguage');
    const voiceDropdown = document.getElementById('voiceDropdown');

    let selectedVoice = '';

    voiceDropdown.addEventListener('change', function() {
        selectedVoice = voiceDropdown.value;
        console.log(`Selected voice: ${selectedVoice}`);
    });

    nativeLanguage.addEventListener('change', function() {
        if (this.value === 'other') {
            otherLanguageInput.classList.remove('hidden');
        } else {
            otherLanguageInput.classList.add('hidden');
        }
    });
});
// Event listener for translation toggle
document.getElementById('translation-toggle').addEventListener('click', function() {
    this.classList.toggle('active');
    console.log('Translation toggle:', this.classList.contains('active'));
});

// Event listener for translate button
translateButton.addEventListener('click', translateStory);

function languageName(lang, otherLanguage) {
    switch (lang) {
        case 'fr': return 'French';
        case 'de': return 'German';
        case 'zh': return 'Chinese';
        case 'ar': return 'Arabic';
        case 'es': return 'Spanish';
        case 'other': return otherLanguage;
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

document.addEventListener('DOMContentLoaded', function() {
    const recordButton = document.getElementById('recordButton');
    
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

            // Display the transcript in a modal window
            displayModal('You said:', transcript);
        };

        // Start speech recognition when the "Narrate" button is clicked
        recordButton.addEventListener('click', function() {
            recognition.start();
        });
    } else {
        console.error('Speech recognition not supported in this browser.');
    }

    // Function to display the modal with the transcript and play functionality
    function displayModal(title, transcript) {
        // Create the modal elements
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close-btn">&times;</span>
                <h2>${title}</h2>
                <p id="transcript">${transcript}</p>
                <button id="playButton">Play Synthesis</button>
                <button id="recordButton">Record Your Voice</button>
                <button id="playRecordingButton" style="display:none;">Play Recording</button>
                <audio id="audioPlayback" controls style="display:none;"></audio>
            </div>
        `;
        document.body.appendChild(modal);

        // Show the modal
        modal.style.display = 'block';

        // Get the close button and add click event to close the modal
        const closeButton = modal.querySelector('.close-btn');
        closeButton.addEventListener('click', () => {
            modal.style.display = 'none';
            modal.remove();
        });

        // Add click event to the play button to read the transcript aloud
        const playButton = modal.querySelector('#playButton');
        playButton.addEventListener('click', () => {
            readTextAloud(transcript);
        });

        // Audio recording functionality
        const recordButton = modal.querySelector('#recordButton');
        const playRecordingButton = modal.querySelector('#playRecordingButton');
        const audioPlayback = modal.querySelector('#audioPlayback');
        let mediaRecorder;
        let audioChunks = [];

        recordButton.addEventListener('click', async () => {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    mediaRecorder.start();

                    recordButton.textContent = 'Stop Recording';
                    recordButton.removeEventListener('click', startRecording);
                    recordButton.addEventListener('click', stopRecording);

                    mediaRecorder.ondataavailable = (event) => {
                        audioChunks.push(event.data);
                    };

                    mediaRecorder.onstop = () => {
                        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                        const audioUrl = URL.createObjectURL(audioBlob);
                        audioPlayback.src = audioUrl;
                        audioPlayback.style.display = 'block';
                        playRecordingButton.style.display = 'inline-block';
                    };
                } catch (error) {
                    console.error('Error accessing microphone:', error);
                }
            } else {
                console.error('MediaDevices.getUserMedia not supported in this browser.');
            }
        });

        function startRecording() {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                navigator.mediaDevices.getUserMedia({ audio: true })
                    .then(stream => {
                        mediaRecorder = new MediaRecorder(stream);
                        mediaRecorder.start();

                        recordButton.textContent = 'Stop Recording';
                        recordButton.removeEventListener('click', startRecording);
                        recordButton.addEventListener('click', stopRecording);

                        mediaRecorder.ondataavailable = (event) => {
                            audioChunks.push(event.data);
                        };

                        mediaRecorder.onstop = () => {
                            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                            const audioUrl = URL.createObjectURL(audioBlob);
                            audioPlayback.src = audioUrl;
                            audioPlayback.style.display = 'block';
                            playRecordingButton.style.display = 'inline-block';
                        };
                    })
                    .catch(error => {
                        console.error('Error accessing microphone:', error);
                    });
            } else {
                console.error('MediaDevices.getUserMedia not supported in this browser.');
            }
        }

        function stopRecording() {
            mediaRecorder.stop();
            recordButton.textContent = 'Record Your Voice';
            recordButton.removeEventListener('click', stopRecording);
            recordButton.addEventListener('click', startRecording);
        }

        playRecordingButton.addEventListener('click', () => {
            audioPlayback.play();
        });

        recordButton.addEventListener('click', startRecording);
    }

    // Function to read text aloud
    function readTextAloud(text) {
        const utterance = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utterance);
    }
});// Function to display an alert with a message and transcript
function displayAlert(message, transcript) {
    alert(`${message} ${transcript}`);
}



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
