import { AppMentionEvent } from "@slack/web-api";
import { client, getThread } from "./slack-utils";
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
    
    return await withRetry(() => 
      client.chat.update({
        channel: event.channel,
        ts: initialMessage.ts as string,
        text: status,
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

  const { thread_ts, channel } = event;
  console.log(`Processing request in channel: ${channel}, thread: ${thread_ts || 'new thread'}`);
  
  try {
    const updateMessage = await updateStatusUtil("is thinking...", event);
    console.log("Initial 'thinking' message posted");

    if (thread_ts) {
      console.log("Getting thread history");
      const messages = await getThread(channel, thread_ts, botUserId);
      console.log(`Thread history retrieved: ${messages.length} messages`);
      
      console.log("Generating response for thread");
      const result = await generateResponse(messages, updateMessage);
      console.log("Response generated, updating Slack message");
      
      const updateResult = await updateMessage(result);
      console.log(`Final message update complete: ${updateResult.ok}`);
    } else {
      console.log("Generating response for direct mention");
      const result = await generateResponse(
        [{ role: "user", content: event.text }],
        updateMessage,
      );
      console.log("Response generated, updating Slack message");
      
      const updateResult = await updateMessage(result);
      console.log(`Final message update complete: ${updateResult.ok}`);
    }
  } catch (error) {
    console.error("Error handling app mention:", error);
    try {
      const updateMessage = await updateStatusUtil("Sorry, I encountered an error while processing your request. Please try again.", event);
      await updateMessage("Sorry, I encountered an error while processing your request. Please try again.");
    } catch (secondaryError) {
      console.error("Failed to send error message:", secondaryError);
    }
  }
}
