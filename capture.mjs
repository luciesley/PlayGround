import { createRequire } from 'node:module'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const url = process.env.CAPTURE_URL
const output = process.env.CAPTURE_DIR

class CaptureError extends Error {
  constructor(message, exitCode) {
    super(message)
    this.exitCode = exitCode
  }
}

function classify(error, phase) {
  if (error instanceof CaptureError) return error
  const message = error?.message || String(error)
  const transient = [
    /TimeoutError/i,
    /net::/i,
    /ERR_[A-Z_]+/,
    /Target (?:page|browser)/i,
    /browser has been closed/i,
    /Connection closed/i,
    /Protocol error/i,
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN/,
    /socket hang up/i
  ].some(pattern => pattern.test(message))
  return new CaptureError(`${phase}: ${message}`, transient ? 75 : 1)
}

async function step(label, fn) {
  const started = performance.now()
  try {
    return await fn()
  } finally {
    console.log(`[timing] ${label}: ${(performance.now() - started).toFixed(0)}ms`)
  }
}

async function main() {
  if (!url || !output) throw new CaptureError('Set CAPTURE_URL and CAPTURE_DIR.', 1)

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new CaptureError(`CAPTURE_URL is not a valid URL: ${url}`, 1)
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new CaptureError('CAPTURE_URL must use http or https.', 1)
  }

  await step('prepare output directory', async () => {
    mkdirSync(output, { recursive: true })
  })

  const runtime = join(process.env.HOME || '', '.local/share/omgithub-playwright')
  let chromium
  try {
    const require = createRequire(join(runtime, 'package.json'))
    ;({ chromium } = require('playwright'))
  } catch (error) {
    throw new CaptureError(`Unable to load Playwright: ${error.message}`, 75)
  }

  let browser
  try {
    browser = await step('launch browser', () => chromium.launch({ headless: true }))

    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      const context = await step(`create ${name} context`, () => browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        isMobile: name === 'mobile',
        reducedMotion: 'reduce'
      }))

      try {
        const page = await step(`open ${name} page`, () => context.newPage())
        page.setDefaultTimeout(30000)
        page.setDefaultNavigationTimeout(45000)

        page.on('pageerror', error => console.error(`[pageerror] ${error.message}`))
        page.on('requestfailed', request => {
          console.error(`[requestfailed] ${request.url()} ${request.failure()?.errorText || ''}`)
        })

        const response = await step(`navigate ${name}`, async () => {
          try {
            return await page.goto(url, { waitUntil: 'load', timeout: 45000 })
          } catch (error) {
            throw classify(error, `Navigating to ${url}`)
          }
        })

        if (!response) throw new CaptureError(`No HTTP response loading ${url}`, 75)
        if (!response.ok()) {
          const status = response.status()
          throw new CaptureError(
            `HTTP ${status} loading ${url}`,
            [408, 429, 500, 502, 503, 504].includes(status) ? 75 : 1
          )
        }

        await step(`wait for rendered ${name} content`, async () => {
          try {
            await page.waitForFunction(() => {
              if (!document.body || document.readyState !== 'complete') return false
              const hasText = document.body.innerText.trim().length > 0
              const hasVisual = Boolean(document.querySelector('canvas, svg, img, video, picture'))
              return hasText || hasVisual
            }, null, { timeout: 20000 })
            await page.evaluate(() => document.fonts?.ready)
            await page.waitForTimeout(500)
          } catch (error) {
            throw classify(error, `Waiting for rendered content (${name})`)
          }
        })

        const file = join(output, `final-${name}.png`)
        await step(`screenshot ${name}`, async () => {
          try {
            await page.screenshot({ path: file, animations: 'disabled', timeout: 30000 })
          } catch (error) {
            throw classify(error, `Capturing ${name} screenshot`)
          }
        })

        if (!existsSync(file) || statSync(file).size === 0) {
          throw new CaptureError(`Screenshot ${file} was not written.`, 1)
        }
        console.log(`Saved ${name} capture to ${file}`)
      } finally {
        await step(`close ${name} context`, () => context.close()).catch(error => {
          console.error(`Unable to close ${name} context: ${error.message}`)
        })
      }
    }
  } finally {
    if (browser) {
      await step('close browser', () => browser.close()).catch(error => {
        console.error(`Unable to close browser: ${error.message}`)
        if (!process.exitCode) process.exitCode = 75
      })
    }
  }
}

try {
  await main()
} catch (error) {
  const failure = classify(error, 'Capture failed')
  console.error(failure.message)
  process.exitCode = failure.exitCode
}
