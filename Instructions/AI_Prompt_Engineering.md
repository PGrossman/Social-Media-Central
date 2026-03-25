## Prompt Construction Logic
When the "Generate" button is clicked, send a single multimodal request to Gemini 3.

### Step 1: Image Analysis
Instruct the AI to first describe the key technical, historical, or visual elements of the 1-4 images provided.

### Step 2: Persona Integration
Inject the "Style" based on checkboxes:
- **Historical:** Provide dates, context, and significance.
- **Scientific/Engineering:** Focus on specs, mechanics, and "how it works."
- **Humorous:** Use sarcastic, dry, or witty humor.
- **General:** Standard engaging social media copy.
*If multiple are selected, blend them (e.g., Sarcastic Historical).*

### Step 3: Handle Formatting
Pass the "Tagging" info and any matches from the local `handleMap`. 
- **X:** Use @handle.
- **Instagram:** Use @handle in text + hashtags at bottom.
- **Facebook:** Use the plain name or the FB handle if available.

### Step 4: Output Format
The AI must return a valid JSON object:
{
  "facebook": "...",
  "x": "...",
  "instagram": "...",
  "detected_tags": [...] 
}