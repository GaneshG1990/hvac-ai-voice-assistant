/**
 * Test script to verify Telegram message sending with existing case
 * Run with: node test-telegram.js
 */

const { requestPictures } = require('./server/services/telegram');
const fs = require('fs').promises;
const path = require('path');

async function testTelegramMessage() {
    console.log('🧪 Testing Telegram Message Sending with Existing Case\n');
    
    try {
        // Read existing cases
        const casesPath = path.join(__dirname, 'server/data/cases.json');
        const casesData = await fs.readFile(casesPath, 'utf8');
        const cases = JSON.parse(casesData);
        
        // Find a case with PICTURES action_required
        const testCase = cases.find(c => 
            c.analysis && 
            c.analysis.action_required === 'PICTURES' &&
            c.analysis.contact_number
        );
        
        if (!testCase) {
            console.error('❌ No suitable test case found. Need a case with action_required: PICTURES and contact_number');
            return;
        }
        
        console.log('✅ Found test case:');
        console.log(`   Case ID: ${testCase.id}`);
        console.log(`   Client Name: ${testCase.analysis.client_name || 'Not available'}`);
        console.log(`   Contact Number: ${testCase.analysis.contact_number}`);
        console.log(`   Action Required: ${testCase.analysis.action_required}`);
        console.log(`   Picture Details: ${testCase.analysis.picture_requirement_details}`);
        console.log(`   Telegram Chat ID: ${testCase.telegramChatId || 'Not available (will be stored for later)'}\n`);
        
        // Extract data
        const phoneNumber = testCase.analysis.contact_number || testCase.clientData?.contact;
        const caseId = testCase.id;
        const pictureDetails = testCase.analysis.picture_requirement_details || 'Pictures needed for assessment';
        const problemSummary = testCase.analysis.problem_summary || 'HVAC issue requires assessment';
        const clientName = testCase.analysis.client_name || testCase.clientData?.name || null;
        const chatId = testCase.telegramChatId || null;
        
        console.log('📤 Attempting to send Telegram message...\n');
        console.log('Parameters:');
        console.log(`   Phone Number: ${phoneNumber}`);
        console.log(`   Case ID: ${caseId}`);
        console.log(`   Client Name: ${clientName || 'Not provided'}`);
        console.log(`   Chat ID: ${chatId || 'Not available (message will be stored)'}\n`);
        
        // Call requestPictures
        const result = await requestPictures(
            phoneNumber,
            caseId,
            pictureDetails,
            problemSummary,
            clientName,
            chatId
        );
        
        console.log('📬 Result:');
        console.log(JSON.stringify(result, null, 2));
        
        if (result.success) {
            if (result.messageSent) {
                console.log('\n✅ SUCCESS: Message sent successfully via Telegram!');
            } else {
                console.log('\n⚠️  Message stored: User needs to start conversation with bot first');
                console.log(`   User should send /start to @HVACFDA_bot or provide Case ID: ${caseId}`);
            }
        } else {
            console.log('\n❌ FAILED: Could not send message');
            if (result.error) {
                console.log(`   Error: ${result.error}`);
            }
        }
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error('Stack:', error.stack);
        
        if (error.message.includes('TELEGRAM_BOT_TOKEN')) {
            console.error('\n💡 TIP: Make sure TELEGRAM_BOT_TOKEN is set in your .env file');
        }
    }
}

// Run the test
testTelegramMessage().then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
}).catch(error => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
});

