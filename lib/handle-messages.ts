import type {
  AssistantThreadStartedEvent,
  GenericMessageEvent,
} from "@slack/web-api";
import { client, getThread, updateStatusUtil } from "./slack-utils";
import { generateResponse } from "./generate-response";

export async function assistantThreadMessage(
  event: AssistantThreadStartedEvent,
) {
  const { channel_id, thread_ts } = event.assistant_thread;
  console.log(`Thread started: ${channel_id} ${thread_ts}`);
  console.log(JSON.stringify(event));

  await client.chat.postMessage({
    channel: channel_id,
    thread_ts: thread_ts,
    text: "Hello, I'm an AI assistant built with the AI SDK by Vercel!",
  });

  await client.assistant.threads.setSuggestedPrompts({
    channel_id: channel_id,
    thread_ts: thread_ts,
    prompts: [
      {
        title: "Search the web",
        message: "What are the latest developments in AI technology in 2024?",
      },
      {
        title: "Scrape a webpage",
        message: "What are the strengths and weaknesses of our landing page? https://www.servant.io",
      },
      {
        title: "Research a topic",
        message: "Ask me clarifying questions to research this query: Conduct a comprehensive research on the market size for AI consultants in 2025.",
      },
    ],
  });
}

export async function handleNewAssistantMessage(
  event: GenericMessageEvent,
  botUserId: string,
) {
  if (
    event.bot_id ||
    event.bot_id === botUserId ||
    event.bot_profile ||
    !event.thread_ts
  )
    return;

  const { thread_ts, channel } = event;
  const updateStatus = updateStatusUtil(channel, thread_ts);
  updateStatus("is thinking...");

  const messages = await getThread(channel, thread_ts, botUserId);
  const result = await generateResponse(messages, updateStatus);

  // Slack has a 3000 character limit for a single text block
  const SLACK_CHAR_LIMIT = 3000;
  
  // Check if this is likely a deep research result (long text)
  const isLongResearchResult = result.length > SLACK_CHAR_LIMIT && 
    (result.includes("research") || messages.some(m => m.content.toString().includes("research")));
  
  if (isLongResearchResult) {
    try {
      // Check if canvas creation is available by checking if the canvases API exists
      // and if the bot has the necessary permissions
      let canvasCreationAvailable = false;
      
      try {
        // Try to check if we have canvas permissions
        if (client.canvases) {
          // Just check if the API is available, don't actually create a canvas yet
          console.log("Canvas API is available, will attempt to use it");
          canvasCreationAvailable = true;
        }
      } catch (e) {
        console.log("Canvas API not available:", e);
        canvasCreationAvailable = false;
      }
      
      if (canvasCreationAvailable) {
        // Create a canvas for the research result
        updateStatus("is preparing research canvas...");
        
        // Extract a title from the first few lines of the result
        const firstLineBreak = result.indexOf('\n');
        const potentialTitle = firstLineBreak > 0 
          ? result.substring(0, Math.min(firstLineBreak, 100)).trim() 
          : "Research Report";
        
        const title = potentialTitle.replace(/^#+\s*/, ''); // Remove markdown heading symbols if present
        
        // Create the canvas with the research content
        const canvasResponse = await client.canvases.create({
          title: title,
          document_content: {
            type: "markdown",
            markdown: result
          }
        });
        
        if (!canvasResponse.ok) {
          throw new Error(`Failed to create canvas: ${canvasResponse.error}`);
        }
        
        const canvasId = canvasResponse.canvas_id;
        
        // Send a message with a link to the canvas
        // Slack will automatically unfurl the canvas when shared in a message
        await client.chat.postMessage({
          channel: channel,
          thread_ts: thread_ts,
          text: `I've prepared a detailed research report for you. View the full report here: <https://slack.com/docs/canvas/${canvasId}|${title}>`,
          unfurl_links: true,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `I've prepared a detailed research report for you. View the full report here: <https://slack.com/docs/canvas/${canvasId}|${title}>`
              }
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Summary:* ${result.substring(0, Math.min(200, result.length))}...`
              }
            }
          ]
        });
        
        console.log(`Created canvas for research result with ID: ${canvasId}`);
      } else {
        // Canvas creation not available, fall back to splitting messages
        console.log("Canvas creation not available, falling back to splitting messages");
        sendSplitMessages(channel, thread_ts, result);
      }
    } catch (error) {
      console.error("Error creating canvas:", error);
      
      // Fall back to splitting messages if canvas creation fails
      console.log("Falling back to splitting messages...");
      sendSplitMessages(channel, thread_ts, result);
    }
  } else {
    // For regular messages within the character limit, send as a single message
    if (result.length <= SLACK_CHAR_LIMIT) {
      await client.chat.postMessage({
        channel: channel,
        thread_ts: thread_ts,
        text: result,
        unfurl_links: false,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: result,
            },
          },
        ],
      });
    } else {
      // For long messages that aren't research results, split them
      sendSplitMessages(channel, thread_ts, result);
    }
  }

  updateStatus("");
}

/**
 * Sends a long message split into multiple messages
 */
async function sendSplitMessages(channel: string, thread_ts: string, text: string) {
  const SLACK_CHAR_LIMIT = 3000;
  
  // Find natural break points (paragraphs, sentences) to split the text
  const chunks = splitTextIntoChunks(text, SLACK_CHAR_LIMIT);
  
  console.log(`Splitting message into ${chunks.length} chunks`);
  
  // Send each chunk as a separate message
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isFirstChunk = i === 0;
    const prefix = isFirstChunk ? "" : `(continued ${i+1}/${chunks.length}):\n\n`;
    
    await client.chat.postMessage({
      channel: channel,
      thread_ts: thread_ts,
      text: prefix + chunk,
      unfurl_links: false,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: prefix + chunk,
          },
        },
      ],
    });
  }
}

/**
 * Splits text into chunks that respect Slack's character limit
 * Tries to split at natural break points like paragraphs or sentences
 */
function splitTextIntoChunks(text: string, maxChunkSize: number): string[] {
  const chunks: string[] = [];
  let remainingText = text;
  
  while (remainingText.length > 0) {
    // If remaining text fits in a chunk, add it and we're done
    if (remainingText.length <= maxChunkSize) {
      chunks.push(remainingText);
      break;
    }
    
    // Try to find a natural break point within the limit
    let breakPoint = findBreakPoint(remainingText, maxChunkSize);
    
    // Extract the chunk and update remaining text
    const chunk = remainingText.substring(0, breakPoint).trim();
    chunks.push(chunk);
    remainingText = remainingText.substring(breakPoint).trim();
  }
  
  return chunks;
}

/**
 * Finds a natural break point in text within the specified limit
 * Prioritizes paragraph breaks, then sentence breaks, then word breaks
 */
function findBreakPoint(text: string, limit: number): number {
  // If text is shorter than limit, return its length
  if (text.length <= limit) {
    return text.length;
  }
  
  // Look for paragraph breaks (double newline)
  const lastParagraphBreak = text.lastIndexOf("\n\n", limit);
  if (lastParagraphBreak > 0) {
    return lastParagraphBreak + 2; // Include the newlines
  }
  
  // Look for single newlines
  const lastNewline = text.lastIndexOf("\n", limit);
  if (lastNewline > 0) {
    return lastNewline + 1; // Include the newline
  }
  
  // Look for sentence breaks (.!?)
  for (let i = limit; i > 0; i--) {
    if (['.', '!', '?'].includes(text[i]) && (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '\n')) {
      return i + 1; // Include the punctuation
    }
  }
  
  // Fall back to word breaks
  const lastSpace = text.lastIndexOf(" ", limit);
  if (lastSpace > 0) {
    return lastSpace + 1; // Include the space
  }
  
  // If no good break point found, just cut at the limit
  return limit;
}
