/// <reference path='../../../node_modules/freedom-typescript-api/interfaces/freedom.d.ts' />
/// <reference path='../../../node_modules/freedom-typescript-api/interfaces/promise.d.ts' />

declare module freedom {
  // TODO: defined the return type of Logger function.
  function Logger() : any
}

module Logger {

  var logBuffer: string[] = [];
  var enabled = true;   // TODO: we probably will change it to false as default.
  var consoleFilter: {[s: string]: string;} = {'*': 'D'};

  var LEVEL_CHARS = 'DIWE';

  export class Logger {
    constructor(public dispatchEvent: any) {
    }

    // Gets log as a encrypted blob, which can be transported in insecure
    // channel.
    public getLogBlob = (...tags: string[]) : Promise<ArrayBuffer> => {
      // TODO: to be implemented.
      return new Promise((F, R) => {
        F(new ArrayBuffer(0));
      });
    }

    // Gets log in plaintext, which should really be used in developing env
    // only.
    public getLogs = (...tags: string[]) : Promise<string> => {
      return new Promise((F, R) => {
        F(logBuffer.join('\n'));
      });
    }

    // Clears all the logs stored in buffer.
    public reset = (): Promise<void> => {
      logBuffer = [];
      return Promise.resolve();
    }

    // Enables/Disables log facility.
    public enable = (newState: boolean) : Promise<void> => {
      enabled = newState;
      return Promise.resolve();
    }

    // Generates current timestamp in form "m/d H:m:s.S"
    private getTimestamp = () : string => {
      var d = new Date();
      return d.getMonth() + '/' + d.getDate() + ' ' + d.getHours() +
          ':' + d.getMinutes() + ':' + d.getSeconds() + '.' +
          d.getMilliseconds();
    }

    // Perform log message formatting. This method is set to public for
    // testing purpose. The function is not exposed in as freedom module API.
    public format = (
        level: string, tag: string, msg: string, args: any[]) : string => {
      var formatted_msg = msg;
      if (args && args.length) {
        for (var i = 0; i < args.length; i++) {
          formatted_msg = formatted_msg.replace('%' + (i + 1), args[i]);
        }
      }
      var ret = [this.getTimestamp(), tag, level, formatted_msg].join('|');
      return ret;
    }


    private isLevelAllowed = (request: string, permitted: string) : boolean => {
      return LEVEL_CHARS.indexOf(request) >= LEVEL_CHARS.indexOf(permitted);
    }

    private doRealLog = (
        level: string, tag: string, msg: string, args: any[]) => {
      if (!enabled) {
        return;
      }
      var logMsg = this.format(level, tag, msg, args);
      if ('*' in consoleFilter &&
          this.isLevelAllowed(level, consoleFilter['*']) ||
          tag in consoleFilter &&
          this.isLevelAllowed(level, consoleFilter[tag])) {
        console.log(logMsg);
      }
      logBuffer.push(logMsg);
    }

    // Sets the log filter for console output. Caller can specify logs of
    // desired tags and levels for console output.
    public setConsoleFilter = (...args: string[]) => {
      consoleFilter = {};
      for (var i = 0; i < args.length; i++) {
        var parts = args[i].split(':');
        consoleFilter[parts[0]] = parts[1];
      }
      return Promise.resolve();
    }

    // Logs message in debug level.
    public debug = (tag: string, msg: string, ...args: any[]) => {
      this.doRealLog('D', tag, msg, args);
      return Promise.resolve();
    }

    // Logs message in info level.
    public info = (tag: string, msg: string, ...args: any[]) => {
      this.doRealLog('I', tag, msg, args);
      return Promise.resolve();
    }

    // Logs message in warn level.
    public warn = (tag: string, msg: string, ...args: any[]) => {
      this.doRealLog('W', tag, msg, args);
      return Promise.resolve();
    }

    // Logs message in error level.
    public error = (tag: string, msg: string, ...args: any[]) => {
      this.doRealLog('E', tag, msg, args);
      return Promise.resolve();
    }
  }

  /** REGISTER PROVIDER **/
  if (typeof freedom !== 'undefined') {
    freedom.Logger().providePromises(Logger);
  }
}

