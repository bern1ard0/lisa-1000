import fs from 'fs';


// Read the JSON file
fs.readFile('stories.json', 'utf8', (err, data) => {
    if (err) {
        console.error(err);
        return;
    }

    // Parse the JSON data
    const stories = JSON.parse(data);

    // Iterate over each story
    for (let story of stories) {
        // Split the content into sentences
        let sentences = story.content.split('. ');

        // Add the sentences back to the story object
        story.sentences = sentences;
    }

    // Write the updated stories back to the JSON file
    fs.writeFile('stories.json', JSON.stringify(stories, null, 4), (err) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log("JSON data is saved.");
    });
});