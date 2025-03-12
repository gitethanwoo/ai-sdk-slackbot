import { generateResponse } from './lib/generate-response';
import { CoreMessage } from 'ai';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Check if JINA_API_KEY is set
if (!process.env.JINA_API_KEY) {
  console.error('Error: JINA_API_KEY environment variable is not set.');
  console.error('Please create a .env file with your Jina API key:');
  console.error('JINA_API_KEY=your_api_key_here');
  console.error('Get your Jina AI API key for free: https://jina.ai/?sui=apikey');
  process.exit(1);
}

// Test function
async function testWebScraper() {
  console.log('Testing web scraper...');
  
  // Create a test message that would trigger the web scraping tool
  const testMessages: CoreMessage[] = [
    {
      role: 'user',
      content: 'Can you scrape and summarize the content from https://jina.ai/about-us/'
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
    console.log('\nResponse from AI:');
    console.log('----------------');
    console.log(response);
    console.log('----------------');
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
testWebScraper(); 