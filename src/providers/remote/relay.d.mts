import type { Server } from 'node:net';

export declare const relayFrame: {
  readonly request: 0;
  readonly input: 1;
  readonly inputEnd: 2;
  readonly stdout: 3;
  readonly stderr: 4;
  readonly exit: 5;
};

export declare function encodeFrame(type: number, payload?: Buffer): Buffer;

export declare function frameReader(
  onFrame: (type: number, payload: Buffer) => boolean | void,
): (chunk: Buffer) => boolean;

export interface RelayRequest {
  role: 'workspace' | 'browser';
  token: string;
  uid?: number;
  gid?: number;
  cwd?: string;
  program?: string;
}

export declare function workspaceCommand(request: Partial<RelayRequest>): string[] | undefined;

export declare function browserCommand(root?: boolean): string[];

export declare function startRelay(options: {
  role: string | undefined;
  token: string | undefined;
  port?: number;
  host?: string;
  maxConnections?: number;
  requestTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  command?(request: RelayRequest): string[] | undefined;
}): Promise<Server>;
