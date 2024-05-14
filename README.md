# LISA 1000

LISA 1000 is an AI-aided language learning tool that uses storytelling to help users learn English. This project includes a web interface where users can read, listen, and narrate stories.

## Features

- Interactive story display
- Read aloud functionality using text-to-speech
- User narration recording
- Multi-language support
- Story recommendations

## Setup Instructions

### Prerequisites

- Node.js and npm
- Python (for server-side scripts, if applicable)

### Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/your-username/lisa-1000.git
    cd lisa-1000
    ```

2. Install the necessary packages:

    ```bash
    npm install
    ```

3. Start the server:

    ```bash
    node server.js
    ```

4. Open your browser and navigate to `http://localhost:3000`

### Folder Structure

- `public/` - Contains static files (HTML, CSS, JavaScript, etc.)
- `data/` - Contains JSON data for stories
- `js/` - Contains JavaScript files for client-side functionality
- `index.html` - Main entry point for the web interface
- `library.html` - Library page for listing all stories
- `server.js` - Node.js server file

## Usage

- Navigate to the Home page to view the featured story.
- Use the Library page to browse and select stories.
- Click the "Read Aloud" button to listen to the story.
- Use the "Narrate" button to record your own narration.

## License

This project is licensed under the MIT License.

