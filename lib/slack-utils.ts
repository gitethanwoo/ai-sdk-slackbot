import { WebClient } from '@slack/web-api';
import { CoreMessage } from 'ai'
import crypto from 'crypto'

const signingSecret = process.env.SLACK_SIGNING_SECRET!

export const client = new WebClient(process.env.SLACK_BOT_TOKEN);

// See https://api.slack.com/authentication/verifying-requests-from-slack
export async function isValidSlackRequest({
  request,
  rawBody,
}: {
  request: Request
  rawBody: string
}) {
  // console.log('Validating Slack request')
  const timestamp = request.headers.get('X-Slack-Request-Timestamp')
  const slackSignature = request.headers.get('X-Slack-Signature')
  // console.log(timestamp, slackSignature)

  if (!timestamp || !slackSignature) {
    console.log('Missing timestamp or signature')
    return false
  }

  // Prevent replay attacks on the order of 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 60 * 5) {
    console.log('Timestamp out of range')
    return false
  }

  const base = `v0:${timestamp}:${rawBody}`
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(base)
    .digest('hex')
  const computedSignature = `v0=${hmac}`

  // Prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(slackSignature)
  )
}

export const verifyRequest = async ({
  requestType,
  request,
  rawBody,
}: {
  requestType: string;
  request: Request;
  rawBody: string;
}) => {
  const validRequest = await isValidSlackRequest({ request, rawBody });
  if (!validRequest || requestType !== "event_callback") {
    return new Response("Invalid request", { status: 400 });
  }
};

export const updateStatusUtil = (channel: string, thread_ts: string) => {
  return async (status: string) => {
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: thread_ts,
      status: status,
    });
  };
};

/**
 * Extract canvas IDs from Slack message links
 * Looks for canvas links in Slack messages
 */
export function extractCanvasIdFromLink(link: string): string | null {
  // Simple regex to extract canvas ID from Slack links
  // This handles both formats:
  // - https://workspace.slack.com/docs/team/F12345
  // - https://slack.com/docs/canvas/F12345
  const match = link.match(/\/docs\/(?:[^\/]+\/|canvas\/)([A-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Retrieve canvas content using the files.list API with canvas type filter
 */
export async function getCanvasContent(canvasId: string): Promise<string | null> {
  try {
    // Use files.list with canvas type filter as recommended in the documentation
    const response = await client.files.list({
      types: "canvas",
    });
    
    if (!response.ok || !response.files) {
      console.log("Failed to retrieve canvas list");
      return null;
    }
    
    // Find the specific canvas by ID
    const canvas = response.files.find(file => file.id === canvasId);
    
    if (!canvas) {
      console.log(`Canvas with ID ${canvasId} not found`);
      return null;
    }
    
    // Get the canvas content from the preview field
    if (canvas.preview) {
      return canvas.preview;
    } else if (canvas.permalink) {
      return `Canvas content available at: ${canvas.permalink}`;
    } else {
      console.log(`No preview content available for canvas ${canvasId}`);
      return null;
    }
  } catch (error) {
    console.log(`Error retrieving canvas content: ${error}`);
    return null;
  }
}

export async function getThread(
  channel_id: string,
  thread_ts: string,
  botUserId: string,
): Promise<CoreMessage[]> {
  const { messages } = await client.conversations.replies({
    channel: channel_id,
    ts: thread_ts,
    limit: 50,
  });

  // Ensure we have messages
  if (!messages) throw new Error("No messages found in thread");

  const result: CoreMessage[] = [];
  
  // Process each message
  for (const message of messages) {
    const isBot = !!message.bot_id;
    if (!message.text) continue;

    // For app mentions, remove the mention prefix
    // For IM messages, keep the full text
    let content = message.text;
    if (!isBot && content.includes(`<@${botUserId}>`)) {
      content = content.replace(`<@${botUserId}> `, "");
    }
    
    // Check for canvas links in the message
    // Slack formats links as <url|text>
    const linkMatches = content.match(/<(https?:\/\/[^|>]+)(?:\|[^>]+)?>/g);
    
    if (linkMatches) {
      for (const linkMatch of linkMatches) {
        // Extract the actual URL from the Slack link format
        const url = linkMatch.match(/<(https?:\/\/[^|>]+)(?:\|[^>]+)?>/)?.[1];
        
        if (url && (url.includes('/docs/') || url.includes('/canvas/'))) {
          const canvasId = extractCanvasIdFromLink(url);
          
          if (canvasId) {
            console.log(`Found canvas link with ID: ${canvasId}`);
            
            // Get canvas content using the dedicated function
            const canvasContent = await getCanvasContent(canvasId);
            
            if (canvasContent) {
              // Add the canvas content to the message
              content += `\n\n--- Canvas Content ---\n${canvasContent}\n--- End Canvas Content ---`;
              console.log(`Added canvas content for ID: ${canvasId}`);
            }
          }
        }
      }
    }

    result.push({
      role: isBot ? "assistant" : "user",
      content: content,
    });
  }

  return result;
}

export const getBotId = async () => {
  const { user_id: botUserId } = await client.auth.test();

  if (!botUserId) {
    throw new Error("botUserId is undefined");
  }
  return botUserId;
};
