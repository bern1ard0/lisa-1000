// Small toast-style notice (SweetAlert2 when available, alert() otherwise)
function notifyUser(title, text) {
    if (window.Swal) {
        Swal.fire({ icon: 'info', title: title, text: text, confirmButtonColor: '#8B5CF6' });
    } else {
        alert(title + '\n' + text);
    }
}

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
document.addEventListener('DOMContentLoaded', function() {
    const nativeLanguage = document.getElementById('nativeLanguage');
    const otherLanguageInput = document.getElementById('otherLanguage');
    const voiceDropdown = document.getElementById('voiceDropdown');

    // Handle language selection
    nativeLanguage.addEventListener('change', function() {
        const selectedLanguage = this.value;
        console.log(`Selected language: ${selectedLanguage}`);

        if (selectedLanguage === 'other') {
            otherLanguageInput.classList.remove('hidden');
            otherLanguageInput.focus(); // Focus on the input field for other language
        } else {
            otherLanguageInput.classList.add('hidden');
        }
    });

    // Handle voice selection
    voiceDropdown.addEventListener('change', function() {
        const selectedVoice = this.value;
        console.log(`Selected voice: ${selectedVoice}`);
    });
});

// Why the last generation failed, for the error card shown to the user.
let lastGenerationError = '';

async function generateStory(prompt) {
    console.log('Contacting story server with prompt:', prompt); // Debugging code
    lastGenerationError = '';

    // One request + one automatic retry when the server says the failure is
    // temporary (Claude overloaded / rate limited). The backend SDK already
    // retries with backoff, so anything reaching us here was busy for a while.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch('/generate-story', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prompt: prompt })
            });

            if (!response.ok) {
                const errBody = await response.text().catch(() => '');
                console.error('Server error body:', errBody);
                let parsed = {};
                try { parsed = JSON.parse(errBody); } catch (_) { /* not JSON */ }
                lastGenerationError = parsed.error || `The story server returned an error (${response.status}).`;
                if (parsed.retryable && attempt === 0) {
                    console.log('Temporary overload — retrying once in 8s...');
                    await new Promise((r) => setTimeout(r, 8000));
                    continue;
                }
                return null;
            }

            const data = await response.json();
            console.log('Received story from server:', data.story); // Debugging code
            console.log('Received image URL from server:', data.imageUrl); // Debugging code

            return data;
        } catch (error) {
            console.error('Network or server error:', error);
            lastGenerationError = 'Could not reach the story server — check your connection and try again.';
            return null;
        }
    }
    return null;
}

