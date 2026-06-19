// Polyfills the handful of standard globals that the bundled pdf.js (via unpdf, used for
// on-device resume PDF parsing in lib/resume.ts) expects but Hermes doesn't ship. Import
// this module for its side effects BEFORE unpdf loads. Every install is guarded behind a
// `typeof` check, so if RN/Hermes already provides the global we leave it alone — this is
// safe to load unconditionally. unpdf polyfills DOMMatrix itself, so it's not here.

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any

// Promise.withResolvers — pdf.js uses it heavily; only landed in Hermes recently.
if (typeof (Promise as any).withResolvers !== 'function') {
  ;(Promise as any).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// structuredClone — pdf.js's in-process worker shim (LoopbackPort.postMessage) deep-copies
// every message with `structuredClone(value, hasTransfer ? { transfer } : null)`. React Native
// ships a structuredClone polyfill (@ungap/structured-clone) whose options default `= {}` only
// applies to `undefined`, so the `null` second arg crashes it with
// "Cannot read property 'json' of null" (Chromium — what desktop runs on — tolerates null, so
// desktop's identical unpdf path never hits this). Wrap whatever structuredClone exists to coerce
// a null/transfer options arg to `undefined`, preserving the underlying clone semantics; only fall
// back to our own deep clone if the platform ships none at all.
if (typeof g.structuredClone === 'function') {
  const inner = g.structuredClone.bind(g)
  g.structuredClone = (value: any, options?: any): any =>
    inner(value, options == null ? undefined : options)
} else {
  g.structuredClone = (value: any): any => deepClone(value, new Map())
}

function deepClone(value: any, seen: Map<any, any>): any {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)

  if (value instanceof ArrayBuffer) return value.slice(0)
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return new DataView(value.buffer.slice(0), value.byteOffset, value.byteLength)
    }
    // Typed arrays: the constructor copies elements into a fresh buffer.
    return new (value.constructor as any)(value)
  }
  if (Array.isArray(value)) {
    const arr: any[] = []
    seen.set(value, arr)
    for (let i = 0; i < value.length; i++) arr[i] = deepClone(value[i], seen)
    return arr
  }
  if (value instanceof Map) {
    const m = new Map()
    seen.set(value, m)
    for (const [k, v] of value) m.set(deepClone(k, seen), deepClone(v, seen))
    return m
  }
  if (value instanceof Set) {
    const s = new Set()
    seen.set(value, s)
    for (const v of value) s.add(deepClone(v, seen))
    return s
  }
  const obj: any = {}
  seen.set(value, obj)
  for (const k of Object.keys(value)) obj[k] = deepClone(value[k], seen)
  return obj
}

// atob / btoa — pdf.js decodes some embedded data with them. RN doesn't guarantee these.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

if (typeof g.atob !== 'function') {
  g.atob = (input: string): string => {
    const str = String(input).replace(/=+$/, '')
    let output = ''
    let bs = 0
    let bc = 0
    for (let i = 0; i < str.length; i++) {
      const idx = B64.indexOf(str.charAt(i))
      if (idx === -1) continue
      bs = bc % 4 ? bs * 64 + idx : idx
      if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)))
    }
    return output
  }
}

if (typeof g.btoa !== 'function') {
  g.btoa = (input: string): string => {
    const str = String(input)
    let output = ''
    for (let block = 0, charCode, i = 0, map = B64; str.charAt(i | 0) || ((map = '='), i % 1); output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))) {
      charCode = str.charCodeAt((i += 3 / 4))
      if (charCode > 0xff) throw new Error("btoa: a character's code point is outside Latin1 range")
      block = (block << 8) | charCode
    }
    return output
  }
}

// ReadableStream — referenced by pdf.js streaming paths we never hit (data is in-memory),
// but a missing reference would still throw. A minimal stub keeps the symbol defined.
if (typeof g.ReadableStream === 'undefined') {
  g.ReadableStream = class ReadableStream {}
}

export {}
