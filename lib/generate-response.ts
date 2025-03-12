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
       updateStatus("Processing your request...");
      console.log("Status updated to 'Processing your request...'");
    }
    
    const { text } = await generateText({
      model: openai('gpt-4o'), //this is fine - do not change. this is a new spec not in the docs yet
      system: `You are a Slack bot assistant. Keep your responses concise and to the point.
      - Do not tag users.
      - Current date is: ${new Date().toISOString().split('T')[0]}
      - Always include sources in your final response if you use web search.`,
      messages,
      maxSteps: 10,
      tools: {
        webScrape: tool({
          description: 'Scrape a webpage and return its content in a format optimized for LLMs',
          parameters: z.object({
            url: z.string().url().describe('The URL of the webpage to scrape'),
          }),
          execute: async ({ url }: { url: string }) => {
            try {
              // Get your Jina AI API key for free: https://jina.ai/?sui=apikey
              const apiKey = process.env.JINA_API_KEY;
              if (!apiKey) {
                throw new Error('JINA_API_KEY environment variable is not set');
              }

              const response = await fetch('https://r.jina.ai/', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                  'X-With-Links-Summary': 'true',
                  'X-With-Images-Summary': 'true'
                },
                body: JSON.stringify({ url })
              });

              if (!response.ok) {
                throw new Error(`Failed to scrape webpage: ${response.statusText}`);
              }

              const data = await response.json();
              
              if (data.code !== 200) {
                throw new Error(`Failed to scrape webpage: ${data.status}`);
              }

              // Extract the content from the response
              const { title, description, content, links, images } = data.data;
              
              // Format the response
              return {
                title,
                description,
                content,
                links: links || {},
                images: images || {},
                url
              };
            } catch (error: unknown) {
              console.error('Error scraping webpage:', error);
              const errorMessage = error instanceof Error ? error.message : String(error);
              return { error: errorMessage };
            }
          }
        }),
      },
    });
    
    // Convert markdown to Slack mrkdwn format
    const formattedText = text.replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>').replace(/\*\*/g, '*');
    console.log("Formatting complete, returning response");
    return formattedText;
  } catch (error) {
    console.error("Error generating response:", error);
    throw error; // Re-throw to be handled by the caller
  }
};