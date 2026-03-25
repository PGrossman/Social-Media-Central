## Project Goal
Build a Windows-styled Electron application (using Vite + Tailwind + TypeScript) that acts as a "Social Media Central." It takes images and text context to generate platform-specific posts for Facebook, X (Twitter), and Instagram.

## Core Features
- **Multi-Modal Input:** Drop up to 4 images into a dashed drop target.
- **Contextual Input:** Textarea for "Grounding Information" and a "Tagging" box.
- **AI Selection:** Toggle between `gemini-3-flash` and `gemini-3-pro`.
- **Style Multi-select:** Checkboxes for Historical, Scientific/Engineering, Humorous, and General. Multiple can be selected (e.g., Humorous + Science = Sarcastic Nerd tone).
- **Persistent Settings:** A page to save the Google AI API Key and a "Handle Manager" table.

## UI Style
- **Windows Desktop Aesthetic:** Sharp corners, standard title bar, clean light/dark mode.
- **Three-Column Output:** After generation, show three cards (FB, X, IG) with the generated text and a "Copy" button for each.