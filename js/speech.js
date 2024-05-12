// js/speech.js
document.getElementById('read-btn').addEventListener('click', function() {
    const text = document.getElementById('story-content').textContent;
    fetch('/synthesize-speech', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: text })
    })
    .then(response => response.blob())
    .then(blob => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
    })
    .catch(err => console.error('Error synthesizing speech:', err));
});
