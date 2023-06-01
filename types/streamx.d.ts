import { AnyStream } from 'streamx'

declare module 'streamx' {
  export function pipeline(...streams: any[]): AnyStream
}
