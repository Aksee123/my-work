// monitor.js
const puppeteer = require('puppeteer');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');

// --- Pushover notification setup ---
// Replace these with your actual Pushover App Token and User Key.
const PUSHOVER_APP_TOKEN = 'ate7i8mwaxtznrnfcu2ri5kgy6kady';
const PUSHOVER_USER_KEY = 'u5kcs5stos8hxa6dut8785jkxxtmn7';

// Global variable to track if an appointment was booked in the last 24 hours.
let appointmentBookedInLast24Hours = false;

// Process-level unhandled rejection handler.
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

// Function to send a Pushover notification using Axios.
async function sendPushoverNotification(message) {
  const url = 'https://api.pushover.net/1/messages.json';
  try {
    const response = await axios.post(url, {
      token: PUSHOVER_APP_TOKEN,
      user: PUSHOVER_USER_KEY,
      message: message,
    });
    console.log("Pushover notification sent:", response.data);
  } catch (error) {
    console.error("Error sending Pushover notification:", error);
    // Continue running even if notification fails.
  }
}

// Send a startup notification (once).
sendPushoverNotification("🟢 Appointment booking script started!");

// Schedule a daily report at midnight (server time).
cron.schedule('0 0 * * *', () => {
  const reportMessage = appointmentBookedInLast24Hours
    ? "📢 Daily Report: An appointment was booked in the last 24 hours! ✅"
    : "📢 Daily Report: No appointment was booked in the last 24 hours. ❌";
  sendPushoverNotification(reportMessage);
  appointmentBookedInLast24Hours = false; // Reset for the next 24 hours.
});

// --- Utility functions ---
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper function to click an element via XPath.
 * It uses document.evaluate to locate the element, scrolls it into view, then clicks it.
 */
