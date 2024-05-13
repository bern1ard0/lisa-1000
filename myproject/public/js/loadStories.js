document.addEventListener('DOMContentLoaded', function() {
    fetch('data/stories.json')  // Adjusted path assuming 'stories.json' is in 'public/data'
        .then(response => response.json())
        .then(stories => {
            const mainElement = document.getElementById('story-list');
            stories.forEach(story => {
                const storyDiv = document.createElement('div');
                storyDiv.className = 'story';
                storyDiv.innerHTML = `<h2>${story.title}</h2><p>${story.content.substring(0, 150)}...</p><button onclick="readStory(${story.id})">Read More</button>`;
                mainElement.appendChild(storyDiv);
            });
        })
        .catch(error => {
            console.error('Error loading the stories:', error);
        });
});

function readStory(id) {
    // Placeholder for future expansion or interaction
    alert('Read story with ID: ' + id);
}