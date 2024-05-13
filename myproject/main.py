import os
import json
from openai import OpenAI

# Initialize the OpenAI client
client = OpenAI(api_key='sk-proj-jjYrMQ8BuqUGBLBU2EDsT3BlbkFJZkCul3fuRu1UqMGaZvqa')

# txt_to_json function
def txt_to_json(data_folder, output_file):
    stories = []
    titles = {
        "1": "Spot",
        "2": "Roxy's Icy Adventure",
        "3": "Daisy and Max",
        "4": "Sue's Thoughtful Act",
        "5": "The Kind Farmer",
        "6": "Lucy and Tom's Park Adventure",
        "7": "Spot and Buddy's Goal",
        "8": "Tom's Lost Ball",
        "9": "Max and the Cat",
        "10": "Mia and Tom's Jewelry Adventure"
    }

    # List all txt files in the directory
    for file_name in sorted(os.listdir(data_folder)):
        if file_name.endswith('.txt'):
            story_id = file_name.split('_')[1].split('.')[0]
            path = os.path.join(data_folder, file_name)

            with open(path, 'r', encoding='utf-8') as file:
                content = file.read().strip()
                story_data = {
                    "id": int(story_id),
                    "title": titles.get(story_id, "Unknown Story"),
                    "content": content
                }
                stories.append(story_data)

    # Write the data to a JSON file
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(stories, f, indent=4)

# Usage
data_folder = 'data/mini_stories'
output_file = 'data/stories.json'
txt_to_json(data_folder, output_file)

# Text to Speech conversion
response = client.audio.speech.create(
    model="tts-1",
    voice="alloy",
    input="Hello world! This is a streaming test.",
)

response.with_streaming_response.method("output.mp3")