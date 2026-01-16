import type { ReadCase, WriteCase } from "./select"

export class ChannelError extends Error { }

export type Optional<T> = null | undefined | T

export interface ReadOptions {
    /**
     * If set to true, return { reason: signal.reason } on signal.aborted
     */
    silent?: Optional<boolean>
    /**
     * The sleep function can be gracefully stopped at any time using a signal
     */
    signal?: Optional<AbortSignal>
}

/**
 * The value read
 */
export type ReadValue<T> = {
    /**
     * Whether the channel is closed or not; if an error has occurred and the status is unknown, it will be set to null.
     * @remarks
     * Only one of the values ​​closed and ok can be true at the same time.
     */
    closed: boolean | null
    /**
     * Error information is stored here only if closed is null
     */
    reason?: any

    /**
     * Whether a value has been read is used as a fallback if T might be null.
     * @remarks
     * Only one of the values ​​closed and ok can be true at the same time.
     */
    ok: boolean
    /**
     * The read value is stored here only when ok is set to true.
     */
    value: T | null
}
/**
 * a read-only channel
 */
export interface ReadChannel<T> {
    /**
     * Read a value from the channel, block if there is no value to read, and return until there is a value or the channel is closed
     */
    read(opts?: Optional<ReadOptions>): ReadValue<T> | Promise<ReadValue<T>>

    /**
     * Attempts to read a value from the channel, returns null if no value is readable, returns \{done:true\} if the channel is closed
     */
    tryRead(opts?: Optional<ReadOptions>): ReadValue<T>

    /**
     * Returns whether the channel is closed
     */
    readonly isClosed: boolean

    /**
     * Create a case for select to read
     */
    readCase(): ReadCase<T>
    /**
     * Returns the channel buffer size
     */
    readonly length: number
    /**
     * Returns the capacity of the chan
     */
    readonly capacity: number

    /**
     * Implement asynchronous iterators
     */
    [Symbol.asyncIterator](): AsyncGenerator<T>

    /**
     * Create an iterator object to iterate over the channel
     */
    values(opts?: ReadOptions): AsyncIterable<ReadValue<T>>

    /**
     * Wait for chan to close, no data will be read from chan
     */
    wait(): null | Promise<null>
}

/**
 * The value write result
 */
export type WriteValue = {
    /**
     * Was the write successful?
     * @remarks
     * Only one of the values error and ok can be true at the same time.
     */
    ok: boolean
    /**
     * Has an error occurred?
     * @remarks
     * Only one of the values error and ok can be true at the same time.
     */
    error?: boolean
    /**
     * The specific reason for the error will only be recorded here if error is true.
     */
    reason?: any
}
export interface WriteOptions {
    /**
     * If set to true, exceptions will not be thrown due to writing to a closed chan or signal; instead, these errors will be returned as return values.
     */
    silent?: Optional<boolean>
    /**
     * The sleep function can be gracefully stopped at any time using a signal
     */
    signal?: Optional<AbortSignal>
}

/**
 * a write-only channel
 */
export interface WriteChannel<T> {
    /**
      * Writes a value to the channel, blocking if the channel is not writable until the channel is writable or closed
      */
    write(val: T, opts?: Optional<WriteOptions>): WriteValue | Promise<WriteValue>

    /**
     * Attempt to write a value to the channel
    */
    tryWrite(val: T, opts?: Optional<WriteOptions>): WriteValue

    /**
     * Close the channel, after which the channel will not be able to write, all blocked reads and writes are returned, but the value that has been written to the channel is guaranteed to be fully read
     * @returns Returns false if the channel has been closed, otherwise closes the channel and returns true
     */
    close(): boolean
    /**
     * Returns whether the channel is closed
     */
    readonly isClosed: boolean
    /**
    * Create a case for select to write to
    */
    writeCase(val: T): WriteCase
    /**
     * Returns the channel buffer size
     */
    readonly length: number
    /**
     * Returns the capacity of the chan
     */
    readonly capacity: number
}
/**
 * Read-write bidirectional channel
 */
export interface Channel<T> extends ReadChannel<T>, WriteChannel<T> { }


