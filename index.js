const puppeteer = require('puppeteer');
const devices = require('puppeteer/DeviceDescriptors');
const iPhoneXR = devices.devicesMap['Nexus 5'];

const fs = require("fs");

const { getJsUrls } = require("./getUrls");
const { getTimeFromPerformanceMetrics, extractDataFromPerformanceMetrics, } = require("./helpers");
const { calcLCP } = require("./lcp");
const { calcJank } = require("./cls");

const site = "https://www.blick.ch/news/ausland/streit-um-superspreader-anlaesse-ist-es-asozial-jetzt-protestieren-zu-gehen-id15940804.html"
const filename = "blick-article-NEW"

let lcpAllRequest = 0
let clsAllRequest = 0
let scriptDurationAllRequest = 0

const okConnection = {
    'offline': false,
    'downloadThroughput': 5 * 1024 * 1024 / 8,
    'uploadThroughput': 4 * 1024 * 1024 / 8,
    'latency': 40
};

//Run without a JS file 
const runWithout = async (without) => {
    const browser = await puppeteer.launch({
        headless: true,
        ignoreHTTPSErrors: true,
        timeout: 10000
    });

    const page = await browser.newPage()
    await page.emulate(iPhoneXR);

    //Request Interception: Block the URL in "without"
    if (without !== false) {
        await page.setRequestInterception(true);
        page.on('request', interceptedRequest => {
            if (interceptedRequest.url().includes(without.url)) {
                interceptedRequest.abort();
            } else {
                interceptedRequest.continue();
            }
        });
    }

    //Access Chrome DevTools Protocol
    const client = await page.target().createCDPSession()

    await client.send('Network.enable');
    await client.send('Network.clearBrowserCache');
    await client.send('Performance.enable');
    await client.send('ServiceWorker.enable');
    await client.send('Network.emulateNetworkConditions', okConnection);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

    //Cache disabled
    await page.setCacheEnabled(false);

    //LCP / CLS
    await page.evaluateOnNewDocument(calcLCP);
    await page.evaluateOnNewDocument(calcJank);

    await page.goto(site, { waitUntil: 'load', timeout: 60000 }); //Is networkidle2 really needed here .... 
    await page.waitFor(10000)

    let lcp = await page.evaluate(() => { return window.largestContentfulPaint; });
    let cls = await page.evaluate(() => { return window.cumulativeLayoutShiftScore; });

    //Scripting Duration 
    const metrics = await client.send('Performance.getMetrics');
    const scriptDuration = getTimeFromPerformanceMetrics(metrics, 'ScriptDuration')

    await page.screenshot({path: 'results/' + filename + '/' + without.file + '.png'});

    await browser.close();

    //Output
    if (without !== false) {
        console.log('WITHOUT ' + without.file)
        console.log('async ' + without.async)
        console.log('defer ' + without.defer)
        console.log('LCP --------------------> ' + lcp.toFixed(4) + ' ### ' + (lcp - lcpAllRequest).toFixed(4) + " ### " + ((Math.abs(lcp - lcpAllRequest) / lcpAllRequest) * 100).toFixed() + "%");
        console.log('CLS --------------------> ' + cls.toFixed(4) + ' ### ' + (cls - clsAllRequest).toFixed(4) + " ### " + ((Math.abs(cls - clsAllRequest) / clsAllRequest) * 100).toFixed() + "%");
        console.log('ScriptDuration ---------> ' + scriptDuration.toFixed(4) + ' ### ' + (scriptDuration - scriptDurationAllRequest).toFixed(4) + " ### " + ((Math.abs(scriptDuration - scriptDurationAllRequest) / scriptDurationAllRequest) * 100).toFixed() + "%");
        await fs.appendFile('results/' + filename  + '/data.csv', without.url + ', ' + without.async + ', ' + without.defer + ', ' + lcp.toFixed(4) + ', ' + cls.toFixed(4) + ', ' + scriptDuration.toFixed(4) + '\r\n', function (err) {
            if (err) throw err;
        });
        console.log("==============================================")
    } else {
        console.log('With no request blocked')
        //set all Requests KPIs
        lcpAllRequest = lcp
        clsAllRequest = cls
        scriptDurationAllRequest = scriptDuration
        console.log('LCP --------------------> ' + lcp.toFixed(4));
        console.log('CLS --------------------> ' + cls.toFixed(4));
        console.log('ScriptDuration ---------> ' + scriptDuration.toFixed(4));
        await fs.appendFile('results/' + filename  + '/data.csv', 'nothing blocked, -, -,' + lcp.toFixed(4) + ', ' + cls.toFixed(4) + ', ' + scriptDuration.toFixed(4) + '\r\n', function (err) {
            if (err) throw err;
        }); 
        console.log("==============================================")
    }
};

//Start
const start = async () => {
    //Get JS Ressource URLs
    const jsUrls = await getJsUrls(site)
    //console.log(jsUrls)

    for (let i = 0; i < 10; i++) {
        console.log("##############################################")
        console.log("Run: " + i + " for " + site)

        await runWithout(false)

        //Test without all of them
        for (let index = 0; index < jsUrls.length; index++) {
            try {
                await runWithout(jsUrls[index])
            } catch (error) {
                console.log(error)
            }
        }

        //Test manual 
        //await runWithout('player')
        //await runWithout('ad')
    }
}

start()