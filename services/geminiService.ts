/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// FIX: Import `Modality` to specify response modalities for the image editing model.
import { GoogleGenAI, Modality } from "@google/genai";
import type { GenerateContentResponse, Part } from "@google/genai";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- Helper Functions ---

/**
 * Converts a data URL string into a Part object for the Gemini API.
 * @param dataUrl The data URL (e.g., 'data:image/png;base64,...').
 * @returns A Part object.
 * @throws An error if the data URL format is invalid.
 */
function dataUrlToGeminiPart(dataUrl: string): Part {
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.*)$/);
    if (!match) {
        throw new Error("Invalid image data URL format. Expected 'data:image/...;base64,...'");
    }
    const [, mimeType, base64Data] = match;
    return {
        inlineData: { mimeType, data: base64Data },
    };
}


/**
 * Processes the Gemini API response, extracting the image or throwing an error if none is found.
 * @param response The response from the generateContent call.
 * @returns A data URL string for the generated image.
 */
function processGeminiResponse(response: GenerateContentResponse): string {
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (imagePartFromResponse?.inlineData) {
        const { mimeType, data } = imagePartFromResponse.inlineData;
        return `data:${mimeType};base64,${data}`;
    }

    const textResponse = response.text;
    console.error("API did not return an image. Response:", textResponse);
    throw new Error(`The AI model responded with text instead of an image: "${textResponse || 'No text response received.'}"`);
}

/**
 * A wrapper for the Gemini API call that includes a retry mechanism.
 * @param parts An array of Part objects for the request payload.
 * @returns The GenerateContentResponse from the API.
 */
async function callGeminiWithRetry(parts: Part[]): Promise<GenerateContentResponse> {
    const maxRetries = 3;
    const initialDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // FIX: Added `config` with `responseModalities` as required by the `gemini-2.5-flash-image-preview` model.
            return await ai.models.generateContent({
                model: 'gemini-2.5-flash-image-preview',
                contents: { parts },
                config: {
                    responseModalities: [Modality.IMAGE, Modality.TEXT],
                },
            });
        } catch (error) {
            console.error(`Error calling Gemini API (Attempt ${attempt}/${maxRetries}):`, error);
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            // Retry on common transient errors
            const isRetriableError = errorMessage.includes('"code":500') || errorMessage.includes('INTERNAL') || errorMessage.includes('503');

            if (isRetriableError && attempt < maxRetries) {
                const delay = initialDelay * Math.pow(2, attempt - 1);
                console.log(`Retriable error detected. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error; // Re-throw if not a retriable error or if max retries are reached.
        }
    }
    // This should be unreachable due to the loop and throw logic above.
    throw new Error("Gemini API call failed after all retries.");
}


/**
 * Generates an image based on a main image and several "vibe" inspiration images.
 * @param mainImageDataUrls An array of data URL strings of the main subject images.
 * @param inspirationDataUrls An array of data URL strings for the vibe/inspiration images.
 * @param userPrompt Optional user-provided instructions.
 * @returns A promise that resolves to a base64-encoded image data URL of the generated image.
 */
export async function generateVibeBasedImage(
    mainImageDataUrls: string[], 
    inspirationDataUrls: string[],
    userPrompt: string = ''
): Promise<string> {
  
    let textPrompt = `You are provided with several photos of the same person to understand their appearance from multiple angles. You are also provided with several "vibe" inspiration images.
Your task is to create a new, photorealistic image of the person from the main photos, but imbued with the aesthetic, color palette, lighting, composition, and overall vibe from the inspiration images.

Key instructions:
1. Accurately represent the person from the main photos. They must be clearly recognizable.
2. Perfectly blend the style of the inspiration photos with the person.
3. Choose the best pose or angle from the provided main photos as a base for the new image, but you can subtly adjust it to better fit the new style.
4. The final output must be only the image.`;

    if (userPrompt && userPrompt.trim() !== '') {
        textPrompt += `\n\nAdditionally, follow these user-provided instructions carefully: ${userPrompt.trim()}`;
    }

    try {
        const mainImageParts = mainImageDataUrls.map(dataUrlToGeminiPart);
        const inspirationImageParts = inspirationDataUrls.map(dataUrlToGeminiPart);
        const textPart = { text: textPrompt };

        const allParts = [...mainImageParts, ...inspirationImageParts, textPart];

        console.log(`Attempting generation with ${mainImageParts.length} main images and ${inspirationImageParts.length} inspiration images...`);
        const response = await callGeminiWithRetry(allParts);
        return processGeminiResponse(response);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
        console.error("An unrecoverable error occurred during image generation.", error);
        
        if (errorMessage.includes("The AI model responded with text")) {
             throw new Error(`The model couldn't generate an image with this vibe. It might be too complex.`);
        }
        throw new Error(`The AI model failed to generate an image. Details: ${errorMessage}`);
    }
}