document.addEventListener('DOMContentLoaded', function() {
    const takeMattersButton = document.getElementById('takeMattersButton');
    const buttonContainer = document.getElementById('button-container');
    const generateStoryButton = document.getElementById('generateStoryButton');
    const generateMyStoryButton = document.getElementById('generateMyStoryButton');
    const randomStoryButton = document.getElementById('randomStoryButton');
    const fineTuneButton = document.getElementById('fineTuneButton');
    const generateFineTunedStoryButton = document.getElementById('generateFineTunedStoryButton');
    const generateStoryForm = document.getElementById('generateStoryForm');
    const readButton = document.getElementById('readButton');
    const translateButton = document.getElementById('translateButton');
    const animateButton = document.getElementById('animateButton');
    const narrateButton = document.getElementById('narrateButton');
    const voiceDropdown = document.getElementById('voiceDropdown');
    
    const takeMattersSection = document.getElementById('take-matters-section');
    const generateStorySection = document.getElementById('generate-story-section');
    const fineTuneOptions = document.getElementById('fineTuneOptions');
    const storyContainer = document.getElementById('c-story-container');
    
    let selectedVoice = 'lisa'; // Default to "Lisa"
    // Story text annotated with [emotional cues] — used for narration only,
    // never displayed. Cleared on translation (cues belong to the original).
    let currentNarration = null;
    // Everything needed to persist the on-screen story via POST /api/works.
    let currentStory = null;

    // Ensure the default voice is set to "Lisa" in the dropdown
    voiceDropdown.value = 'lisa';

    voiceDropdown.addEventListener('change', function() {
        selectedVoice = voiceDropdown.value;
        console.log(`Selected voice: ${selectedVoice}`);
    });

    function setCurrentStory(title, genre, language, storyData) {
        currentStory = {
            title: title,
            genre: genre || null,
            language: language || 'en',
            story: storyData.story,
            narration: storyData.narration || null,
            imageUrl: storyData.imageUrl || null,
        };
        const saveButton = document.getElementById('saveButton');
        saveButton.disabled = false;
        saveButton.textContent = '💾 Save to Library';
    }

    // Split a story into paragraph scenes; pair narration paragraphs with
    // them when the counts line up, otherwise keep all cues on scene 0.
    function storyToScenes(story, narration) {
        const paras = story.split(/\n+/).map((p) => p.trim()).filter(Boolean);
        const narrParas = narration
            ? narration.split(/\n+/).map((p) => p.trim()).filter(Boolean)
            : [];
        const aligned = narrParas.length === paras.length;
        return paras.map((p, i) => ({
            display_text: p,
            narration_text: aligned ? narrParas[i] : (i === 0 ? narration : null),
        }));
    }

    document.getElementById('saveButton').addEventListener('click', async function() {
        if (!currentStory) return;
        const saveButton = this;

        let visibility = 'public';
        if (window.Swal) {
            const choice = await Swal.fire({
                title: 'Save to Library',
                text: 'Who should see this story?',
                input: 'radio',
                inputOptions: { public: '🌍 Everyone', unlisted: '🔗 Only people with the link' },
                inputValue: 'public',
                showCancelButton: true,
                confirmButtonText: 'Save',
                confirmButtonColor: '#8B5CF6',
            });
            if (!choice.isConfirmed) return;
            visibility = choice.value || 'public';
        } else if (!confirm('Save this story to the public library?')) {
            return;
        }

        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
        try {
            const resp = await fetch('/api/works', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind: 'story',
                    title: currentStory.title,
                    genre: currentStory.genre,
                    language: currentStory.language,
                    visibility: visibility,
                    scenes: storyToScenes(currentStory.story, currentStory.narration),
                    cover_image_url: currentStory.imageUrl,
                }),
            });
            if (!resp.ok) {
                const detail = await resp.json().catch(() => ({}));
                throw new Error(detail.error || `Save failed (${resp.status})`);
            }
            saveButton.textContent = '✓ Saved';
            notifyUser(
                'Saved to Library',
                visibility === 'public'
                    ? 'Your story is now in the Library for everyone to read.'
                    : 'Saved! Only people with the link can view it (share pages coming soon).'
            );
        } catch (error) {
            console.error('Error saving story:', error);
            saveButton.disabled = false;
            saveButton.textContent = '💾 Save to Library';
            notifyUser('Could not save', String(error.message || error));
        }
    });

    // Warn before leaving the page while a story is generating — navigating
    // to another tab/page aborts the request and the story is lost.
    let generationInFlight = false;
    window.addEventListener('beforeunload', function(event) {
        if (generationInFlight) {
            event.preventDefault();
            event.returnValue = 'Your story is still being created — leaving now will lose it.';
        }
    });

    // Show a staged loading indicator while the story + image generate (~20-60s)
    function startLoading(triggerButton) {
        const stages = [
            "Lisa is writing your story...",
            "Illustrating your story...",
            "Adding the finishing touches...",
            "Still working — Lisa is being extra careful..."
        ];
        let stageIndex = 0;
        generationInFlight = true;
        if (triggerButton) triggerButton.disabled = true;
        buttonContainer.style.display = 'none';
        storyContainer.classList.remove('generated-story');
        storyContainer.innerHTML = `
            <div class="loading-overlay">
                <div class="spinner"></div>
                <p class="loading-status">${stages[0]}</p>
                <p class="loading-hint">Please stay on this page — leaving stops the magic. ✨</p>
            </div>`;
        const timer = setInterval(() => {
            stageIndex = Math.min(stageIndex + 1, stages.length - 1);
            const statusEl = storyContainer.querySelector('.loading-status');
            if (statusEl) statusEl.textContent = stages[stageIndex];
        }, 15000);
        return function stopLoading() {
            clearInterval(timer);
            generationInFlight = false;
            if (triggerButton) triggerButton.disabled = false;
        };
    }

    function displayStory(story, imageUrl, title = 'Generated Story') {
        if (!story) {
            storyContainer.classList.add('generated-story');
            storyContainer.innerHTML = `
                <h2>Couldn't create your story</h2>
                <p>${lastGenerationError || 'Something went wrong on our side.'}</p>
                <p>Everything you filled in is still here — just press Generate again.</p>`;
            return;
        }
        console.log('Displaying story:', story); // Debugging code
        storyContainer.innerHTML = `
            <h2>${title}</h2>
            <img src="${imageUrl}" alt="Generated Image" class="generated-image">
            <p id="story-content">${story}</p>`;
        storyContainer.classList.add('generated-story');
        storyContainer.style.transition = 'opacity 0.5s ease';
        storyContainer.style.opacity = '0';
        setTimeout(() => {
            storyContainer.style.opacity = '1';
        }, 10); // Small timeout to trigger fade-in effect
    }

    takeMattersButton.addEventListener('click', function() {
        console.log('Lisa\'s Story button clicked'); // Debugging code
        takeMattersSection.style.display = 'flex';
        generateStorySection.style.display = 'none';
        takeMattersButton.classList.add('selected');
        generateStoryButton.classList.remove('selected');
    });

    generateStoryButton.addEventListener('click', function() {
        console.log('Generate Story button clicked'); // Debugging code
        takeMattersSection.style.display = 'none';
        generateStorySection.style.display = 'flex';
        generateStoryButton.classList.add('selected');
        takeMattersButton.classList.remove('selected');
    });

    randomStoryButton.addEventListener('click', async function() {
        console.log('Completely Random button clicked'); // Debugging code
        const lengthOptions = ["short", "very short", "super short"];
        const genreOptions = ["fantasy", "mystery", "adventure", "science fiction", "historical"];
        const randomLength = lengthOptions[Math.floor(Math.random() * lengthOptions.length)];
        const randomGenre = genreOptions[Math.floor(Math.random() * genreOptions.length)];
        const stopLoading = startLoading(randomStoryButton);
        const storyData = await generateStory(`Write a ${randomLength} ${randomGenre} story suitable for language learning alongside a narration copy with emotional delivery cues and a highly detailed relevant imagePrompt for the illustration: Your text output is: story|narration|imagePrompt`);
        stopLoading();
        if (storyData) {
            displayStory(storyData.story, storyData.imageUrl, `Generated ${randomGenre} Story`);
            currentNarration = storyData.narration || null;
            setCurrentStory(`Generated ${randomGenre} Story`, randomGenre, 'en', storyData);
            buttonContainer.style.display = 'flex';
        } else {
            displayStory(null);
        }
    });

    fineTuneButton.addEventListener('click', function() {
        console.log('Fine Tune button clicked'); // Debugging code
        fineTuneOptions.style.display = 'block';
    });

    generateFineTunedStoryButton.addEventListener('click', async function() {
        const genre = document.getElementById('genre').value;
        const length = document.getElementById('length').value;
        const characterNum = document.getElementById('characterNum').value || '2';
        const emotion = document.getElementById('emotion').value;
        const language = document.getElementById('language').value;
    
        const prompt = `Write a ${length} story with ${characterNum} characters (participants) in the ${language} language leaving you ${emotion} in the end. Alongside a narration copy with emotional delivery cues and a highly detailed relevant imagePrompt for the illustration: Your text output is: story|narration|imagePrompt`;
        console.log(`Generating a story with prompt: ${prompt}`); // Debugging code
        const stopLoading = startLoading(generateFineTunedStoryButton);
        const storyData = await generateStory(prompt);
        stopLoading();
        if (storyData) {
            displayStory(storyData.story, storyData.imageUrl, `Generated ${genre} Story`);
            currentNarration = storyData.narration || null;
            setCurrentStory(`Generated ${genre} Story`, genre, 'en', storyData);
            buttonContainer.style.display = 'flex';
        } else {
            displayStory(null);
        }
    });
    

    generateStoryForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        console.log('Generate Story form submitted'); // Debugging code
        const title = document.getElementById('title').value;
        const theme = document.getElementById('theme').value;
        const inputLanguage = document.getElementById('inputLanguage').value;
        const textInput = document.getElementById('textInput').value;
        const outputLanguage = document.getElementById('outputLanguage').value;
        const music = document.getElementById('music').checked;
        const scenery = document.getElementById('scenery').checked;
        const video = document.getElementById('video').checked;
        const subtitles = document.getElementById('subtitles').checked;

        const prompt = `Title: ${title}, Theme: ${theme}, Input Language: ${inputLanguage}, Text: ${textInput}, outputLanguage: ${outputLanguage}, Music: ${music}, alongside a narration copy with emotional delivery cues and a highly detailed relevant imagePrompt for the illustration: Your text output is: story|narration|imagePrompt`;
        console.log(`Generating a story with prompt: ${prompt}`); // Debugging code
        const submitButton = generateStoryForm.querySelector('button[type="submit"]');
        const stopLoading = startLoading(submitButton);
        const storyData = await generateStory(prompt);
        stopLoading();
        if (storyData) {
            displayStory(storyData.story, storyData.imageUrl, title);
            currentNarration = storyData.narration || null;
            setCurrentStory(title, theme, outputLanguage, storyData);
            buttonContainer.style.display = 'flex';
            // Narrate in the language the story was generated in
            window.currentStoryLanguage = outputLanguage;
        } else {
            displayStory(null);
        }
    });

    readButton.addEventListener('click', function() {
        const storyText = document.getElementById('story-content').textContent;
        // Prefer the cue-annotated narration when we have one for this story
        readStoryAloud(currentNarration || storyText, selectedVoice);
    });
    translateButton.addEventListener('click', async function() {
        const translationToggle = document.getElementById('translation-toggle').classList.contains('active');
        if (!translationToggle) {
            notifyUser('Turn on Translate mode', 'Click the T toggle in the navigation bar to enable translation, then press Translate again.');
            return;
        }
        const storyText = document.getElementById('story-content').textContent;
        let targetLanguage = document.getElementById('nativeLanguage').value;
        if (targetLanguage === 'other') {
            targetLanguage = document.getElementById('otherLanguage').value.trim();
        }
        if (!targetLanguage || targetLanguage === 'default') {
            notifyUser('Pick your language', 'Choose your language in the "I speak…" dropdown so we know what to translate into.');
            return;
        }
        if (targetLanguage && targetLanguage !== 'default') {
            translateButton.disabled = true;
            const originalLabel = translateButton.textContent;
            translateButton.textContent = 'Translating...';
            try {
                const translatedStory = await translateText(storyText, targetLanguage);
                if (translatedStory) {
                    const currentImageURL = document.querySelector('.generated-image').src;
                    const currentTitle = document.querySelector('#c-story-container h2').textContent;
                    displayStory(translatedStory, currentImageURL, currentTitle);
                    // Narration follows the story's language from here on;
                    // the cue-annotated copy belonged to the original language.
                    window.currentStoryLanguage = targetLanguage;
                    currentNarration = null;
                    if (currentStory) {
                        currentStory.story = translatedStory;
                        currentStory.narration = null;
                        currentStory.language = targetLanguage;
                    }
                }
            } finally {
                translateButton.disabled = false;
                translateButton.textContent = originalLabel;
            }
        }
    });
    

    animateButton.addEventListener('click', function() {
        console.log('Animate button clicked'); // Debugging code
    });

    narrateButton.addEventListener('click', function() {
        const storyText = document.getElementById('story-content').textContent;
        readStoryAloud(currentNarration || storyText, selectedVoice);
    });

    // Read the story aloud — streamed from ElevenLabs, voice picked from the
    // language bank so a translated story is narrated in its own language.
    async function readStoryAloud(text, voiceKey) {
        try {
            await streamSpeech(text, voiceKey, window.currentStoryLanguage);
        } catch (error) {
            console.error('Error reading story aloud:', error);
        }
    }
    
