# @own-js/chan

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A high-performance, zero-dependency **Golang-style channel** implementation for
TypeScript. Bring the power of Communicating Sequential Processes (CSP) to Bun,
Deno, and Node.js.

## ✨ Features

- 🚀 **Zero Dependencies**: Pure TypeScript implementation.
- 🐹 **Go-like Semantics**: Supports buffered and unbuffered channels.
- 🔀 **Powerful `select`**: Fair scheduling across multiple read/write cases.
- ⏱️ **Signal Integration**: Built-in support for `AbortSignal`.
- 📦 **Modern Tooling**: ESM/CJS support, fully typed with `tsup`.
- ⚡ **Optimized**: Fast-path execution for ready channels to minimize Promise
  overhead.

## 📦 Installation

```bash
# Using bun (recommended)
bun add @own-js/chan

# Using npm
npm install @own-js/chan
```

## 🚀 Quick Start

### Basic Usage

```typescript
import { Chan } from "@own-js/chan";

const ch = new Chan<number>(1); // Buffered channel with capacity 1

// Write to channel
await ch.write(42);

// Read from channel
const { value, ok } = await ch.read();
console.log(value); // 42
```

### Select Multiplexing

The `selectChan` function mimics Go's `select` statement, allowing you to wait
on multiple channel operations.

```typescript
import { Chan, selectChan } from "@own-js/chan";

const ch1 = new Chan<string>();
const ch2 = new Chan<string>();

const writeCase = ch2.writeCase("payload");
const readCase = ch1.readCase();
for (let i = 0; i < 3; i++) {
    switch (i) {
        case 1:
            ch1.write("hello");
            break;
        case 2:
            ch2.read();
            break;
    }
    const selected = await selectChan({
        chans: [
            ch1.readCase(),
            writeCase,
        ],
        signal: i == 0 ? AbortSignal.timeout(100) : null,
        silent: true,
    });
    switch (selected) {
        case readCase:
            console.log(i, "Read from ch1:", readCase.read()!.value);
            break;
        case writeCase:
            console.log(i, "Successfully wrote to ch2:", writeCase.write()!.ok);
            break;
        default:
            console.log(i, `${selected.reason}`);
            break;
    }
}
```

### Iteration

Channels implement the `AsyncIterable` interface.

```typescript
const ch = new Chan<number>(3);
ch.tryWrite(1);
ch.tryWrite(2);
ch.close();

for await (const val of ch) {
    console.log(val); // 1, 2
}
```

## 🛠 API Reference

### `Chan<T>`

- `new Chan(buf?: number)`: Creates a channel. `buf > 0` enables buffering.
- `read(opts?)`: Asynchronous read.
- `tryRead()`: Synchronous read. Returns `{ ok: false }` if no data.
- `write(val, opts?)`: Asynchronous write.
- `tryWrite(val)`: Synchronous write. Returns `{ ok: false }` if full.
- `close()`: Closes the channel. Subsequent reads return `closed: true`.
- `isClosed`: Returns `true` if channel is closed.

### `selectChan(options)`

- `chans`: Array of `ReadCase` or `WriteCase`.
- `default`: If `true`, returns `null` immediately if no case is ready.
- `signal`: `AbortSignal` to cancel the select operation.
- `silent`: If `true`, returns abortion reason instead of throwing.

## 🧪 Testing

This library is tested using **Bun**.

```bash
bun test
```

## 📄 License

MIT © powerpuffpenguin