async function clickElementByXPath(page, xpath, description) {
  const elementHandle = await page.evaluateHandle((xp) => {
    const result = document.evaluate(
      xp,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  }, xpath);
  
  if (elementHandle) {
    await elementHandle.evaluate(el => el.scrollIntoView());
    await delay(500);
    await elementHandle.click();
    console.log(`Clicked ${description}.`);
    return true;
  } else {
    throw new Error(`${description} not found using XPath: ${xpath}`);
  }
}

/**
 * Helper function to click the "Next step" button within a specified container.
 */
async function clickNextStep(page, containerSelector) {
  const buttonSelector = `${containerSelector} button.btn-next-step`;
  await page.waitForSelector(buttonSelector, { timeout: 15000 });
  await page.evaluate((sel) => {
    document.querySelector(sel).click();
  }, buttonSelector);
  console.log(`Clicked Next step button in ${containerSelector} using evaluate.`);
}

/**
 * Sets up a MutationObserver on the calendar message element to detect text changes
 * and sends a Pushover notification.
 */
async function monitorCalendarMessage(page) {
  try {
    await page.exposeFunction('notifyChange', (msg) => {
      sendPushoverNotification(`Calendar message changed: ${msg}`);
    });
    await page.evaluate(() => {
      const msgEl = document.querySelector('div.message');
      if (msgEl) {
        const observer = new MutationObserver((mutationsList) => {
          for (const mutation of mutationsList) {
            window.notifyChange(msgEl.innerText);
          }
        });
        observer.observe(msgEl, { childList: true, subtree: true, characterData: true });
        console.log("Calendar message observer set up.");
      } else {
        console.log("No calendar message element found to monitor.");
      }
    });
  } catch (err) {
    console.error("Error setting up calendar message observer:", err);
  }
}

/**
 * Main function to perform the booking attempt.
 * Creates a fresh page, fills the form, selects service, monitors the calendar,
 * and attempts to book an appointment.
 * @param {object} browser - The Puppeteer browser instance.
 */
async function checkAndBook(browser) {
  const page = await browser.newPage();
  // Clear cookies and cache.
  try {
    await page._client().send('Network.clearBrowserCookies');
    await page._client().send('Network.clearBrowserCache');
  } catch (err) {
    console.error("Error clearing cookies/cache:", err);
  }
  
  // ----- Step 1: Personal Details -----
  const personalDetailsUrl = 'https://pieraksts.mfa.gov.lv/en/uited-arab-emirates';
  console.log("Navigating to Personal Details page:", personalDetailsUrl);
  try {
    await page.goto(personalDetailsUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch (err) {
    console.error("Failed to load Personal Details page:", err);
    await page.close();
    return false;
  }
  await delay(3000);
  
  console.log("Filling out personal details...");
  try {
    await page.waitForSelector('#Persons\\[0\\]\\[first_name\\]', { timeout: 20000 });
    await page.type('#Persons\\[0\\]\\[first_name\\]', 'rao aksee');
    await page.waitForSelector('#Persons\\[0\\]\\[last_name\\]', { timeout: 20000 });
    await page.type('#Persons\\[0\\]\\[last_name\\]', 'nasir');
    await page.waitForSelector('#e_mail', { timeout: 20000 });
    await page.type('#e_mail', 'akseenasir@gmail.com');
    await page.waitForSelector('#e_mail_repeat', { timeout: 20000 });
    await page.type('#e_mail_repeat', 'akseenasir@gmail.com');
    await page.waitForSelector('#phone', { timeout: 20000 });
    await page.type('#phone', '+923136722218');
  } catch (err) {
    console.error("Error filling personal details:", err);
    await page.close();
    return false;
  }
  
  await page.screenshot({ path: 'step1_details.png' });
  
  console.log("Clicking Next on personal details page...");
  try {
    await clickNextStep(page, '#step1-next-btn');
  } catch (err) {
    console.error("Error clicking Next on personal details page:", err);
    await page.close();
    return false;
  }
  await delay(4000);
  
  // ----- Step 2: Service Selection -----
  console.log("Waiting for service selection page to load...");
  try {
    await page.waitForSelector('div.form-services--title.js-services', { timeout: 20000 });
    await page.waitForSelector('div.form-services--title.js-services img.arrow-down', { timeout: 15000 });
    await page.click('div.form-services--title.js-services img.arrow-down');
    console.log("Clicked arrow-down to expand service dropdown.");
  } catch (err) {
    console.error("Error expanding service dropdown:", err);
    await page.close();
    return false;
  }
  await delay(2500);
  await page.screenshot({ path: 'step2_service.png' });
  
  try {
    await page.waitForSelector('#Persons-0-276', { timeout: 15000 });
    const serviceCheckbox = await page.$('#Persons-0-276');
    const isChecked = await page.evaluate(el => el.checked, serviceCheckbox);
    if (!isChecked) {
      await serviceCheckbox.click();
      console.log("Checked service 'Residence permit request - STUDENTS'.");
    } else {
      console.log("Service 'Residence permit request - STUDENTS' already checked.");
    }
  } catch (err) {
    console.error("Error selecting service checkbox:", err);
    await page.close();
    return false;
  }
  
  try {
    await page.waitForSelector('label[for="active-confirmation"]', { timeout: 15000 });
    await page.click('label[for="active-confirmation"]');
    console.log("Clicked confirmation label for service confirmation.");
  } catch (err) {
    console.error("Error clicking confirmation label:", err);
    await page.close();
    return false;
  }
  await delay(1000);
  
  try {
    await page.waitForSelector('button.js-addService[data-serviceid="Persons-0-276"]', { timeout: 15000 });
    await page.click('button.js-addService[data-serviceid="Persons-0-276"]');
    console.log("Clicked Add button for 'Residence permit request - STUDENTS'.");
  } catch (err) {
    console.error("Error clicking Add button for service:", err);
    await page.close();
    return false;
  }
  
  try {
    console.log("Clicking Next on service selection page...");
    await clickNextStep(page, '#step2-next-btn');
  } catch (err) {
    console.error("Error clicking Next on service selection page:", err);
    await page.close();
    return false;
  }
  await delay(4000);
  
  // ----- Step 3: Appointment Calendar & Monitoring -----
  console.log("Waiting for appointment calendar to load...");
  try {
    await page.waitForSelector('#calendar', { timeout: 30000 });
  } catch (err) {
    console.error("Calendar (#calendar) not found. URL:", page.url());
    await page.screenshot({ path: 'calendar_not_found.png' });
    await page.close();
    return false;
  }
  await delay(3000);
  await page.screenshot({ path: 'step3_calendar.png' });
  
  // Set up calendar message monitoring.
  monitorCalendarMessage(page).catch(err => console.error("Monitor error:", err));
  
  console.log("Checking for available appointment dates...");
  const availableDates = await page.$$('.available-date');
  if (availableDates.length > 0) {
    console.log("Available appointment date found! Booking appointment...");
    await availableDates[0].click();
    await delay(1500);
    
    try {
      await page.waitForSelector('#step3-next-btn', { visible: true, timeout: 10000 });
      await page.evaluate(() => {
        document.querySelector('#step3-next-btn button.btn-next-step').click();
      });
      console.log("Clicked Next step on appointment calendar page.");
      sendPushoverNotification("Next step on appointment calendar page clicked.");
    } catch (err) {
      console.log("Next step button on appointment calendar page not visible.");
    }
    
    try {
      await page.waitForSelector('button#bookAppointment', { timeout: 15000 });
      await page.click('button#bookAppointment');
      await page.waitForSelector('.confirmation-message', { timeout: 30000 });
      console.log("Appointment successfully booked!");
      await page.screenshot({ path: 'step4_confirmation.png' });
      sendPushoverNotification("Appointment successfully booked!");
      appointmentBookedInLast24Hours = true;
      await page.close();
      return true;
    } catch (err) {
      console.error("Error during final booking step:", err);
      await page.close();
      return false;
    }
  } else {
    console.log("No available appointment date found in this iteration.");
    await page.close();
    return false;
  }
}

(async () => {
  try {
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

    let booked = false;
    
    console.log("Starting appointment booking process...");
    // Run continuously until an appointment is booked or cancellation flag (stop.txt) is detected.
    while (!booked) {
      if (fs.existsSync('stop.txt')) {
        console.log("Cancellation flag detected (stop.txt). Exiting process.");
        break;
      }
      
      try {
        booked = await checkAndBook(browser);
      } catch (err) {
        console.error("Error during booking attempt:", err);
      }
      
      if (!booked) {
        console.log("No appointment booked. Waiting 5 minutes before next attempt...");
        await delay(300000); // 5 minutes delay
      }
    }
    
    console.log("Process completed. Closing browser.");
    await browser.close();
  } catch (err) {
    console.error("Error in main process:", err);
  }
})();