// Function to generate speech for the text
async function readTextAloud(text) {
    try {
        const response = await fetch('/generate-speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }

        const data = await response.json();
        const audioUrl = data.audioUrl;
        const audio = new Audio(audioUrl);
        audio.play();
    } catch (error) {
        console.error('Error reading text aloud:', error);
    }
}
    
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
        return data;
    } catch (error) {
        console.error('Error getting definition:', error);
        return null;
    }
}

// Convert the lightweight markdown Claude returns (## headings, **bold**) to HTML
function formatDefinitionText(text) {
    return (text || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^#{1,4}\s*(.+)$/gm, '<h4>$1</h4>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n{2,}/g, '<br>')
        .replace(/\n/g, '<br>')
        .replace(/<\/h4><br>/g, '</h4>');
}

// Build popup HTML for a definition entry (word, phonetic, audio, meanings)
function renderDefinition(entry) {
    const meanings = (entry.meanings && entry.meanings.length)
        ? entry.meanings.map(m => `<p><em>${m.partOfSpeech}</em> — ${m.definition}${m.example ? `<br><span class="def-example">"${m.example}"</span>` : ''}</p>`).join('')
        : `<div class="def-body">${formatDefinitionText(entry.definition)}</div>`;
    const audio = entry.audioUrl
        ? `<button class="pronounce-btn" onclick="new Audio('${entry.audioUrl}').play()">🔊 Pronounce</button>`
        : '';
    return `
        <h2>${entry.word || 'Definition'}</h2>
        ${entry.phonetic ? `<p class="phonetic">${entry.phonetic}</p>` : ''}
        ${audio}
        ${meanings}`;
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
            const entry = await defineText(selectedText);
            if (entry) {
                showPopup(renderDefinition(entry));
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
    const translationToggle = document.getElementById('translation-toggle').classList.contains('active');
    if (!translationToggle) {
        console.log('Translation toggle is not active. Translation not triggered.');
        return;
    }

    const storyContentElement = document.getElementById('story-content');
    const storyText = storyContentElement.textContent;
    let targetLanguage = document.getElementById('nativeLanguage').value;

    if (targetLanguage === 'other') {
        targetLanguage = document.getElementById('otherLanguage').value.trim();
    }

    if (targetLanguage && targetLanguage !== 'default') {
        const translatedStory = await translateText(storyText, targetLanguage);
        if (translatedStory) {
            storyContentElement.textContent = translatedStory;  // Update only the text content
        }
    }
}


// Event listener for double-click on story content
document.addEventListener('dblclick', handleDoubleClick);



// Event listener for translation toggle
document.getElementById('translation-toggle').addEventListener('click', function() {
    this.classList.toggle('active');
    console.log('Translation toggle:', this.classList.contains('active'));
});

});