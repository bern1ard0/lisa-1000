document.addEventListener('DOMContentLoaded', function() {
    // Assuming each story link has a class 'story-link' and each has a data attribute 'data-story-id'
    const storyLinks = document.querySelectorAll('.story-link');

    storyLinks.forEach(link => {
        link.addEventListener('click', function(event) {
            event.preventDefault(); // Prevent the default anchor click behavior
            const storyId = this.getAttribute('data-story-id');
            displayStory(storyId);
        });
    });
});

// Function to fetch and display a story based on its ID
function displayStory(storyId) {
    // For now, we'll simulate fetching story data
    const storyData = {
        1: {
            title: "Story 1 Title",
            content: "Story 1 content goes here..."
        },
        2: {
            title: "Story 2 Title",
            content: "Story 2 content goes here..."
        }
    };

    const story = storyData[storyId] || {};
    const storyContainer = document.getElementById('featured-story');
    if (storyContainer) {
        storyContainer.innerHTML = `<h3>${story.title}</h3><p>${story.content}</p>`;
    }
}

// Example function to update recommended stories based on some user action
function updateRecommendations() {
    const recommendations = document.getElementById('recommendations');
    if (recommendations) {
        // Simulate changing recommendations
        recommendations.innerHTML = '<li>New Story 1</li><li>New Story 2</li><li>More...</li>';
    }
}
document.getElementById('read-btn').addEventListener('click', function() {
    const storyTitle = document.getElementById('story-title').innerText;
    const storyContent = document.getElementById('story-content').innerText;
    readText(storyTitle + ". " + storyContent);
});

function readText(text) {
    const speech = new SpeechSynthesisUtterance();
    speech.text = text;
    speech.volume = 1; // 0 to 1
    speech.rate = 1; // 0.1 to 10
    speech.pitch = 1; // 0 to 2
    window.speechSynthesis.speak(speech);
}

// Example function to load a story dynamically (this could be from a JSON file or API)
function loadStory(storyId) {
    // Placeholder for story loading logic
    document.getElementById('story-title').innerText = "Example Story Title";
    document.getElementById('story-content').innerText = "Example story content goes here...";
}

// Load a story immediately for demo purposes (replace with real IDs or fetching logic)
loadStory(1);
