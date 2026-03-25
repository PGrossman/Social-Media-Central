## Handle Manager (Local Database)
The app must use `electron-store` to manage a local JSON "Rolodex" of social media handles.

### Data Structure
- `apiKey`: String (encrypted if possible, otherwise plain for personal use).
- `handleMap`: An array of objects:
  {
    "nickname": "Red Digital Cinema",
    "x_handle": "@RED_Cinema",
    "ig_handle": "reddigitalcinema",
    "fb_handle": "RedDigitalCinema"
  }

### Logic Flow
1. **AI Guessing:** If I enter a name in the "Tagging" box (e.g., "SpaceX"), the AI should first try to guess the handles.
2. **Local Lookup:** Before the API call, the app should check if the nickname exists in `handleMap`. If it does, provide these handles to the AI prompt as "Confirmed Handles."
3. **Learning Feature:** In the settings tab, I should be able to view and edit this list. There should also be a "Save these handles" button next to the AI output so I can quickly add a new successful guess to my local database.