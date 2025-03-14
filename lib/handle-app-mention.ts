import { AppMentionEvent } from "@slack/web-api";
import { client, getThread, sendUnifiedMessage } from "./slack-utils";
import { generateResponse } from "./generate-response";

// Add retry logic for Slack API calls
const withRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> => {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`Attempt ${attempt}/${maxRetries} failed:`, error);
      lastError = error;
      if (attempt < maxRetries) {
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // Exponential backoff
        delay *= 2;
      }
    }
  }
  throw lastError;
};

const updateStatusUtil = async (
  initialStatus: string,
  event: AppMentionEvent,
) => {
  console.log(`Posting initial message: "${initialStatus}"`);
  
  const initialMessage = await withRetry(() => 
    client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts ?? event.ts,
      text: initialStatus,
    })
  );

  if (!initialMessage || !initialMessage.ts)
    throw new Error("Failed to post initial message");

  console.log(`Initial message posted with ts: ${initialMessage.ts}`);

  const updateMessage = async (status: string) => {
    console.log(`Updating message to: "${status.substring(0, 50)}${status.length > 50 ? '...' : ''}"`);
    
    // Prevent empty status updates which cause Slack API errors
    const messageText = status.trim() === "" ? " " : status;
    
    // For longer responses, use blocks for better formatting
    const SECTION_BLOCK_LIMIT = 3000;
    const SLACK_TEXT_LIMIT = 40000;
    
    // Handle message length - truncate if necessary
    let finalText = messageText;
    if (finalText.length > SLACK_TEXT_LIMIT) {
      finalText = finalText.substring(0, SLACK_TEXT_LIMIT - 100) + 
        "\n\n[Message truncated due to length. Consider breaking your query into smaller parts.]";
    }
    
    // For short status updates, don't use blocks
    if (finalText.length < 100) {
      return await withRetry(() => 
        client.chat.update({
          channel: event.channel,
          ts: initialMessage.ts as string,
          text: finalText,
        })
      ).then(result => {
        console.log(`Message update successful: ${result.ok}`);
        return result;
      });
    }
    
    // For longer responses, use blocks for better formatting
    const blocks: Array<{
      type: string;
      text: {
        type: string;
        text: string;
      };
      expand?: boolean;
    }> = [];
    let startIndex = 0;
    
    while (startIndex < finalText.length) {
      // If we're near the end of the message, just take the rest
      if (startIndex + SECTION_BLOCK_LIMIT >= finalText.length) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: finalText.substring(startIndex),
          },
          expand: true
        });
        break;
      }
      
      // Find the last space before the limit
      let endIndex = startIndex + SECTION_BLOCK_LIMIT;
      const lastSpaceIndex = finalText.lastIndexOf(' ', endIndex);
      
      // If we found a space within a reasonable distance, use it
      if (lastSpaceIndex > startIndex && lastSpaceIndex > endIndex - 100) {
        endIndex = lastSpaceIndex;
      }
      
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: finalText.substring(startIndex, endIndex),
        },
        expand: true
      });
      
      startIndex = endIndex + 1;
    }
    
    return await withRetry(() => 
      client.chat.update({
        channel: event.channel,
        ts: initialMessage.ts as string,
        text: finalText, // Fallback text
        blocks,
      })
    ).then(result => {
      console.log(`Message update successful: ${result.ok}`);
      return result;
    });
  };
  
  return updateMessage;
};

export async function handleNewAppMention(
  event: AppMentionEvent,
  botUserId: string,
) {
  console.log(`Handling app mention: ${event.ts}`);
  if (event.bot_id || event.bot_id === botUserId || event.bot_profile) {
    console.log("Skipping app mention from bot");
    return;
  }

  // Debug full event to see what properties we actually have
  console.log("Full event object:", JSON.stringify(event, null, 2));

  const { thread_ts, channel } = event;
  console.log(`Processing request in channel: ${channel}, thread: ${thread_ts || 'new thread'}`);
  
  // Prepare context with channel information
  const context = {
    channelId: channel,
    threadTs: thread_ts || event.ts
  };
  console.log("Context prepared:", context);
  
  try {
    const updateMessage = await updateStatusUtil("is thinking...", event);
    console.log("Initial 'thinking' message posted");

    if (thread_ts) {
      console.log("Getting thread history");
      const messages = await getThread(channel, thread_ts, botUserId);
      console.log(`Thread history retrieved: ${messages.length} messages`);
      
      console.log("Generating response for thread");
      const result = await generateResponse(messages, updateMessage, context);
      console.log("Response generated, updating Slack message");
      
      await updateMessage(result);
    } else {
      console.log("Generating response for direct mention");
      const result = await generateResponse(
        [{ role: "user", content: event.text }],
        updateMessage,
        context
      );
      console.log("Response generated, updating Slack message");
      
      await updateMessage(result);
    }
  } catch (error) {
    console.error("Error handling app mention:", error);
    try {
      const updateMessage = await updateStatusUtil("Sorry, I encountered an error while processing your request. Please try again.", event);
      // No need to send a unified message, as the error message is already displayed
    } catch (secondaryError) {
      console.error("Failed to send error message:", secondaryError);
    }
  }
}
