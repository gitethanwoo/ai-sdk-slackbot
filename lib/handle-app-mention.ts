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
    
    return await withRetry(() => 
      client.chat.update({
        channel: event.channel,
        ts: initialMessage.ts as string,
        text: messageText,
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
      
      await sendUnifiedMessage({
        channel,
        threadTs: thread_ts,
        text: result,
        updateStatus: updateMessage,
        context,
      });
    } else {
      console.log("Generating response for direct mention");
      const result = await generateResponse(
        [{ role: "user", content: event.text }],
        updateMessage,
        context
      );
      console.log("Response generated, updating Slack message");
      
      await sendUnifiedMessage({
        channel,
        threadTs: event.ts,
        text: result,
        updateStatus: updateMessage,
        context,
      });
    }
  } catch (error) {
    console.error("Error handling app mention:", error);
    try {
      const updateMessage = await updateStatusUtil("Sorry, I encountered an error while processing your request. Please try again.", event);
      await sendUnifiedMessage({
        channel: event.channel,
        threadTs: event.thread_ts ?? event.ts,
        text: "Sorry, I encountered an error while processing your request. Please try again.",
        updateStatus: updateMessage,
      });
    } catch (secondaryError) {
      console.error("Failed to send error message:", secondaryError);
    }
  }
}
