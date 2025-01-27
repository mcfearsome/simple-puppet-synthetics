const puppeteer = require("puppeteer");
const promClient = require("prom-client");
const express = require("express");
const fs = require("fs");

// Initialize debug logging
const DEBUG = process.env.DEBUG || true;
function log(level, message, data = {}) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...data
    };
    console.log(JSON.stringify(logEntry));
}

let loadedConfig;
const config = function config() {
  if (loadedConfig) return loadedConfig;

  const configFile =
    process.env.SYNTHETIC_MONITOR_CONFIG_FILE ||
    "/etc/synthetic-monitor/config.json";
  log("info", "Loading configuration", { configFile });

  try {
    loadedConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    const targets = loadedConfig.targets;
    log("info", "Configuration loaded successfully", {
      targetCount: targets.length,
      targets: targets.map((t) => ({ name: t.name, url: t.loginUrl })),
    });
  } catch (error) {
    log("error", "Failed to load configuration", { error: error.message });
    process.exit(1);
  }
  return loadedConfig;
}


// Initialize Prometheus metrics (per target)
log('info', 'Initializing Prometheus metrics');
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

// Custom metrics with target labels
const loginDuration = new promClient.Histogram({
    name: "app_login_duration_seconds",
    help: "Duration of login attempt in seconds",
    labelNames: ['target'],
    buckets: [0.1, 0.5, 1, 2, 5],
    registers: [register],
});

const loginSuccess = new promClient.Counter({
    name: "app_login_success_total",
    help: "Total number of successful logins",
    labelNames: ['target'],
    registers: [register],
});

const loginFailure = new promClient.Counter({
    name: "app_login_failure_total",
    help: "Total number of failed logins",
    labelNames: ['target'],
    registers: [register],
});

async function performLoginCheck(target) {
    log('info', 'Starting login check', { 
        target: target.name,
        url: target.loginUrl
    });

    const browser = await puppeteer.launch({
        headless: false,
        executablePath: process.env['PUPPETEER_EXECUTABLE_PATH'],
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu"
        ],
    });
    
    
    log('debug', 'Browser launched', { target: target.name });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        log('debug', 'New page created', { target: target.name });

        const end = loginDuration.startTimer({ target: target.name });
        
        log('debug', 'Navigating to login page', { 
            target: target.name,
            url: target.loginUrl
        });

        await page.goto(target.loginUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.screenshot({
          path: "login.jpg",
        });
        
        log('debug', 'Navigation complete', { 
            target: target.name,
            currentUrl: page.url()
        });

        log('debug', 'Filling login form', { 
            target: target.name,
            selectors: {
                username: target.selectors.usernameField,
                password: target.selectors.passwordField,
                submit: target.selectors.submitButton
            }
        });

        await page.type(target.selectors.usernameField, target.credentials.username);
        await page.type(target.selectors.passwordField, target.credentials.password);
        await page.click(target.selectors.submitButton);
        await page.waitForNavigation({ waitUntil: "networkidle2" });
        const currentUrl = page.url();

        log("debug", "Waiting for success indicator", {
          target: target.name,
          selector: target.selectors.successValue,
        });

        if (target.selectors.successByCss) {
          await page.waitForSelector(target.selectors.successValue, {
            timeout: 10000,
          });
        } else if (target.selectors.successByUrl) {
          if (currentUrl !== target.selectors.successValue) {
            throw new Error(`Expected URL to be ${target.selectors.successValue}, but got ${currentUrl}`);
          }
        }

        log('debug', page.url())
        
        log('info', 'Login successful', { target: target.name });
        loginSuccess.inc({ target: target.name });
        end();
    } catch (error) {
        log('error', 'Login check failed', { 
            target: target.name,
            error: error.message,
            stack: error.stack
        });
        loginFailure.inc({ target: target.name });
    } finally {
        try {
            await browser.close();
            log('debug', 'Browser closed', { target: target.name });
        } catch (error) {
            log('error', 'Failed to close browser', { 
                target: target.name,
                error: error.message
            });
        }
    }
}

// Setup Express server
const app = express();
const port = process.env.PORT || 3000;

app.get("/metrics", async (req, res) => {
    log('debug', 'Metrics endpoint called');
    try {
        res.set("Content-Type", register.contentType);
        const metrics = await register.metrics();
        log('debug', 'Metrics generated successfully', { 
            metricsLength: metrics.length 
        });
        res.end(metrics);
    } catch (error) {
        log('error', 'Failed to generate metrics', { 
            error: error.message 
        });
        res.status(500).end(error);
    }
});

app.get("/health", (req, res) => {
    log('debug', 'Health check endpoint called');
    res.status(200).send("OK");
});

app.listen(port, () => {
    log('info', 'Server started', { port });
    const c = config();
    const targets = c.targets;
    // Schedule monitoring checks for each target
    targets.forEach(target => {
        const checkInterval = target.checkInterval || 300000;
        log('info', 'Scheduling checks for target', { 
            target: target.name,
            checkInterval,
            initialCheck: true
        });
        
        setInterval(() => performLoginCheck(target), checkInterval);
        performLoginCheck(target); // Initial check
    });
});