import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const CHROME = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
const VIEWPORT = {
    width: 402,
    height: 874
};
export class ChromePage {
    process;
    profile;
    socket;
    commandId = 0;
    pending = new Map();
    constructor(process1, profile, socket){
        this.process = process1;
        this.profile = profile;
        this.socket = socket;
        socket.addEventListener('message', (event)=>{
            const reply = JSON.parse(String(event.data));
            if (reply.id === undefined) return;
            const waiter = this.pending.get(reply.id);
            if (!waiter) return;
            this.pending.delete(reply.id);
            if (reply.error) waiter.reject(new Error(reply.error.message || 'Chrome command failed'));
            else waiter.resolve(reply.result);
        });
    }
    static async open() {
        const profile = mkdtempSync(join(tmpdir(), 'pokemon-suite-browser-'));
        const process1 = spawn(CHROME, [
            '--headless=new',
            `--user-data-dir=${profile}`,
            `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
            '--force-device-scale-factor=1',
            '--hide-scrollbars',
            '--no-sandbox',
            '--allow-file-access-from-files',
            '--remote-debugging-address=127.0.0.1',
            '--remote-debugging-port=0',
            'about:blank'
        ], {
            stdio: 'ignore'
        });
        const activePort = join(profile, 'DevToolsActivePort');
        const deadline = Date.now() + 10_000;
        while(!existsSync(activePort)){
            if (process1.exitCode !== null) throw new Error(`Chrome exited with ${process1.exitCode}`);
            if (Date.now() >= deadline) throw new Error('Chrome did not expose its debugging port');
            await new Promise((resolve)=>setTimeout(resolve, 25));
        }
        const port = Number(readFileSync(activePort, 'utf8').split(/\r?\n/u)[0]);
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response)=>response.json());
        const target = targets.find((candidate)=>candidate.type === 'page');
        if (!target) throw new Error('Chrome did not expose a page target');
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject)=>{
            socket.addEventListener('open', ()=>resolve(), {
                once: true
            });
            socket.addEventListener('error', ()=>reject(new Error('Chrome debugging socket failed')), {
                once: true
            });
        });
        return new ChromePage(process1, profile, socket);
    }
    async command(method, params = {}) {
        const id = ++this.commandId;
        const result = new Promise((resolve, reject)=>{
            this.pending.set(id, {
                resolve,
                reject
            });
        });
        this.socket.send(JSON.stringify({
            id,
            method,
            params
        }));
        return result;
    }
    async evaluate(expression) {
        const reply = await this.command('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (reply?.exceptionDetails) {
            throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text || 'page evaluation failed');
        }
        return reply?.result?.value;
    }
    async waitFor(expression, message) {
        const deadline = Date.now() + 8_000;
        while(Date.now() < deadline){
            if (await this.evaluate(`Boolean(${expression})`)) return;
            await new Promise((resolve)=>setTimeout(resolve, 25));
        }
        throw new Error(message);
    }
    async close() {
        this.socket.close();
        this.process.kill('SIGTERM');
        await new Promise((resolve)=>{
            if (this.process.exitCode !== null) resolve();
            else this.process.once('exit', ()=>resolve());
        });
        // Chrome's helper processes can still be writing into the profile just
        // after the browser exits; retry the removal instead of failing on ENOTEMPTY.
        rmSync(this.profile, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100
        });
    }
}
