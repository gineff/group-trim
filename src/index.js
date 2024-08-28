#!/usr/bin/env node

import { program } from 'commander'
import { resolve, basename, extname } from 'node:path'
import {
  createHash,
  makeDir,
  checkIsTorrent,
  createTorrentServer,
  checkAccess,
} from './utils/index.js'
import { Trimmer } from './trimmer.js'
import { Monitor } from './monitor.js'
import { Controller } from './controller.js'

program
  .option('-i, --input <input>', 'video source')
  .option('-p, --path <path>', 'change destination path', './tmp')
  .option('-P, --port <port>', 'torrent server port', '8888')
  .option('-b, --buffer <buffer>', 'buffer file path')
  .option('-l, --log', 'display ffmpeg log', false)
  .option('-t, --timeout <timeout>', 'timeout in sec. for trim process', '30')
  .option('-r, --retries <retries>', 'number of retries for trim process', '10')
  .option('-c, --check', 'verify torrent', true)
  .option('-s,--streams <streams>', 'the number of concurrent streams', '3')
  .parse(process.argv)

const trimmers = []
const {
  input,
  path,
  timeout,
  retries,
  streams,
  log,
  check,
  buffer,
  port: defaultPort,
} = program.opts()

const __dirname = process.cwd()
const destinationPath = await checkAccess(resolve(__dirname, path))
const inputPath = await checkAccess(resolve(__dirname, input))
const bufferPath = buffer && (await checkAccess(resolve(__dirname, buffer)))
const ranges = program.args.map(parseSegments)

const makeOutput = (fileName, range, path) => {
  const hash = createHash(fileName)
  const [startTime, duration] = range
  const ext = extname(fileName) ?? '.mp4'
  return resolve(path, `${hash}-${startTime}-${duration}${ext}`)
}

function parseSegments(segment) {
  const segmentFormat = {
    ['hh:mm:ss-duration']: /(\d{2}):(\d{2}):(\d{2})-(\d+)/,
    ['startTime-duration']: /^(\d+)-(\d+)/,
  }
  const match = segment.match(segmentFormat['hh:mm:ss-duration'])
  if (match !== null) {
    const [, hrs, min, sec, duration] = Array.from(match, (val) => +val)
    return [(hrs * 60 + min) * 60 + sec, duration]
  }
  if (segmentFormat['startTime-duration'].test(segment.trim())) {
    return segment.split('-')
  }
  return [0, 0]
}

await makeDir(destinationPath)
const isTorrent = checkIsTorrent(inputPath)
const { torrentFileName, host, port } = isTorrent
  ? await createTorrentServer(inputPath, {
      verify: check,
      buffer: bufferPath,
      defaultPort,
    })
  : {}

const currentInput = isTorrent ? `${host}:${port}` : inputPath
const fileName = torrentFileName || basename(currentInput)

for (const range of ranges) {
  trimmers.push(
    new Trimmer({
      input: currentInput,
      range,
      output: makeOutput(fileName, range, destinationPath),
      log,
    }),
  )
}
new Monitor(trimmers)
new Controller({ trimmers, retries, concurrentStreams: streams, timeout })
