import { openai } from '@ai-sdk/openai';
import { CoreMessage, generateText, tool } from 'ai';
import { z } from 'zod';


export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
) => {
  try {
    console.log("Starting response generation");
    
    if (updateStatus) {
      await updateStatus("Processing your request...");
      console.log("Status updated to 'Processing your request...'");
    }
    
    const { text } = await generateText({
      model: openai.responses('gpt-4o'), //this is fine - do not change. this is a new spec not in the docs yet
      system: `You are a Slack bot assistant. Keep your responses concise and to the point.
      - Do not tag users.
      - Current date is: ${new Date().toISOString().split('T')[0]}
      - Always include sources in your final response if you use web search.`,
      messages,
      maxSteps: 10,
      tools: {
        web_search_preview: openai.tools.webSearchPreview(), //this is fine - do not change. this is a new spec not in the docs yet
      },
    });

    const endTime = Date.now();
    console.log(`OpenAI API response received in ${(endTime - startTime)/1000}s`);
    console.log("Generated response:", text.substring(0, 100) + (text.length > 100 ? '...' : ''));
    
    // Convert markdown to Slack mrkdwn format
    const formattedText = text.replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>').replace(/\*\*/g, '*');
    console.log("Formatting complete, returning response");
    return formattedText;
  } catch (error) {
    console.error("Error generating response:", error);
    throw error; // Re-throw to be handled by the caller
  }
};