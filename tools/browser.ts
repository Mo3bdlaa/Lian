// A browser, with no dependencies.
//
// Chromium speaks the DevTools Protocol over a WebSocket, and Node 22 has a
// WebSocket client built in — so a real browser is available to the tests
// without adding a test framework, a driver, or a download step to a
// repository whose whole deployment story is "node runs it".
//
// It is deliberately small: launch, open a page, evaluate, screenshot, close.
// Anything more elaborate belongs in a test, not in here.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where the environment put Chromium. Absent is a legitimate answer: the
 *  browser tests skip rather than fail, the way the database tests do. */
export function chromiumPath(): string | null {
  const root = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers';
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry, 'chrome-linux', 'chrome');
    if (entry.startsWith('chromium-') && existsSync(candidate)) return candidate;
  }
  return null;
}

type Command = { id: number; method: string; params?: unknown; sessionId?: string };

export class Browser {
  private readonly process: ChildProcess;
  private socket!: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private sessionId: string | null = null;

  private constructor(process: ChildProcess) {
    this.process = process;
  }

  static async launch(): Promise<Browser> {
    const binary = chromiumPath();
    if (binary === null) throw new Error('no chromium');
    const profile = mkdtempSync(join(tmpdir(), 'lian-browser-'));
    const child = spawn(binary, [
      '--headless=new', '--remote-debugging-port=0', '--no-sandbox', '--disable-gpu',
      '--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb',
      `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('chromium did not report a debugging endpoint')), 20_000);
      let buffer = '';
      child.stderr!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const match = /ws:\/\/[^\s]+/.exec(buffer);
        if (match !== null) { clearTimeout(timer); resolve(match[0]); }
      });
    });

    const browser = new Browser(child);
    await browser.connect(endpoint);
    return browser;
  }

  private async connect(endpoint: string): Promise<void> {
    this.socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true });
      this.socket.addEventListener('error', () => reject(new Error('cannot connect to chromium')), { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id === undefined) return;
      const waiting = this.pending.get(message.id);
      if (waiting === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    });

    const { targetId } = await this.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const attached = await this.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = attached.sessionId;
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    // The document links a web font from a CDN. A test environment with no
    // outbound network holds that request open, and a render-blocking
    // stylesheet keeps the document in 'loading' forever — so it is blocked
    // outright. The product's font stacks fall back to the system face, which
    // is what a real reader with a blocked CDN gets too.
    await this.send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
    // Errors are collected into the page rather than streamed, so a test can
    // assert on them: a screen that renders nothing because of a thrown
    // exception looks identical to one that renders nothing on purpose.
    await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__errors = [];
        window.addEventListener('error', (event) => window.__errors.push(String(event.message)));
        window.addEventListener('unhandledrejection', (event) => window.__errors.push('unhandled: ' + String(event.reason && (event.reason.stack || event.reason.message || event.reason))));`,
    });
  }

  private send<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const command: Command = { id, method, ...(params === undefined ? {} : { params }) };
    if (this.sessionId !== null && !method.startsWith('Target.')) command.sessionId = this.sessionId;
    this.socket.send(JSON.stringify(command));
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30_000);
    });
  }

  async setViewport(width: number, height: number, scale = 2): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: scale, mobile: true,
    });
  }

  async goto(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
    // 'interactive', not 'complete': the page links a web font from a host
    // that a sandboxed test environment cannot reach, and waiting for every
    // subresource would make the wait about the network rather than the app.
    await this.waitFor('document.readyState !== "loading"');
  }

  /** Evaluate in the page and return the value. */
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression: `(() => { return (${expression}); })()`, returnByValue: true, awaitPromise: true },
    );
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  /** Poll until an expression is truthy. The only waiting primitive there is:
   *  a test that waits on a fixed sleep is a test that flakes. */
  async waitFor(expression: string, timeoutMs = 10_000): Promise<void> {
    const started = Date.now();
    for (;;) {
      try {
        if (await this.evaluate<boolean>(`!!(${expression})`)) return;
      } catch {
        // The page may be navigating; try again.
      }
      if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for: ${expression}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async click(selector: string): Promise<void> {
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }

  async type(selector: string, text: string): Promise<void> {
    await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.value = ${JSON.stringify(text)};
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }

  /** Anything the page threw since it loaded. */
  async errors(): Promise<string[]> {
    return this.evaluate<string[]>('window.__errors || []');
  }

  async screenshot(): Promise<Buffer> {
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    return Buffer.from(data, 'base64');
  }

  async close(): Promise<void> {
    try { this.socket.close(); } catch { /* already gone */ }
    this.process.kill('SIGKILL');
  }
}
