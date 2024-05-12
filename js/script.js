document.addEventListener('DOMContentLoaded', function() {
    const storyLinks = document.querySelectorAll('.story-link');

    storyLinks.forEach(link => {
        link.addEventListener('click', function(event) {
            event.preventDefault(); // Prevent default anchor click behavior
            const storyId = this.getAttribute('data-story-id');
            fetchAndDisplayStory(storyId);
        });
    });

    document.getElementById('read-btn').addEventListener('click', function() {
        const title = document.getElementById('story-title').textContent;
        const content = document.getElementById('story-content').textContent;
        readText(title + ". " + content);
    });

    // Load initial story on page load
    fetchAndDisplayStory(1);
});

function fetchAndDisplayStory(storyId) {
    fetch('data/stories.json')
        .then(response => response.json())
        .then(stories => {
            const story = stories.find(s => s.id === parseInt(storyId));
            displayStory(story);
        });
}

function displayStory(story) {
    if (story) {
        const storyContainer = document.getElementById('featured-story');
        storyContainer.innerHTML = `<h3>${story.title}</h3><p>${story.content}</p>`;
    }
}

function readText(text) {
    const speech = new SpeechSynthesisUtterance();
    speech.text = text;
    speech.volume = 1; // 0 to 1
    speech.rate = 1; // 0.1 to 10
    speech.pitch = 1; // 0 to 2
    window.speechSynthesis.speak(speech);
}

function updateRecommendations() {
    const recommendations = document.getElementById('recommendations');
    recommendations.innerHTML = '<li>New Story 1</li><li>New Story 2</li><li>More...</li>';
}
