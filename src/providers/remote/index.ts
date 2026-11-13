import { EventEmitter } from 'node:events';
import { connect, type Socket } from 'node:net';
import { PassThrough, Writable } from 'node:stream';
import type { Computer, Workspace } from '../../ports/computer.ts';
import { threadIdentity } from '../../ports/thread-identity.ts';
import type { CommandProcess } from '../command-process.ts';
import { createBridgeComputer } from '../container-browser/client.ts';
import { browserNamespace } from '../container-browser/index.ts';
import { createCommandWorkspace } from '../docker/index.ts';
import { connectedUser, runSupervisedCommand, workspaceCommandProgram } from '../docker/command.ts';
import { encodeFrame, frameReader, relayFrame, type RelayRequest } from './relay.mjs';

export interface RelayAddress {
  host: string;
  port: number;
}

export function relayAddress(value: string | undefined, name: string): RelayAddress {
  const match = /^(?:\[([0-9a-fA-F:]+)\]|([a-zA-Z0-9.-]+)):(\d{1,5})$/.exec(value ?? '');
  const port = Number(match?.[3]);
  if (!match || port < 1 || port > 65_535) throw new Error(`${name} must be a host:port address.`);
  return { host: match[1] ?? match[2], port };
}

export function relayToken(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{32,}$/.test(value))
    throw new Error('NOD_REMOTE_TOKEN must have at least 32 characters from A-Z a-z 0-9 _ -.');
  return value;
}

class RelayProcess extends EventEmitter implements CommandProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  private readonly socket: Socket;
  private exited = false;
  private code: number | null = null;
  private closed = false;

  constructor(address: RelayAddress, request: RelayRequest) {
    super();
    this.socket = connect({ host: address.host, port: address.port });
    this.socket.setNoDelay(true);
    const socket = this.socket;
    this.stdin = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        const frames: Buffer[] = [];
        for (let offset = 0; offset < chunk.byteLength; offset += 65_536)
          frames.push(encodeFrame(relayFrame.input, chunk.subarray(offset, offset + 65_536)));
        socket.write(Buffer.concat(frames), (error) => callback(error ?? null));
      },
      final(callback) {
        socket.write(encodeFrame(relayFrame.inputEnd), (error) => callback(error ?? null));
      },
    });
    socket.write(encodeFrame(relayFrame.request, Buffer.from(JSON.stringify(request))));
    const read = frameReader((type, payload) => {
      if (type === relayFrame.stdout) this.stdout.write(payload);
      else if (type === relayFrame.stderr) this.stderr.write(payload);
      else if (type === relayFrame.exit && !this.exited) {
        const result = JSON.parse(payload.toString('utf8'));
        this.exited = true;
        this.code = Number.isInteger(result.code) ? result.code : null;
      } else return false;
    });
    socket.on('data', (chunk: Buffer) => {
      try {
        if (read(chunk)) return;
      } catch {}
      socket.destroy(new Error('The relay sent an invalid frame.'));
    });
    socket.on('error', (error) => {
      if (!this.exited && this.listenerCount('error')) this.emit('error', error);
    });
    socket.on('close', () => {
      this.stdout.end();
      this.stderr.end();
      const finish = () => {
        if (this.closed) return;
        this.closed = true;
        this.emit('close', this.exited ? this.code : null);
      };
      if (this.stdout.readableFlowing) this.stdout.once('end', finish);
      else setImmediate(finish);
    });
  }

  kill() {
    this.socket.destroy();
    return true;
  }
}

export function relayProcess(address: RelayAddress, request: RelayRequest): CommandProcess {
  return new RelayProcess(address, request);
}

export function createRemoteWorkspace(options: {
  address: RelayAddress;
  token: string;
  workspaceRoot: string;
}): Workspace {
  const run = (
    id: string,
    args: string[],
    input: Omit<Parameters<typeof runSupervisedCommand>[0], 'args' | 'launch'>,
  ) =>
    runSupervisedCommand({
      ...input,
      args,
      transportGraceMs: 10_000,
      launch: () =>
        relayProcess(options.address, {
          role: 'workspace',
          token: options.token,
          uid: input.cli ? connectedUser(input.cli) : 1000,
          gid: input.cli ? 1002 : 1000,
          cwd: input.cli ? '/var/tmp' : `/workspace/${threadIdentity(id)}`,
          program: workspaceCommandProgram,
        }),
    });
  return createCommandWorkspace({
    workspaceRoot: options.workspaceRoot,
    instructions:
      'Your Linux workspace runs as a separate service. Network access follows the hosting platform’s rules. Node, Python (with pdfplumber and pillow_heif), pipx, git, curl, ripgrep, jq, ffmpeg, yt-dlp, poppler-utils, qpdf, Ghostscript and Tesseract OCR are installed. Python also has pypdf, openpyxl, python-docx and python-pptx, and LibreOffice (soffice) converts office files. Install trusted Python libraries with pip install <package>, trusted CLIs with npm install -g <package> or pipx install <package>; /home/node can be reset when the service restarts, so reinstall tools when they are missing. A connected app CLI never runs from here: Nod installs its own copy from the source you propose. You run as an unprivileged user without sudo or a graphical display; use a CLI or browser web app. Keep outputs in this workspace and install tools here, not on the user’s device.',
    runCommand: run,
    runConnectedCommand: run,
  });
}

export function createRemoteComputer(options: {
  address: RelayAddress;
  token: string;
  dataRoot: string;
}): Computer {
  return createBridgeComputer({
    namespace: browserNamespace(options.dataRoot),
    launch: () => relayProcess(options.address, { role: 'browser', token: options.token }),
  });
}
