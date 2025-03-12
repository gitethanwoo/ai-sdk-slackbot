import { generateResponse } from './lib/generate-response';
import { CoreMessage } from 'ai';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Check if PERPLEXITY_API_KEY is set
if (!process.env.PERPLEXITY_API_KEY) {
  console.error('Error: PERPLEXITY_API_KEY environment variable is not set.');
  console.error('Please create a .env file with your Perplexity API key:');
  console.error('PERPLEXITY_API_KEY=your_api_key_here');
  console.error('Get your Perplexity API key from: https://docs.perplexity.ai/');
  process.exit(1);
}

// Test function
async function testDeepResearch() {
  // Get format and perspective from command line arguments
  const args = process.argv.slice(2);
  const format = args[0] || 'comparison';
  const perspective = args[1] || 'business';
  
  console.log('Testing Deep Research with Perplexity...');
  console.log(`Query: "What's the best form provider solution for Webflow?"`);
  console.log(`Format: ${format}`);
  console.log(`Perspective: ${perspective}`);
  console.log('This may take some time as the model conducts comprehensive research...');
  
  // Create a test message that would trigger the deep research tool with specific parameters
  const testMessages: CoreMessage[] = [
    {
      role: 'user',
      content: `Use deep research to tell me what's the best form provider solution for Webflow? 
      Format the response as a ${format} and take a ${perspective} perspective.`
    }
  ];
  
  // Status update callback
  const updateStatus = (status: string) => {
    console.log(`Status: ${status}`);
  };
  
  try {
    // Call the generateResponse function
    const response = await generateResponse(testMessages, updateStatus);
    
    // Log the response
    console.log('\nResponse from Deep Research:');
    console.log('----------------');
    console.log(response);
    console.log('----------------');
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
testDeepResearch(); 