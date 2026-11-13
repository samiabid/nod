import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { chownSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

export const relayFrame = { request: 0, input: 1, inputEnd: 2, stdout: 3, stderr: 4, exit: 5 };
const maxRequest = 2 * 1024 * 1024;
const maxFrame = 1024 * 1024;
const unprivileged = ['--clear-groups', '--no-new-privs', '--bounding-set=-all'];

export function encodeFrame(type, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(5);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.byteLength, 1);
  return Buffer.concat([header, payload]);
}

export function frameReader(onFrame) {
  let pending = Buffer.alloc(0);
  let first = true;
  return (chunk) => {
    pending = pending.byteLength ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.byteLength >= 5) {
      const size = pending.readUInt32BE(1);
      if (size > (first ? maxRequest : maxFrame)) return false;
      if (pending.byteLength < 5 + size) break;
      const type = pending.readUInt8(0);
      const payload = pending.subarray(5, 5 + size);
      pending = pending.subarray(5 + size);
      first = false;
      if (onFrame(type, payload) === false) return false;
    }
    return pending.byteLength <= 5 + maxRequest;
  };
}

const digest = (value) => createHash('sha256').update(String(value)).digest();
const environment = (home) => [
  '/usr/bin/env',
  '-i',
  `HOME=${home}`,
  'LANG=C.UTF-8',
  'PATH=/opt/nod-artifacts/bin:/home/node/.local/bin:/usr/local/bin:/usr/bin:/bin',
];

export function workspaceCommand(request) {
  const connected = request.cwd === '/var/tmp';
  if (
    typeof request.program !== 'string' ||
    request.program.length > maxRequest / 2 ||
    !(connected
      ? Number.isInteger(request.uid) && request.uid >= 20_000 && request.uid < 60_000 && request.gid === 1002
      : request.uid === 1000 &&
        request.gid === 1000 &&
        typeof request.cwd === 'string' &&
        /^\/workspace\/[a-zA-Z0-9_-]{1,100}$/.test(request.cwd))
  )
    return undefined;
  return [
    '/usr/bin/setpriv',
    '--reuid',
    String(request.uid),
    '--regid',
    String(request.gid),
    ...unprivileged,
    ...environment('/home/node'),
    'NPM_CONFIG_PREFIX=/home/node/.local',
    'PIPX_HOME=/home/node/.local/pipx',
    'PIPX_BIN_DIR=/home/node/.local/bin',
    '/bin/sh',
    '-c',
    'mkdir -p "$1" && cd "$1" && shift && exec "$@"',
    'nod-command',
    request.cwd,
    '/usr/bin/python3',
    '-I',
    '-u',
    '-c',
    request.program,
  ];
}

export function browserCommand(root = process.getuid?.() === 0) {
  const bridge = [process.execPath, '/app/bridge.mjs'];
  return root
    ? ['/usr/bin/setpriv', '--reuid', '1000', '--regid', '1000', ...unprivileged, ...environment('/home/node'), ...bridge]
    : bridge;
}

export async function startRelay(options) {
  if (!['workspace', 'browser'].includes(options.role))
    throw new Error('NOD_RELAY_ROLE must be workspace or browser.');
  if (typeof options.token !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(options.token))
    throw new Error('NOD_RELAY_TOKEN must have at least 32 characters from A-Z a-z 0-9 _ -.');
  const expected = digest(options.token);
  const command =
    options.command ?? ((request) => (options.role === 'workspace' ? workspaceCommand(request) : browserCommand()));
  let active = 0;
  const server = createServer((socket) => {
    if (active >= (options.maxConnections ?? 64)) return socket.destroy();
    active++;
    socket.setNoDelay(true);
    let child;
    const deadline = setTimeout(() => socket.destroy(), options.requestTimeoutMs ?? 10_000);
    const send = (type, payload) => socket.writable && socket.write(encodeFrame(type, payload));
    const start = (payload) => {
      clearTimeout(deadline);
      let request;
      try {
        request = JSON.parse(payload.toString('utf8'));
      } catch {
        return false;
      }
      if (
        !request ||
        request.role !== options.role ||
        !timingSafeEqual(digest(request.token), expected)
      )
        return false;
      const argv = command(request);
      if (!argv) return false;
      child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'pipe', env: options.env ?? {} });
      const forward = (stream, type) =>
        stream.on('data', (chunk) => {
          if (send(type, chunk) === false) {
            stream.pause();
            socket.once('drain', () => stream.resume());
          }
        });
      forward(child.stdout, relayFrame.stdout);
      forward(child.stderr, relayFrame.stderr);
      child.stdin.on('error', () => {});
      child.on('error', () => socket.destroy());
      child.on('close', (code, signal) => {
        send(relayFrame.exit, Buffer.from(JSON.stringify({ code, signal })));
        socket.end();
      });
    };
    const read = frameReader((type, payload) => {
      if (!child) return type === relayFrame.request && start(payload) !== false && Boolean(child);
      if (type === relayFrame.input) {
        if (!child.stdin.write(payload)) {
          socket.pause();
          child.stdin.once('drain', () => socket.resume());
        }
      } else if (type === relayFrame.inputEnd) child.stdin.end();
      else return false;
    });
    socket.on('data', (chunk) => {
      if (!read(chunk)) socket.destroy();
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      active--;
      clearTimeout(deadline);
      if (child && child.exitCode === null && child.signalCode === null)
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4320, options.host ?? '::', () => resolve(server));
  });
}

function prepare(paths) {
  for (const path of paths) {
    mkdirSync(path, { recursive: true });
    chownSync(path, 1000, 1000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { NOD_RELAY_ROLE: role, NOD_RELAY_TOKEN: token, NOD_RELAY_PORT: port } = process.env;
  try {
    if (role === 'workspace' && process.getuid?.() !== 0)
      throw new Error('The workspace relay runs as root so each command can drop to its own user.');
    prepare((process.env.NOD_RELAY_PREPARE ?? '').split(':').filter(Boolean));
    await startRelay({ role, token, port: port ? Number(port) : undefined });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const companion = process.argv.slice(process.argv.indexOf('--') + 1);
  if (process.argv.includes('--') && companion.length) {
    const { NOD_RELAY_TOKEN: _, ...inherited } = process.env;
    const argv =
      process.getuid?.() === 0
        ? ['/usr/bin/setpriv', '--reuid', '1000', '--regid', '1000', ...unprivileged, ...companion]
        : companion;
    const child = spawn(argv[0], argv.slice(1), {
      stdio: 'inherit',
      env: { ...inherited, HOME: '/home/node' },
    });
    child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  } else for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0));
  console.log(`Nod ${role} relay listening on port ${port ?? 4320}.`);
}
