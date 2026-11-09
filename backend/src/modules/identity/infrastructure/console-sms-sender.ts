import type { SmsSender } from '../application/ports';

/** Development only: prints the message instead of sending it. Refused in production by config. */
export class ConsoleSmsSender implements SmsSender {
  readonly name = 'console';
  async send(to: string, message: string) {
    console.info(`[sms:console] to=${to} ${message}`);
  }
}
